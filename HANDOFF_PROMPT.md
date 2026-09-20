# Handoff Prompt: Repo Terminal Launcher (Electron + React + xterm.js)

## 1. Goal
Build a cross-platform desktop app (Electron) that lets developers manage and launch terminal-based coding agents (kilo, opencode, Claude Code, aider, custom commands) directly into their repositories. Users select one or more "root folders" containing repos; the app displays each immediate child folder as a tile in a grid. Clicking a tile opens an agent picker; selecting an agent spawns an embedded xterm.js terminal (via node-pty) already `cd`'d into that repo. The app supports both tabbed terminals within a window and multiple windows, with settings persisted via electron-store.

## 2. Context
- **New project** — no existing code in `/Users/lajoonpark/VS repos/Hangar` except this prompt.
- **Target platforms**: macOS (primary), Windows, Linux (Electron handles cross-platform).
- **Node**: 22 LTS. **Package manager**: npm or pnpm (your choice).
- **Distribution**: electron-builder (dmg/exe/AppImage), no auto-updates for v1.

## 3. Requirements

### Tech Stack
| Layer | Choice |
|-------|--------|
| Framework | Electron 30+ (latest stable) |
| Frontend | React 18 + TypeScript |
| Build | Vite 5+ (with @vitejs/plugin-react) |
| Terminal | xterm.js 5+ + @xterm/addon-fit + @xterm/addon-web-links + node-pty |
| Styling | Tailwind CSS 3+ |
| State | React Context + useReducer (or Zustand if preferred) |
| Settings | electron-store (JSON file in userData) |
| IPC | contextBridge (secure preload) |
| Packaging | electron-builder |

### Data Models (TypeScript interfaces)
```typescript
// Stored in electron-store
interface AppSettings {
  rootFolders: string[];           // absolute paths user selected
  customAgents: CustomAgent[];     // user-defined agents
  sortOrder: 'recent' | 'alpha' | 'manual';
  windowMode: 'tabs' | 'windows' | 'both'; // default: 'both'
  theme: 'system' | 'light' | 'dark';
  terminalFontSize: number;
  terminalFontFamily: string;
}

interface CustomAgent {
  id: string;                      // uuid
  name: string;                    // display name
  command: string;                 // e.g., "kilo", "opencode", "claude"
  args?: string[];                 // optional args
  env?: Record<string, string>;    // optional env vars
  useShell: boolean;               // true = run via shell (allows aliases), false = direct exec
  workingDirOverride?: string;     // optional, rarely used
}

interface RepoTile {
  id: string;                      // uuid
  name: string;                    // folder name
  path: string;                    // absolute path
  parentRootId: string;            // which root folder it belongs to
  lastOpenedAt?: number;           // timestamp for recent sort
  openCount: number;               // for usage sorting
}

interface TerminalSession {
  id: string;                      // uuid
  repoTileId: string;              // link to repo
  agentId: string;                 // which agent (builtin or custom)
  title: string;                   // tab/window title
  cwd: string;                     // working directory (starts as repo path)
  ptyProcess?: any;                // node-pty reference (main process only)
  createdAt: number;
}
```

### Built-in Agents (shipped with app)
```typescript
const BUILTIN_AGENTS: CustomAgent[] = [
  { id: 'kilo', name: 'Kilo CLI', command: 'kilo', args: [], useShell: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], useShell: true },
  { id: 'pi', name: 'Pi Coding Agent', command: 'pi', args: [], useShell: true },
  { id: 'claude', name: 'Claude Code', command: 'claude', args: [], useShell: true },
  { id: 'aider', name: 'Aider', command: 'aider', args: [], useShell: true },
  { id: 'cursor', name: 'Cursor Agent', command: 'cursor-agent', args: [], useShell: true },
];
```

### UI/UX Flows

#### First Run
1. Welcome screen → "Add Root Folder" button (native folder picker, multi-select)
2. Scan each root folder: read immediate children (fs.readdir + fs.stat), filter directories only
3. Create RepoTile for each child → display in responsive grid
4. Save rootFolders to settings

#### Main View (Repo Grid)
- Responsive CSS grid (Tailwind): 1 col mobile, 2 tablet, 3-4 desktop, 5+ wide
- Each tile: folder name (truncated with tooltip), subtle icon, last opened badge
- Sort dropdown: Recent (default), Alphabetical, Manual (drag-drop later)
- Header: "Add Folder", Settings, Theme toggle
- Empty state: illustration + "Add Root Folder" CTA

#### Agent Picker (on tile click)
- Modal/popover anchored to tile
- List: built-in agents + custom agents (separated)
- Each row: icon, name, command preview
- "Add Custom Agent" link at bottom → opens settings → agents tab
- Click agent → close picker → spawn terminal

#### Terminal View
**Two window modes (user configurable):**
- **Tabs mode**: Single window, left sidebar (collapsible) shows repo grid, right side has tab bar + xterm.js canvas
- **Windows mode**: Each terminal opens in new BrowserWindow with native tabs (macOS) or custom tab bar
- **Both mode**: User chooses per launch (modifier key? right-click menu?)

**Terminal features:**
- xterm.js with fit addon (resize on window/tab change)
- Web links addon (clickable URLs, file paths)
- Copy/paste (Cmd+C/V), select text, scrollback (10k lines)
- Terminal title shows `agent @ repo` (e.g., `kilo @ hangar`)
- Close tab/window → kill PTY process gracefully (SIGTERM then SIGKILL)
- Shell detection: use `process.env.SHELL` or default `/bin/bash` (macOS/Linux), `powershell.exe` (Windows)

#### Settings Window
Tabs: General | Agents | Appearance | Advanced
- **General**: root folder list (add/remove/reorder), sort order, window mode, startup behavior
- **Agents**: list built-in (disable toggle) + custom agents (CRUD form with advanced collapsible section)
- **Appearance**: theme, font size/family, grid density
- **Advanced**: data folder location, reset to defaults, export/import settings

### IPC Channels (preload.ts)
```typescript
// Main → Renderer (invoke)
'settings:get', 'settings:set', 'settings:reset'
'folders:scan', 'folders:add', 'folders:remove'
'agents:list', 'agents:add', 'agents:update', 'agents:delete', 'agents:toggleBuiltin'
'terminal:spawn', 'terminal:resize', 'terminal:kill', 'terminal:list'
'window:create', 'window:close', 'window:toggleSidebar'

// Renderer → Main (on)
'terminal:data', 'terminal:exit', 'terminal:title'
'folder:scanProgress', 'folder:scanComplete'
```

### Main Process Responsibilities
- `node-pty` spawn/management (one PTY per terminal session)
- Folder scanning (debounced, cancellable, background)
- Settings persistence (electron-store)
- Window lifecycle (create/close/track)
- Auto-launch agent command: `cd ${repoPath} && ${agentCommand} ${args.join(' ')}`
- Secure preload script (contextIsolation: true, sandbox: false for node-pty)

### Renderer Responsibilities
- React UI (grid, modals, tabs, settings)
- xterm.js terminal components (one per session)
- Terminal I/O: send keystrokes → main via IPC, receive stdout → xterm.write()
- Resize handling: window/tab resize → fit addon → IPC resize → pty.resize()
- Theme sync (system preference + manual override)

## 4. Edge Cases / Considerations

| Area | Concern | Handling |
|------|---------|----------|
| **Large folder scans** | 10k+ directories blocks UI | Worker thread or chunked async with progress events; cache results; debounce re-scans |
| **node-pty native build** | Requires Python + build tools on user machine | Bundle prebuilt binaries via `@electron/rebuild` or `electron-builder` native deps; test on clean machine |
| **PTY cleanup** | Orphaned processes on crash | Track PIDs; on app quit, kill all child processes; use `process.on('exit')` |
| **Shell vs direct exec** | Aliases/functions only work in shell | `useShell: true` runs via `$SHELL -c "cmd"`; `false` uses `spawn` directly |
| **Windows paths** | Backslashes, drive letters | Normalize to POSIX in app; node-pty handles Windows ConPTY |
| **Terminal resize race** | xterm.fit() vs pty.resize() order | Debounce resize; call fit() then pty.resize(cols, rows) |
| **Custom command not found** | User types `kilo` but not in PATH | Spawn via shell (useShell=true) so PATH works; show error in terminal if exit code 127 |
| **Multi-window state** | Sync sidebar across windows | Broadcast repo grid updates via IPC to all windows |
| **First-run permissions** | macOS full disk access for folder scanning | Prompt user; show instructions if denied |
| **Settings migration** | Schema changes later | Version settings; migrate on load |

## 5. Ask
Implement the complete Electron + React + TypeScript application as specified above. Deliver:

1. **Project structure** with Vite + Electron (main + preload + renderer)
2. **Main process**: settings store, folder scanner, PTY manager, window manager, IPC handlers
3. **Preload script**: secure contextBridge exposing only defined channels
4. **Renderer (React + Tailwind)**:
   - Welcome/first-run flow
   - Repo grid with responsive tiles, sort, empty state
   - Agent picker modal
   - Terminal component (xterm.js wrapper with fit/web-links)
   - Tabbed terminal container (sidebar + tab bar + terminal area)
   - Settings window (4 tabs)
   - Multi-window support (tabs mode / windows mode / both)
4. **electron-builder config** for macOS (dmg), Windows (nsis), Linux (AppImage)
5. **README** with dev/prod commands, build instructions, troubleshooting

**Start with**: `npm create vite@latest . -- --template react-ts` then add Electron. Use `electron-vite` or manual Vite config — your call.

**Priority order**:
1. Core: folder scan → grid → agent picker → single terminal (tabs mode)
2. Settings persistence + custom agents
3. Multi-window / windows mode
4. Polish: themes, animations, keyboard shortcuts, error states

No auto-updater, no telemetry, no network calls. Pure local-first app.
