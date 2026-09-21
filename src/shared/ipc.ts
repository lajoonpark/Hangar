/**
 * Canonical list of IPC channels.
 *
 * `invoke` channels are request/response: renderer calls window.api.<fn>().
 * `event` channels are main → renderer pushes, received via window.api.on*().
 *
 * The preload bridge (src/preload/index.ts) whitelists exactly these channels.
 */

export const IPC = {
  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  // folders
  foldersScan: 'folders:scan',
  foldersAdd: 'folders:add',
  foldersRemove: 'folders:remove',
  rootsList: 'roots:list',

  // agents
  agentsList: 'agents:list',
  agentsAdd: 'agents:add',
  agentsUpdate: 'agents:update',
  agentsDelete: 'agents:delete',
  agentsToggleBuiltin: 'agents:toggleBuiltin',
  agentsSetTabLabel: 'agents:setTabLabel',

  // tiles
  tilesList: 'tiles:list',

  // repo index (LanceDB)
  indexStatus: 'index:status',
  indexReindex: 'index:reindex',
  indexSearch: 'index:search',
  indexRemove: 'index:remove',

  // terminal
  terminalSpawn: 'terminal:spawn',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalList: 'terminal:list',
  terminalInput: 'terminal:input',
  terminalRefresh: 'terminal:refresh',

  // window
  windowCreate: 'window:create',
  windowClose: 'window:close',
  windowToggleSidebar: 'window:toggleSidebar',

  // main → renderer events
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  terminalTitle: 'terminal:title',
  terminalStatus: 'terminal:status',
  folderScanProgress: 'folder:scanProgress',
  folderScanComplete: 'folder:scanComplete',
  gridInvalidate: 'grid:invalidate',
  indexProgress: 'index:progress',
  indexComplete: 'index:complete'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
