import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentDefinition,
  NewAgentPayload,
  RepoSearchRequest,
  SpawnRequest
} from '@shared/types'
import { agentService } from './agents'
import { ptyManager } from './pty'
import { repoIndexService } from './repoIndex'
import { scannerService } from './scanner'
import { settingsService } from './settings'
import { windowManager } from './windows'

/**
 * IPC handler registration. Every channel whitelisted in the preload bridge
 * is handled here. All invoke handlers return { ok, data?, error? } where a
 * thrown error becomes { ok: false, error: message }.
 */

function wrap<T>(fn: () => T | Promise<T>): Promise<{ ok: boolean; data?: T; error?: string }> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true, data }))
    .catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
}

export function registerIpcHandlers(): void {
  // Broadcast wiring for services that emit main→renderer events
  scannerService.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload))
  ptyManager.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload))
  repoIndexService.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload))

  // ── settings ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.settingsGet, () => wrap(() => settingsService.get()))

  ipcMain.handle(IPC.settingsSet, (_e, partial: Record<string, unknown>) => {
    const result = settingsService.update(partial as never)
    if (result.ok) {
      // Settings changed → other windows should re-read (theme, sort, agents…)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'settings-changed' })
    }
    return result
  })

  ipcMain.handle(IPC.settingsReset, () => wrap(() => settingsService.reset()))

  // ── folders ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC.foldersAdd, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await (win && !win.isDestroyed()
        ? dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'multiSelections'],
            title: 'Add root folders containing your repos',
            buttonLabel: 'Add'
          })
        : dialog.showOpenDialog({
            properties: ['openDirectory', 'multiSelections'],
            title: 'Add root folders containing your repos',
            buttonLabel: 'Add'
          }))
      if (result.canceled || result.filePaths.length === 0) return []
      const current = settingsService.get().rootFolders
      const merged = [...current, ...result.filePaths]
      const updated = settingsService.update({ rootFolders: merged })
      if (!updated.ok) throw new Error(updated.error)
      scannerService.syncRoots()
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'folders-changed' })
      return scannerService.listRoots()
    })
  )

  ipcMain.handle(IPC.foldersRemove, (_e, rootFolderId: string) =>
    wrap(async () => {
      const root = scannerService.listRoots().find((r) => r.id === rootFolderId)
      if (!root) throw new Error(`Unknown root folder: ${rootFolderId}`)
      const tilesUnderRoot = scannerService.listTiles().filter((t) => t.parentRootId === rootFolderId)
      const current = settingsService.get().rootFolders
      const updated = settingsService.update({
        rootFolders: current.filter((p) => p !== root.path)
      })
      if (!updated.ok) throw new Error(updated.error)
      scannerService.syncRoots()
      // Drop indexes for every repo that lived under the removed root
      for (const tile of tilesUnderRoot) {
        void repoIndexService.remove(tile.id).catch(() => undefined)
      }
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'folders-changed' })
    })
  )

  ipcMain.handle(IPC.foldersScan, (_e, rootFolderId?: string) =>
    wrap(() => {
      scannerService.syncRoots()
      if (rootFolderId) scannerService.scan(rootFolderId)
      else scannerService.scanAll()
    })
  )

  ipcMain.handle(IPC.rootsList, () => wrap(() => scannerService.listRoots()))

  // ── agents ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.agentsList, () => wrap(() => agentService.listAll()))

  ipcMain.handle(IPC.agentsAdd, (_e, payload: NewAgentPayload) =>
    wrap(() => {
      const result = agentService.add(payload)
      if (!result.ok) throw new Error(result.error)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'agents-changed' })
      return result.data as AgentDefinition
    })
  )

  ipcMain.handle(IPC.agentsUpdate, (_e, agent: AgentDefinition) =>
    wrap(() => {
      const result = agentService.update(agent)
      if (!result.ok) throw new Error(result.error)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'agents-changed' })
    })
  )

  ipcMain.handle(IPC.agentsDelete, (_e, agentId: string) =>
    wrap(() => {
      const result = agentService.delete(agentId)
      if (!result.ok) throw new Error(result.error)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'agents-changed' })
    })
  )

  ipcMain.handle(IPC.agentsToggleBuiltin, (_e, agentId: string, disabled: boolean) =>
    wrap(() => {
      const result = agentService.toggleBuiltin(agentId, Boolean(disabled))
      if (!result.ok) throw new Error(result.error)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'agents-changed' })
    })
  )

  ipcMain.handle(IPC.agentsSetTabLabel, (_e, agentId: string, label: string) =>
    wrap(() => {
      const result = agentService.setTabLabel(String(agentId), String(label ?? ''))
      if (!result.ok) throw new Error(result.error)
      windowManager.broadcast(IPC.gridInvalidate, { reason: 'agents-changed' })
    })
  )

  // ── tiles ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.terminalList, () => wrap(() => ptyManager.list()))
  ipcMain.handle(IPC.tilesList, () => wrap(() => scannerService.listTiles()))

  // ── repo index (LanceDB) ──────────────────────────────────────────────
  ipcMain.handle(IPC.indexStatus, (_e, repoTileId?: string) =>
    wrap(() => repoIndexService.status(repoTileId))
  )

  ipcMain.handle(IPC.indexReindex, (_e, repoTileId: string) =>
    wrap(() => {
      const tile = scannerService.listTiles().find((t) => t.id === repoTileId)
      if (!tile) throw new Error(`Unknown repo: ${repoTileId}`)
      repoIndexService.reindex(tile)
    })
  )

  ipcMain.handle(IPC.indexSearch, (_e, req: RepoSearchRequest) =>
    wrap(() => repoIndexService.search(req))
  )

  ipcMain.handle(IPC.indexRemove, (_e, repoTileId: string) =>
    wrap(() => repoIndexService.remove(repoTileId))
  )

  // ── terminal ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.terminalSpawn, (e, req: SpawnRequest) =>
    wrap(async () => {
      const settings = settingsService.get()
      const mode =
        req.mode ?? (settings.windowMode === 'windows' ? 'window' : 'tab')

      if (mode === 'window') {
        // Create the owning window first so the renderer boots with the
        // sessionId in its query params and can attach immediately.
        const windowId = windowManager.create('terminal')
        return await ptyManager.spawn({ ...req, mode, windowId })
      }

      const senderWindow = [...windowManager.all()].find((w) => w.win.webContents === e.sender)
      return await ptyManager.spawn({
        ...req,
        mode,
        windowId: req.windowId ?? senderWindow?.id
      })
    })
  )

  ipcMain.on(IPC.terminalInput, (_e, sessionId: string, data: string) => {
    if (typeof sessionId === 'string' && typeof data === 'string') {
      ptyManager.write(sessionId, data)
    }
  })

  ipcMain.handle(IPC.terminalResize, (_e, sessionId: string, cols: number, rows: number) =>
    wrap(() => ptyManager.resize(sessionId, cols, rows))
  )

  ipcMain.handle(IPC.terminalKill, (_e, sessionId: string) =>
    wrap(() => ptyManager.kill(sessionId))
  )

  // ── windows ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC.windowCreate, (_e, kind: 'main' | 'terminal' = 'main') =>
    wrap(() => windowManager.create(kind === 'terminal' ? 'terminal' : 'main'))
  )

  ipcMain.handle(IPC.windowClose, (_e, windowId: string) =>
    wrap(() => windowManager.close(windowId))
  )

  ipcMain.on(IPC.windowToggleSidebar, () => windowManager.toggleSidebar())
}
