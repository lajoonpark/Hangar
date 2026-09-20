"use strict";
const electron = require("electron");
const IPC = {
  // settings
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsReset: "settings:reset",
  // folders
  foldersScan: "folders:scan",
  foldersAdd: "folders:add",
  foldersRemove: "folders:remove",
  rootsList: "roots:list",
  // agents
  agentsList: "agents:list",
  agentsAdd: "agents:add",
  agentsUpdate: "agents:update",
  agentsDelete: "agents:delete",
  agentsToggleBuiltin: "agents:toggleBuiltin",
  // tiles
  tilesList: "tiles:list",
  // repo index (LanceDB)
  indexStatus: "index:status",
  indexReindex: "index:reindex",
  indexSearch: "index:search",
  indexRemove: "index:remove",
  // terminal
  terminalSpawn: "terminal:spawn",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalList: "terminal:list",
  terminalInput: "terminal:input",
  // window
  windowCreate: "window:create",
  windowClose: "window:close",
  windowToggleSidebar: "window:toggleSidebar",
  // main → renderer events
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  terminalTitle: "terminal:title",
  folderScanProgress: "folder:scanProgress",
  folderScanComplete: "folder:scanComplete",
  gridInvalidate: "grid:invalidate",
  indexProgress: "index:progress",
  indexComplete: "index:complete"
};
const EVENT_CHANNELS = /* @__PURE__ */ new Set([
  IPC.terminalData,
  IPC.terminalExit,
  IPC.terminalTitle,
  IPC.folderScanProgress,
  IPC.folderScanComplete,
  IPC.gridInvalidate,
  IPC.indexProgress,
  IPC.indexComplete
]);
function on(channel, cb) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`[hangar] channel not whitelisted: ${channel}`);
  }
  const handler = (_e, payload) => {
    try {
      cb(payload);
    } catch (err) {
      console.error(`[hangar] listener error on ${channel}:`, err);
    }
  };
  electron.ipcRenderer.on(channel, handler);
  return () => {
    electron.ipcRenderer.removeListener(channel, handler);
  };
}
function unwrap(p) {
  return p.then((r) => {
    if (r && typeof r === "object" && "ok" in r) {
      if (!r.ok) throw new Error(r.error ?? "unknown error");
      return r.data;
    }
    return r;
  });
}
const api = {
  // ── settings ──────────────────────────────────────────────────────────
  getSettings: () => unwrap(electron.ipcRenderer.invoke(IPC.settingsGet)),
  setSettings: (partial) => unwrap(electron.ipcRenderer.invoke(IPC.settingsSet, partial)),
  resetSettings: () => unwrap(electron.ipcRenderer.invoke(IPC.settingsReset)),
  // ── folders ───────────────────────────────────────────────────────────
  addFolders: () => unwrap(electron.ipcRenderer.invoke(IPC.foldersAdd)),
  listFolders: () => unwrap(electron.ipcRenderer.invoke(IPC.rootsList)),
  removeFolder: (rootFolderId) => unwrap(electron.ipcRenderer.invoke(IPC.foldersRemove, rootFolderId)),
  scanFolder: (rootFolderId) => unwrap(electron.ipcRenderer.invoke(IPC.foldersScan, rootFolderId)).then(() => void 0),
  scanAllFolders: () => unwrap(electron.ipcRenderer.invoke(IPC.foldersScan)).then(() => void 0),
  // ── agents ────────────────────────────────────────────────────────────
  listAgents: () => unwrap(electron.ipcRenderer.invoke(IPC.agentsList)),
  addAgent: (payload) => unwrap(electron.ipcRenderer.invoke(IPC.agentsAdd, payload)),
  updateAgent: (agent) => unwrap(electron.ipcRenderer.invoke(IPC.agentsUpdate, agent)),
  deleteAgent: (agentId) => unwrap(electron.ipcRenderer.invoke(IPC.agentsDelete, agentId)),
  toggleBuiltinAgent: (agentId, disabled) => unwrap(electron.ipcRenderer.invoke(IPC.agentsToggleBuiltin, agentId, disabled)),
  // ── repo tiles ────────────────────────────────────────────────────────
  listTiles: () => unwrap(electron.ipcRenderer.invoke(IPC.tilesList)),
  // ── repo index ────────────────────────────────────────────────────────
  indexStatus: (repoTileId) => unwrap(electron.ipcRenderer.invoke(IPC.indexStatus, repoTileId)),
  reindexRepo: (repoTileId) => unwrap(electron.ipcRenderer.invoke(IPC.indexReindex, repoTileId)).then(() => void 0),
  searchRepo: (req) => unwrap(electron.ipcRenderer.invoke(IPC.indexSearch, req)),
  removeIndex: (repoTileId) => unwrap(electron.ipcRenderer.invoke(IPC.indexRemove, repoTileId)),
  // ── terminal ──────────────────────────────────────────────────────────
  spawnTerminal: (req) => unwrap(electron.ipcRenderer.invoke(IPC.terminalSpawn, req)),
  terminalInput: (sessionId, data) => electron.ipcRenderer.send(IPC.terminalInput, sessionId, data),
  terminalResize: (sessionId, cols, rows) => unwrap(electron.ipcRenderer.invoke(IPC.terminalResize, sessionId, cols, rows)),
  killTerminal: (sessionId) => unwrap(electron.ipcRenderer.invoke(IPC.terminalKill, sessionId)),
  listSessions: () => unwrap(electron.ipcRenderer.invoke(IPC.terminalList)),
  // ── windows ───────────────────────────────────────────────────────────
  createWindow: (kind) => unwrap(electron.ipcRenderer.invoke(IPC.windowCreate, kind)),
  closeWindow: (windowId) => unwrap(electron.ipcRenderer.invoke(IPC.windowClose, windowId)),
  toggleSidebar: () => electron.ipcRenderer.send(IPC.windowToggleSidebar),
  // ── main → renderer events ────────────────────────────────────────────
  onTerminalData: (cb) => on(
    IPC.terminalData,
    (p) => cb(p)
  ),
  onTerminalExit: (cb) => on(IPC.terminalExit, (p) => cb(p)),
  onTerminalTitle: (cb) => on(IPC.terminalTitle, (p) => cb(p)),
  onScanProgress: (cb) => on(IPC.folderScanProgress, (p) => cb(p)),
  onScanComplete: (cb) => on(IPC.folderScanComplete, (p) => cb(p)),
  onGridInvalidate: (cb) => on(IPC.gridInvalidate, () => cb()),
  onIndexProgress: (cb) => on(IPC.indexProgress, (p) => cb(p)),
  onIndexComplete: (cb) => on(IPC.indexComplete, (p) => cb(p))
};
electron.contextBridge.exposeInMainWorld("hangar", api);
