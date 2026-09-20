import { createHash, randomUUID } from 'crypto'
import { promises as fs, Dirent } from 'fs'
import path from 'path'
import { RepoTile, RootFolder, ScanProgress, ScanResult } from '@shared/types'
import { IPC } from '@shared/ipc'
import { settingsService } from './settings'

/**
 * Folder scanning service.
 *
 * - Reads immediate children of each root folder, directories only.
 * - Chunked with yields to the event loop so huge folders (10k+) never
 *   block the main process; emits progress events per chunk.
 * - Cancellable: a newer scan for the same root supersedes the running one.
 * - Debounced: multiple requests for the same root inside the debounce
 *   window coalesce into one scan.
 * - Results cached in memory and merged with persisted tile metadata
 *   (lastOpenedAt / openCount survive restarts).
 */

const CHUNK_SIZE = 200
const DEBOUNCE_MS = 150
const IGNORED = new Set(['node_modules', '.git', 'Library', 'lost+found', '$RECYCLE.BIN', 'System Volume Information'])

interface ScanState {
  token: number
  timer?: NodeJS.Timeout
  pending: boolean
}

class ScannerService {
  private rootRegistry = new Map<string, RootFolder>() // id -> root
  private tileCache = new Map<string, RepoTile>() // tile.id -> tile
  private scanState = new Map<string, ScanState>() // rootId -> state
  private broadcast: (channel: string, payload: unknown) => void = () => {}

  /** Injected by ipc.ts — broadcasts events to all windows. */
  setBroadcast(fn: (channel: string, payload: unknown) => void): void {
    this.broadcast = fn
  }

  /**
   * Stable id for a root path (survives restarts, no separate persistence
   * needed). Re-syncs the registry against settings.rootFolders.
   */
  syncRoots(): RootFolder[] {
    const paths = settingsService.rootFolderPaths()
    const byPath = new Map([...this.rootRegistry.values()].map((r) => [r.path, r]))
    const next = new Map<string, RootFolder>()
    for (const p of paths) {
      const existing = byPath.get(p)
      if (existing) {
        next.set(existing.id, existing)
      } else {
        const id = stableId(p)
        next.set(id, { id, path: p, name: path.basename(p) || p })
      }
    }
    this.rootRegistry = next
    return [...next.values()]
  }

  listRoots(): RootFolder[] {
    return this.syncRoots()
  }

  /**
   * Scan a root folder (debounced). Tiles are delivered via the
   * `folder:scanProgress` and `folder:scanComplete` events.
   */
  scan(rootFolderId: string, immediate = false): void {
    const root = this.rootRegistry.get(rootFolderId)
    if (!root) return

    let state = this.scanState.get(rootFolderId)
    if (!state) {
      state = { token: 0, pending: false }
      this.scanState.set(rootFolderId, state)
    }

    if (state.timer) clearTimeout(state.timer)
    if (immediate) {
      void this.runScan(root, state)
      return
    }
    state.timer = setTimeout(() => {
      state!.timer = undefined
      void this.runScan(root, state!)
    }, DEBOUNCE_MS)
  }

  scanAll(immediate = false): void {
    for (const root of this.rootRegistry.values()) this.scan(root.id, immediate)
  }

  private async runScan(root: RootFolder, state: ScanState): Promise<void> {
    const token = ++state.token

    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(root.path, { withFileTypes: true })
    } catch (err) {
      const result: ScanResult = {
        rootId: root.id,
        tiles: [],
        error: `Cannot read ${root.path}: ${err instanceof Error ? err.message : String(err)}`
      }
      this.broadcast(IPC.folderScanComplete, result)
      return
    }

    // Directories only, skip hidden + noise
    const candidates = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !IGNORED.has(d.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    const tiles: RepoTile[] = []
    const total = candidates.length
    let scanned = 0

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      if (state.token !== token) return // superseded — abort silently
      const chunk = candidates.slice(i, i + CHUNK_SIZE)
      for (const dirent of chunk) {
        const dirPath = path.join(root.path, dirent.name)
        scanned++
        try {
          // stat to make sure it's readable (broken symlinks etc.)
          await fs.stat(dirPath)
          tiles.push({
            id: stableId(dirPath),
            name: dirent.name,
            path: dirPath,
            parentRootId: root.id,
            openCount: this.tileCache.get(stableId(dirPath))?.openCount ?? 0,
            lastOpenedAt: this.tileCache.get(stableId(dirPath))?.lastOpenedAt
          })
        } catch {
          // unreadable child — skip
        }
      }
      this.broadcast(IPC.folderScanProgress, {
        rootId: root.id,
        scanned,
        total
      } satisfies ScanProgress)
      // Yield to the event loop so IPC + PTY I/O stay responsive
      await new Promise((r) => setImmediate(r))
    }

    if (state.token !== token) return

    for (const tile of tiles) this.tileCache.set(tile.id, tile)
    this.broadcast(IPC.folderScanComplete, { rootId: root.id, tiles } satisfies ScanResult)
  }

  /** Cached tiles across all roots. */
  cachedTiles(): RepoTile[] {
    return [...this.tileCache.values()]
  }

  /** Merge freshly scanned tiles into cache (preserving usage metadata). */
  mergeTiles(incoming: RepoTile[]): void {
    for (const tile of incoming) this.tileCache.set(tile.id, tile)
  }

  /** Persist usage metadata when a repo is opened. */
  recordOpen(tileId: string): void {
    const existing = this.tileCache.get(tileId)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      existing.openCount += 1
    }
  }

  listTiles(): RepoTile[] {
    return sortTiles([...this.tileCache.values()], settingsService.get().sortOrder)
  }
}

export function sortTiles(tiles: RepoTile[], order: 'recent' | 'alpha' | 'manual'): RepoTile[] {
  const copy = [...tiles]
  switch (order) {
    case 'recent':
      return copy.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name))
    case 'manual':
    case 'alpha':
    default:
      return copy.sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** Stable, filesystem-safe id from an absolute path. */
function stableId(absPath: string): string {
  return createHash('sha1').update(absPath).digest('hex').slice(0, 16)
}

export { randomUUID }
export const scannerService = new ScannerService()
