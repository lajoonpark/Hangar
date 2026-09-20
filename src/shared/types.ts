/**
 * Shared types — the single source of truth for the contract between
 * the Electron main process (backend) and the renderer (design agent's UI).
 */

// ── Settings ────────────────────────────────────────────────────────────────

export type SortOrder = 'recent' | 'alpha' | 'manual'
export type WindowMode = 'tabs' | 'windows' | 'both'
export type Theme = 'system' | 'light' | 'dark'

export interface AppSettings {
  rootFolders: string[]
  customAgents: CustomAgent[]
  sortOrder: SortOrder
  windowMode: WindowMode
  theme: Theme
  terminalFontSize: number
  terminalFontFamily: string
  disabledBuiltinAgents: string[]
  /** Local repo indexing (LanceDB full-text index per repo). */
  repoIndexEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  rootFolders: [],
  customAgents: [],
  sortOrder: 'recent',
  windowMode: 'both',
  theme: 'system',
  terminalFontSize: 13,
  terminalFontFamily: 'Menlo, Consolas, monospace',
  disabledBuiltinAgents: [],
  repoIndexEnabled: true
}

// ── Agents ──────────────────────────────────────────────────────────────────

export interface CustomAgent {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  useShell: boolean
  workingDirOverride?: string
}

export interface AgentDefinition extends CustomAgent {
  builtin: boolean
  disabled?: boolean
}

export const BUILTIN_AGENTS: CustomAgent[] = [
  { id: 'kilo', name: 'Kilo CLI', command: 'kilo', args: [], useShell: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], useShell: true },
  { id: 'pi', name: 'Pi Coding Agent', command: 'pi', args: [], useShell: true },
  { id: 'claude', name: 'Claude Code', command: 'claude', args: [], useShell: true },
  { id: 'aider', name: 'Aider', command: 'aider', args: [], useShell: true },
  { id: 'cursor', name: 'Cursor Agent', command: 'cursor-agent', args: [], useShell: true }
]

// ── Repos / tiles ───────────────────────────────────────────────────────────

export interface RootFolder {
  id: string
  path: string
  name: string
}

export interface RepoTile {
  id: string
  name: string
  path: string
  parentRootId: string
  lastOpenedAt?: number
  openCount: number
}

export interface ScanProgress {
  rootId: string
  scanned: number
  total?: number
}

export interface ScanResult {
  rootId: string
  tiles: RepoTile[]
  error?: string
}

// ── Terminal sessions ───────────────────────────────────────────────────────

export interface TerminalSessionInfo {
  id: string
  repoTileId: string
  agentId: string
  title: string
  cwd: string
  createdAt: number
  /** Last known number of columns the renderer wrote to */
  cols: number
  rows: number
}

export interface SpawnRequest {
  repoTileId: string
  agentId: string
  /** which window should own the terminal (tabs mode / new window) */
  mode?: 'tab' | 'window'
  windowId?: string
}

export interface SpawnResult {
  sessionId: string
  windowId: string
  title: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
  signal?: string
}

export interface TerminalTitleEvent {
  sessionId: string
  title: string
}

// ── Repo indexing (LanceDB) ─────────────────────────────────────────────────

export type RepoIndexState = 'none' | 'queued' | 'indexing' | 'ready' | 'error'

/**
 * Per-repo index status. The UI shows this as a badge on the repo tile and in
 * the settings/index panel. `files`/`chunks` are 0 until the first index run.
 */
export interface RepoIndexStatus {
  repoTileId: string
  repoPath: string
  repoName: string
  state: RepoIndexState
  /** Files covered by the last completed index run. */
  files: number
  /** Searchable text chunks stored in LanceDB. */
  chunks: number
  /** Epoch ms of the last completed index run, if any. */
  indexedAt?: number
  /** Last error message when state === 'error'. */
  error?: string
}

export type IndexPhase = 'walk' | 'chunk' | 'write' | 'search-index'

export interface RepoIndexProgress {
  repoTileId: string
  phase: IndexPhase
  filesIndexed: number
  totalFiles: number
}

export interface RepoIndexCompleteEvent {
  repoTileId: string
  ok: boolean
  files: number
  chunks: number
  durationMs: number
  error?: string
}

export interface RepoSearchRequest {
  repoTileId: string
  /** Full-text query (terms ANDed; special characters are ignored). */
  query: string
  /** Max hits to return (default 20, hard cap 100). */
  limit?: number
  /** Restrict results to paths under this prefix (repo-relative). */
  pathPrefix?: string
}

export interface RepoSearchHit {
  /** Repo-relative file path. */
  path: string
  startLine: number
  endLine: number
  lang: string
  /** Relevance score (BM25, higher = better). 0 for fallback matches. */
  score: number
  /** Short excerpt of the matching chunk. */
  snippet: string
}

export interface RepoSearchResponse {
  repoTileId: string
  query: string
  hits: RepoSearchHit[]
  durationMs: number
  /** Present when the search fell back to plain substring matching. */
  fallback?: boolean
  error?: string
}

// ── Generic payloads ────────────────────────────────────────────────────────

export interface NewAgentPayload {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  useShell: boolean
  workingDirOverride?: string
}

export interface Result<T = void> {
  ok: boolean
  data?: T
  error?: string
}
