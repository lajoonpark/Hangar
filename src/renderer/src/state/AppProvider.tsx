import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type {
  AgentDefinition,
  AppSettings,
  RepoIndexStatus,
  RepoTile,
  RootFolder,
  ScanProgress,
  SpawnRequest,
  TerminalBootState,
  TerminalSessionInfo
} from '@shared/types'

/**
 * Window-scoped app state.
 *
 * One provider per BrowserWindow. It owns:
 * - settings / roots / tiles / agents / index statuses (mirrors of main-process truth)
 * - terminal sessions owned by THIS window (tab bar)
 * - a per-session output buffer so PTY data that arrives before xterm mounts is not lost
 *
 * All main→renderer events are subscribed here once; components consume via hooks.
 */

// ── State ───────────────────────────────────────────────────────────────────

export interface AppState {
  ready: boolean
  settings: AppSettings | null
  roots: RootFolder[]
  tiles: RepoTile[]
  agents: AgentDefinition[]
  indexStatuses: Record<string, RepoIndexStatus>
  /** rootId → latest progress (present while a scan is running) */
  scanning: Record<string, ScanProgress>
  /** Sessions shown in this window's tab bar */
  sessions: TerminalSessionInfo[]
  /** Sessions whose PTY process has exited (kept as dead tabs until closed) */
  exits: Record<string, { exitCode: number; signal?: string }>
  /**
   * sessionId → live boot state from the main process ('booting' | 'stalled' | 'ready').
   * Used by the terminal UI to show a "starting…" overlay until the agent
   * prints its first output. Absent = unknown (e.g. exited before any event).
   */
  bootStates: Record<string, TerminalBootState>
}

type Action =
  | { type: 'ready' }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'roots'; roots: RootFolder[] }
  | { type: 'tiles'; tiles: RepoTile[] }
  | { type: 'agents'; agents: AgentDefinition[] }
  | { type: 'indexStatuses'; statuses: RepoIndexStatus[] }
  | { type: 'indexProgress'; repoTileId: string; state: RepoIndexStatus['state'] }
  | { type: 'indexComplete'; status: RepoIndexStatus }
  | { type: 'scanProgress'; evt: ScanProgress }
  | { type: 'scanDone'; rootId: string }
  | { type: 'sessionAdd'; session: TerminalSessionInfo }
  | { type: 'sessionExit'; sessionId: string; exitCode: number; signal?: string }
  | { type: 'sessionTitle'; sessionId: string; title: string }
  | { type: 'sessionRename'; sessionId: string; title: string }
  | { type: 'sessionStatus'; sessionId: string; status: TerminalBootState }
  | { type: 'sessionRemove'; sessionId: string }

const initialState: AppState = {
  ready: false,
  settings: null,
  roots: [],
  tiles: [],
  agents: [],
  indexStatuses: {},
  scanning: {},
  sessions: [],
  exits: {},
  bootStates: {}
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ready':
      return { ...state, ready: true }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'roots':
      return { ...state, roots: action.roots }
    case 'tiles':
      return { ...state, tiles: action.tiles }
    case 'agents':
      return { ...state, agents: action.agents }
    case 'indexStatuses': {
      const next = { ...state.indexStatuses }
      for (const s of action.statuses) next[s.repoTileId] = s
      return { ...state, indexStatuses: next }
    }
    case 'indexProgress': {
      const prev = state.indexStatuses[action.repoTileId]
      return {
        ...state,
        indexStatuses: {
          ...state.indexStatuses,
          [action.repoTileId]: {
            repoTileId: action.repoTileId,
            repoPath: prev?.repoPath ?? '',
            repoName: prev?.repoName ?? '',
            state: action.state,
            files: prev?.files ?? 0,
            chunks: prev?.chunks ?? 0
          }
        }
      }
    }
    case 'indexComplete': {
      const s = action.status
      return {
        ...state,
        indexStatuses: {
          ...state.indexStatuses,
          [s.repoTileId]: { ...state.indexStatuses[s.repoTileId], ...s }
        }
      }
    }
    case 'scanProgress':
      return { ...state, scanning: { ...state.scanning, [action.evt.rootId]: action.evt } }
    case 'scanDone': {
      const next = { ...state.scanning }
      delete next[action.rootId]
      return { ...state, scanning: next }
    }
    case 'sessionAdd':
      if (state.sessions.some((s) => s.id === action.session.id)) return state
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        // Seed 'booting' unless a status event already resolved this session
        // (the IPC invoke response and the booting broadcast race).
        bootStates: {
          ...state.bootStates,
          [action.session.id]: state.bootStates[action.session.id] ?? 'booting'
        }
      }
    case 'sessionExit':
      {
        const bootStates = { ...state.bootStates }
        delete bootStates[action.sessionId]
        return {
          ...state,
          bootStates,
          exits: {
            ...state.exits,
            [action.sessionId]: { exitCode: action.exitCode, signal: action.signal }
          }
        }
      }
    case 'sessionStatus': {
      // Never regress a resolved session back to booting/stalled (guards
      // against out-of-order delivery of the booting vs ready broadcasts).
      if (state.bootStates[action.sessionId] === 'ready') return state
      return {
        ...state,
        bootStates: { ...state.bootStates, [action.sessionId]: action.status }
      }
    }
    case 'sessionTitle':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId && !s.customTitle ? { ...s, title: action.title } : s
        )
      }
    case 'sessionRename': {
      const title = action.title.trim()
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, customTitle: title || undefined } : s
        )
      }
    }
    case 'sessionRemove': {
      const exits = { ...state.exits }
      delete exits[action.sessionId]
      const bootStates = { ...state.bootStates }
      delete bootStates[action.sessionId]
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.sessionId),
        exits,
        bootStates
      }
    }
    default:
      return state
  }
}

// ── PTY output buffer (kept out of React state for throughput) ─────────────

const BUFFER_CAP = 96 * 1024

class OutputBuffer {
  private chunks = new Map<string, string[]>()

  push(sessionId: string, data: string): void {
    let list = this.chunks.get(sessionId)
    if (!list) {
      list = []
      this.chunks.set(sessionId, list)
    }
    list.push(data)
    let size = 0
    for (const c of list) size += c.length
    while (size > BUFFER_CAP && list.length > 1) {
      const dropped = list.shift()
      size -= dropped?.length ?? 0
    }
  }

  /** Drain everything buffered for a session (used when xterm mounts). */
  drain(sessionId: string): string {
    const list = this.chunks.get(sessionId)
    this.chunks.delete(sessionId)
    return list ? list.join('') : ''
  }

  drop(sessionId: string): void {
    this.chunks.delete(sessionId)
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface AppActions {
  /** Re-fetch settings/roots/tiles/agents/index statuses from main. */
  refreshAll(): Promise<void>
  refreshTiles(): Promise<void>
  addFolders(): Promise<void>
  removeFolder(id: string): Promise<void>
  rescanAll(): Promise<void>
  updateSettings(partial: Partial<AppSettings>): Promise<void>
  resetSettings(): Promise<void>
  saveAgent(agent: AgentDefinition): Promise<void>
  addAgent(payload: Parameters<typeof window.hangar.addAgent>[0]): Promise<AgentDefinition>
  deleteAgent(id: string): Promise<void>
  toggleBuiltinAgent(id: string, disabled: boolean): Promise<void>
  /** Change the tab-label prefix for any agent (persisted in settings). */
  setAgentTabLabel(agentId: string, label: string): Promise<void>
  reindexRepo(tileId: string): Promise<void>
  removeIndex(tileId: string): Promise<void>
  /** Spawn a terminal; in tab modes the session is registered in this window. */
  spawnTerminal(req: SpawnRequest, tile: RepoTile | undefined): Promise<void>
  killTerminal(sessionId: string): Promise<void>
  closeTab(sessionId: string): Promise<void>
  /** Set (or clear with an empty string) a per-tab custom title. */
  renameSession(sessionId: string, title: string): void
  /**
   * Record a session's boot state without adding it to the tab bar.
   * Used by terminal windows hydrating a pre-existing session after a late
   * attach (their spawn happened before this window subscribed to events).
   */
  noteSessionStatus(sessionId: string, status: TerminalBootState): void
  /** PTY output buffered before the terminal mounted. */
  drainOutput(sessionId: string): string
}

const StateContext = createContext<AppState>(initialState)
const ActionsContext = createContext<AppActions | null>(null)

export function useAppState(): AppState {
  return useContext(StateContext)
}

export function useAppActions(): AppActions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useAppActions must be used inside <AppProvider>')
  return actions
}

// ── Provider ────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState)
  const buffer = useRef(new OutputBuffer())

  useEffect(() => {
    const hangar = window.hangar
    let disposed = false

    const fetchSettings = (): Promise<void> =>
      hangar.getSettings().then((settings) => {
        if (!disposed) dispatch({ type: 'settings', settings })
      })
    const fetchRoots = (): Promise<void> =>
      hangar.listFolders().then((roots) => {
        if (!disposed) dispatch({ type: 'roots', roots })
      })
    const fetchTiles = (): Promise<void> =>
      hangar.listTiles().then((tiles) => {
        if (!disposed) dispatch({ type: 'tiles', tiles })
      })
    const fetchAgents = (): Promise<void> =>
      hangar.listAgents().then((agents) => {
        if (!disposed) dispatch({ type: 'agents', agents })
      })
    const fetchIndex = (): Promise<void> =>
      hangar
        .indexStatus()
        .then((statuses) => {
          if (!disposed) dispatch({ type: 'indexStatuses', statuses })
        })
        .catch(() => undefined)

    const refreshAll = (): Promise<void> =>
      Promise.all([fetchSettings(), fetchRoots(), fetchTiles(), fetchAgents(), fetchIndex()]).then(
        () => undefined
      )

    // Boot: paint cached data fast, then trigger a debounced rescan so
    // freshly added/removed repos show up without user action.
    const boot = async (): Promise<void> => {
      await refreshAll()
      dispatch({ type: 'ready' })
      if ((await hangar.listFolders()).length > 0) {
        await hangar.scanAllFolders().catch(() => undefined)
      }
    }
    void boot()

    // ── main → renderer events ──
    const offs = [
      hangar.onTerminalData(({ sessionId, data }) => buffer.current.push(sessionId, data)),
      hangar.onTerminalExit(({ sessionId, exitCode, signal }) => {
        buffer.current.drop(sessionId)
        dispatch({ type: 'sessionExit', sessionId, exitCode, signal })
      }),
      hangar.onTerminalTitle(({ sessionId, title }) =>
        dispatch({ type: 'sessionTitle', sessionId, title })
      ),
      hangar.onTerminalStatus(({ sessionId, status }) =>
        dispatch({ type: 'sessionStatus', sessionId, status })
      ),
      hangar.onScanProgress((evt) => dispatch({ type: 'scanProgress', evt })),
      hangar.onScanComplete(({ rootId }) => {
        dispatch({ type: 'scanDone', rootId })
        void fetchTiles()
      }),
      hangar.onGridInvalidate(() => void refreshAll()),
      hangar.onIndexProgress(({ repoTileId }) =>
        dispatch({ type: 'indexProgress', repoTileId, state: 'indexing' })
      ),
      hangar.onIndexComplete(({ repoTileId, ok, files, chunks, error }) =>
        dispatch({
          type: 'indexComplete',
          status: {
            repoTileId,
            repoPath: '',
            repoName: '',
            state: ok ? 'ready' : 'error',
            files,
            chunks,
            error
          }
        })
      )
    ]

    return () => {
      disposed = true
      offs.forEach((off) => off())
    }
  }, [])

  const actions = useMemo<AppActions>(() => {
    const hangar = window.hangar
    const refreshAll = async (): Promise<void> => {
      await Promise.all([
        hangar.getSettings().then((settings) => dispatch({ type: 'settings', settings })),
        hangar.listFolders().then((roots) => dispatch({ type: 'roots', roots })),
        hangar.listTiles().then((tiles) => dispatch({ type: 'tiles', tiles })),
        hangar.listAgents().then((agents) => dispatch({ type: 'agents', agents })),
        hangar
          .indexStatus()
          .then((statuses) => dispatch({ type: 'indexStatuses', statuses }))
          .catch(() => undefined)
      ])
    }
    return {
      refreshAll,
      async refreshTiles() {
        dispatch({ type: 'tiles', tiles: await hangar.listTiles() })
      },
      async addFolders() {
        const added = await hangar.addFolders()
        dispatch({ type: 'roots', roots: added })
        await hangar.scanAllFolders().catch(() => undefined)
      },
      async removeFolder(id) {
        await hangar.removeFolder(id)
        await refreshAll()
      },
      async rescanAll() {
        await hangar.scanAllFolders()
      },
      async updateSettings(partial) {
        dispatch({ type: 'settings', settings: await hangar.setSettings(partial) })
      },
      async resetSettings() {
        dispatch({ type: 'settings', settings: await hangar.resetSettings() })
      },
      async saveAgent(agent) {
        await hangar.updateAgent(agent)
        dispatch({ type: 'agents', agents: await hangar.listAgents() })
      },
      async addAgent(payload) {
        const created = await hangar.addAgent(payload)
        dispatch({ type: 'agents', agents: await hangar.listAgents() })
        return created
      },
      async deleteAgent(id) {
        await hangar.deleteAgent(id)
        dispatch({ type: 'agents', agents: await hangar.listAgents() })
      },
      async toggleBuiltinAgent(id, disabled) {
        await hangar.toggleBuiltinAgent(id, disabled)
        dispatch({ type: 'agents', agents: await hangar.listAgents() })
      },
      async setAgentTabLabel(agentId, label) {
        await hangar.setAgentTabLabel(agentId, label)
        dispatch({ type: 'agents', agents: await hangar.listAgents() })
      },
      async reindexRepo(tileId) {
        await hangar.reindexRepo(tileId).catch(() => undefined)
      },
      async removeIndex(tileId) {
        await hangar.removeIndex(tileId).catch(() => undefined)
        const statuses = await hangar.indexStatus()
        dispatch({ type: 'indexStatuses', statuses })
      },
      async spawnTerminal(req, tile) {
        const result = await hangar.spawnTerminal(req)
        // Only tab-mode spawns land in THIS window. Window-mode spawns are
        // owned by the freshly created terminal window (which attaches via
        // its ?sessionId= boot param).
        if (req.mode !== 'window') {
          dispatch({
            type: 'sessionAdd',
            session: {
              id: result.sessionId,
              repoTileId: req.repoTileId,
              agentId: req.agentId,
              title: result.title,
              cwd: tile?.path ?? '',
              createdAt: Date.now(),
              cols: 80,
              rows: 24
            }
          })
        }
      },
      async killTerminal(sessionId) {
        await hangar.killTerminal(sessionId)
        buffer.current.drop(sessionId)
      },
      async closeTab(sessionId) {
        dispatch({ type: 'sessionRemove', sessionId })
        buffer.current.drop(sessionId)
        await hangar.killTerminal(sessionId).catch(() => undefined)
      },
      renameSession(sessionId, title) {
        dispatch({ type: 'sessionRename', sessionId, title })
      },
      noteSessionStatus(sessionId, status) {
        dispatch({ type: 'sessionStatus', sessionId, status })
      },
      drainOutput(sessionId) {
        return buffer.current.drain(sessionId)
      }
    }
  }, [])

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  )
}
