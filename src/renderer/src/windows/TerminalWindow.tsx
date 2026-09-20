import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { TerminalSessionInfo } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'
import { useResolvedTheme, isMac } from '@renderer/hooks/useTheme'
import { TerminalView } from '@renderer/components/Terminal'

/**
 * Terminal window (windows mode): a single-session BrowserWindow booted
 * with ?sessionId=&windowId= in its query string. It attaches to the PTY
 * that the spawning window asked main to create and streams it full-bleed.
 */
export function TerminalWindow({
  sessionId,
  windowId
}: {
  sessionId: string
  windowId: string
}): React.ReactElement {
  const { settings, exits } = useAppState()
  const { killTerminal } = useAppActions()
  const dark = useResolvedTheme(settings)
  const [info, setInfo] = useState<TerminalSessionInfo | null>(null)

  // The owning window spawns the PTY right after creating this one; poll
  // the session list until our session shows up.
  useEffect(() => {
    let cancelled = false
    const tryFetch = async (attempt: number): Promise<void> => {
      const found = (await window.hangar.listSessions()).find((s) => s.id === sessionId)
      if (cancelled) return
      if (found) setInfo(found)
      else if (attempt < 40) setTimeout(() => void tryFetch(attempt + 1), 150)
    }
    void tryFetch(0)
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Live title updates (this window has no entry in the sessions reducer)
  useEffect(() => {
    const off = window.hangar.onTerminalTitle(({ sessionId: id, title }) => {
      if (id === sessionId) setInfo((cur) => (cur ? { ...cur, title } : cur))
    })
    return off
  }, [sessionId])

  const exit = exits[sessionId]

  const session: TerminalSessionInfo =
    info ?? {
      id: sessionId,
      repoTileId: '',
      agentId: '',
      title: 'Connecting…',
      cwd: '',
      createdAt: Date.now(),
      cols: 80,
      rows: 24
    }

  return (
    <div className="flex h-full flex-col bg-[#0c0c0f]">
      <header
        className="drag-region flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 pl-3 pr-1.5"
        style={isMac ? { paddingLeft: 78 } : undefined}
      >
        <p className="truncate font-mono text-[11px] text-zinc-400">
          {exit
            ? `${session.title} — exited (code ${exit.exitCode})`
            : session.title || 'Connecting…'}
        </p>
        <button
          type="button"
          aria-label="Close terminal"
          onClick={() => {
            void killTerminal(sessionId).finally(() => void window.hangar.closeWindow(windowId))
          }}
          className="no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={13} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <TerminalView
          session={session}
          active
          fontSize={settings?.terminalFontSize ?? 13}
          fontFamily={settings?.terminalFontFamily ?? 'Menlo, Consolas, monospace'}
          dark={dark === 'dark'}
        />
        {!info && !exit && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-zinc-600" />
          </div>
        )}
        {exit && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-amber-700/40 bg-amber-950/60 px-4 py-2.5">
            <p className="text-xs text-amber-200">
              Process exited
              {exit.exitCode !== 0 && <span className="ml-1.5 font-mono">(code {exit.exitCode})</span>}
            </p>
            <button
              type="button"
              onClick={() => void window.hangar.closeWindow(windowId)}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50"
            >
              Close window
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
