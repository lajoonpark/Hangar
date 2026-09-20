import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import type { IPty } from 'node-pty'
import {
  SpawnRequest,
  SpawnResult,
  TerminalExitEvent,
  TerminalSessionInfo,
  TerminalTitleEvent
} from '@shared/types'
import { IPC } from '@shared/ipc'
import { agentService } from './agents'
import { repoIndexService } from './repoIndex'
import { scannerService } from './scanner'

/**
 * PTY session manager — one node-pty process per terminal session.
 *
 * - Shell detection: $SHELL on macOS/Linux, PowerShell on Windows.
 * - Graceful kill: SIGTERM → wait → SIGKILL.
 * - Streams output to the renderer via `terminal:data`, exits via
 *   `terminal:exit`, and detects OSC title sequences to emit `terminal:title`.
 * - All PIDs tracked; killAll() runs on app quit to prevent orphans.
 */

interface Session {
  info: TerminalSessionInfo
  pty: IPty
  titleState: OscParserState
}

const TERM_COLS = 80
const TERM_ROWS = 24
const TERM_GRACE_MS = 1000

class PtyManager extends EventEmitter {
  private sessions = new Map<string, Session>()
  private broadcast: (channel: string, payload: unknown) => void = () => {}

  setBroadcast(fn: (channel: string, payload: unknown) => void): void {
    this.broadcast = fn
  }

  /**
   * Spawn an agent terminal for a repo tile.
   * Mode resolution: explicit request.mode > settings.windowMode > 'tab'.
   */
  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    const agent = agentService.byId(req.agentId)
    if (!agent) throw new Error(`Unknown agent: ${req.agentId}`)
    if (agent.disabled) throw new Error(`Agent "${agent.name}" is disabled`)

    const tile = scannerService.listTiles().find((t) => t.id === req.repoTileId)
    const cwd = agent.workingDirOverride || tile?.path || os.homedir()

    const sessionId = randomUUID()
    const title = `${agent.name} @ ${path.basename(cwd)}`

    const pty = this.spawnPty(agent, cwd)

    const info: TerminalSessionInfo = {
      id: sessionId,
      repoTileId: req.repoTileId,
      agentId: agent.id,
      title,
      cwd,
      createdAt: Date.now(),
      cols: TERM_COLS,
      rows: TERM_ROWS
    }
    const session: Session = { info, pty, titleState: {} }
    this.sessions.set(sessionId, session)

    pty.onData((data) => {
      this.handleData(session, data)
      this.broadcast(IPC.terminalData, { sessionId, data })
    })

    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(sessionId)
      const evt: TerminalExitEvent = {
        sessionId,
        exitCode,
        signal: signal === undefined ? undefined : String(signal)
      }
      this.broadcast(IPC.terminalExit, evt)
    })

    if (tile) {
      scannerService.recordOpen(tile.id)
      // Fire-and-forget: index/refresh the repo in the background when
      // enabled and missing or stale. Never blocks the spawn.
      repoIndexService.onRepoOpened(tile)
      // Other windows should refresh their grid (recent badge/sort)
      this.broadcast(IPC.gridInvalidate, { reason: 'repo-opened', tileId: tile.id })
    }

    // Windows mode opens its own window; the renderer will call
    // window:create if needed — spawn() returns ownership info either way.
    return { sessionId, windowId: req.windowId ?? 'active', title }
  }

  private spawnPty(agent: { command: string; args?: string[]; env?: Record<string, string>; useShell: boolean }, cwd: string): IPty {
    // Lazy import so renderer-only typecheck doesn't resolve node-pty binary
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePty = require('node-pty') as typeof import('node-pty')

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...agent.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG ?? (os.platform() === 'darwin' ? 'en_US.UTF-8' : process.env.LANG ?? '')
    }

    if (agent.useShell) {
      const [shell, shellArgs] = this.detectShell()
      const commandLine = [agent.command, ...(agent.args ?? [])].join(' ')
      return nodePty.spawn(shell, [...shellArgs, commandLine], {
        name: 'xterm-256color',
        cols: TERM_COLS,
        rows: TERM_ROWS,
        cwd,
        env
      })
    }

    return nodePty.spawn(agent.command, agent.args ?? [], {
      name: 'xterm-256color',
      cols: TERM_COLS,
      rows: TERM_ROWS,
      cwd,
      env
    })
  }

  private detectShell(): [string, string[]] {
    if (process.platform === 'win32') {
      return ['powershell.exe', ['-NoLogo', '-Command']]
    }
    // Login + interactive so the user's real environment (PATH from
    // /etc/paths.d via path_helper, plus ~/.zshrc / ~/.zprofile) is loaded.
    // When launched as a GUI app (Finder/Dock), the process only inherits the
    // minimal launchd PATH (/usr/bin:/bin:/usr/sbin:/sbin); a plain `-c`
    // shell then cannot find agent binaries in /opt/homebrew/bin, ~/.local/bin,
    // nvm, etc. — which made every agent PTY exit instantly with code 127.
    const shell = process.env.SHELL && existsInPath(process.env.SHELL) ? process.env.SHELL : '/bin/bash'
    return [shell, ['-lic']]
  }

  /** Keystrokes from the renderer. */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || cols <= 0 || rows <= 0) return
    const c = Math.floor(cols)
    const r = Math.floor(rows)
    session.info.cols = c
    session.info.rows = r
    try {
      session.pty.resize(c, r)
    } catch {
      // PTY may already be closing
    }
  }

  /** Graceful kill: SIGTERM, then SIGKILL after a grace period. */
  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    await this.terminate(session)
  }

  private async terminate(session: Session): Promise<void> {
    const { pty } = session
    let alive = true
    const exit = new Promise<void>((resolve) => pty.onExit(() => { alive = false; resolve() }))

    try {
      process.kill(pty.pid, 'SIGTERM')
    } catch {
      return // already gone
    }

    const timer = new Promise<void>((resolve) => setTimeout(resolve, TERM_GRACE_MS))
    await Promise.race([exit, timer])
    if (alive) {
      try {
        pty.kill()
      } catch {
        // already gone
      }
    }
    await exit
  }

  /** Kill every live session — called on app quit. */
  async killAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((s) => this.terminate(s)))
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  /** Live PIDs of all sessions — used by the hard-cleanup fallback. */
  livePids(): number[] {
    return [...this.sessions.values()].map((s) => s.pty.pid)
  }

  // ── OSC title detection ──────────────────────────────────────────────

  private handleData(session: Session, data: string): void {
    const title = extractOscTitle(session.titleState, data)
    if (title && title !== session.info.title) {
      session.info.title = title
      const evt: TerminalTitleEvent = { sessionId: session.info.id, title }
      this.broadcast(IPC.terminalTitle, evt)
    }
  }
}

// ── Minimal streaming OSC 0/2 title parser ────────────────────────────────

interface OscParserState {
  /** partial escape sequence carried across chunks */
  buffer?: string
}

const OSC_START = '\x1b]'
const BEL = '\x07'
const ST = '\x1b\\'
const TITLE_CODES = new Set(['0', '2'])

/**
 * Extract window-title updates (OSC 0 / OSC 2) from a PTY output chunk.
 * Maintains cross-chunk state; returns the new title when one completes.
 */
function extractOscTitle(state: OscParserState, chunk: string): string | null {
  let pending = state.buffer ?? ''
  const searchIn = pending + chunk
  state.buffer = undefined

  let idx = 0
  let result: string | null = null
  while (idx < searchIn.length) {
    const start = searchIn.indexOf(OSC_START, idx)
    if (start === -1) {
      // keep a small tail in case an OSC start is split across chunks
      state.buffer = searchIn.slice(Math.max(idx, searchIn.length - OSC_START.length))
      break
    }
    const code = searchIn[start + OSC_START.length]
    if (!code || !TITLE_CODES.has(code)) {
      idx = start + OSC_START.length
      continue
    }
    const bodyStart = start + OSC_START.length + 1
    const semi = searchIn.indexOf(';', bodyStart)
    if (semi === -1) {
      state.buffer = searchIn.slice(start)
      break
    }
    const belEnd = searchIn.indexOf(BEL, semi + 1)
    const stEnd = searchIn.indexOf(ST, semi + 1)
    if (belEnd === -1 && stEnd === -1) {
      // title body itself is split — keep accumulating
      state.buffer = searchIn.slice(start)
      break
    }
    const end =
      belEnd === -1 ? stEnd : stEnd === -1 ? belEnd : Math.min(belEnd, stEnd)
    const terminator = end === belEnd ? BEL.length : ST.length
    result = searchIn.slice(semi + 1, end).trim()
    idx = end + terminator
  }
  return result
}

function existsInPath(file: string): boolean {
  if (path.isAbsolute(file)) return true
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  return dirs.some((d) => {
    try {
      require('fs').existsSync(path.join(d, file))
      return true
    } catch {
      return false
    }
  })
}

export const ptyManager = new PtyManager()
