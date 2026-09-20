"use strict";
const electron = require("electron");
const crypto = require("crypto");
const Store = require("electron-store");
const events = require("events");
const os = require("os");
const path = require("path");
const lancedb = require("@lancedb/lancedb");
const fs = require("fs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const lancedb__namespace = /* @__PURE__ */ _interopNamespaceDefault(lancedb);
const DEFAULT_SETTINGS = {
  rootFolders: [],
  customAgents: [],
  sortOrder: "recent",
  windowMode: "both",
  theme: "system",
  terminalFontSize: 13,
  terminalFontFamily: "Menlo, Consolas, monospace",
  disabledBuiltinAgents: [],
  repoIndexEnabled: true
};
const BUILTIN_AGENTS = [
  { id: "kilo", name: "Kilo CLI", command: "kilo", args: [], useShell: true },
  { id: "opencode", name: "OpenCode", command: "opencode", args: [], useShell: true },
  { id: "pi", name: "Pi Coding Agent", command: "pi", args: [], useShell: true },
  { id: "claude", name: "Claude Code", command: "claude", args: [], useShell: true },
  { id: "aider", name: "Aider", command: "aider", args: [], useShell: true },
  { id: "cursor", name: "Cursor Agent", command: "cursor-agent", args: [], useShell: true }
];
const SCHEMA_VERSION = 3;
const migrations = {
  // v1 → v2: added disabledBuiltinAgents
  1: (prev) => {
    const next = { ...DEFAULT_SETTINGS, ...prev };
    next.disabledBuiltinAgents = [];
    next.__schemaVersion = SCHEMA_VERSION;
    return next;
  },
  // v2 → v3: added repoIndexEnabled
  2: (prev) => {
    const next = { ...DEFAULT_SETTINGS, ...prev };
    next.repoIndexEnabled = true;
    next.__schemaVersion = SCHEMA_VERSION;
    return next;
  }
};
function applyMigrations(raw) {
  let version = raw.__schemaVersion ?? 1;
  let current = { ...raw };
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) break;
    current = migrate(current);
    current.__schemaVersion = version + 1;
    version++;
  }
  const merged = { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION, ...current };
  merged.__schemaVersion = SCHEMA_VERSION;
  return merged;
}
function validate(settings) {
  const errors = [];
  if (!Array.isArray(settings.rootFolders)) errors.push("rootFolders must be an array");
  if (!["recent", "alpha", "manual"].includes(settings.sortOrder))
    errors.push(`invalid sortOrder: ${String(settings.sortOrder)}`);
  if (!["tabs", "windows", "both"].includes(settings.windowMode))
    errors.push(`invalid windowMode: ${String(settings.windowMode)}`);
  if (!["system", "light", "dark"].includes(settings.theme))
    errors.push(`invalid theme: ${String(settings.theme)}`);
  if (typeof settings.terminalFontSize !== "number" || settings.terminalFontSize < 8 || settings.terminalFontSize > 32)
    errors.push("terminalFontSize must be a number between 8 and 32");
  if (typeof settings.terminalFontFamily !== "string")
    errors.push("terminalFontFamily must be a string");
  if (typeof settings.repoIndexEnabled !== "boolean")
    errors.push("repoIndexEnabled must be a boolean");
  return errors;
}
function dedupePaths(paths) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const p of paths) {
    const norm = p.replace(/\/+$/, "");
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
const SETTING_KEYS = [
  "rootFolders",
  "customAgents",
  "sortOrder",
  "windowMode",
  "theme",
  "terminalFontSize",
  "terminalFontFamily",
  "disabledBuiltinAgents",
  "repoIndexEnabled"
];
class SettingsService {
  store;
  cache;
  constructor() {
    this.store = new Store({
      name: "hangar-settings",
      defaults: { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION }
    });
    this.cache = applyMigrations(this.store.store);
    this.cache.customAgents = this.sanitizeAgents(this.cache.customAgents);
    this.cache.rootFolders = dedupePaths(
      this.cache.rootFolders.filter((p) => typeof p === "string" && p.length > 0)
    );
    this.persist();
  }
  sanitizeAgents(agents) {
    if (!Array.isArray(agents)) return [];
    return agents.filter((a) => {
      const rec = a;
      return !!rec && typeof rec.id === "string" && typeof rec.name === "string" && typeof rec.command === "string";
    }).map((a) => ({
      ...a,
      args: Array.isArray(a.args) ? a.args.map(String) : [],
      env: a.env && typeof a.env === "object" ? a.env : {},
      useShell: a.useShell !== false
    }));
  }
  persist() {
    this.store.set(this.cache);
  }
  get() {
    const { __schemaVersion, ...settings } = this.cache;
    return settings;
  }
  /** Merge a partial update. Unknown keys ignored; invalid values rejected. */
  update(partial) {
    const next = { ...this.cache };
    for (const key of SETTING_KEYS) {
      if (key in partial) {
        next[key] = partial[key];
      }
    }
    if ("rootFolders" in partial) {
      next.rootFolders = dedupePaths(
        next.rootFolders.filter((p) => typeof p === "string" && p.length > 0)
      );
    }
    next.customAgents = this.sanitizeAgents(next.customAgents);
    const errors = validate(next);
    if (errors.length > 0) {
      return { ok: false, error: errors.join("; ") };
    }
    this.cache = next;
    this.persist();
    const { __schemaVersion: _, ...result } = this.cache;
    return { ok: true, data: result };
  }
  reset() {
    this.cache = { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION };
    this.persist();
    const { __schemaVersion, ...settings } = this.cache;
    return settings;
  }
  isBuiltinDisabled(agentId) {
    return this.cache.disabledBuiltinAgents.includes(agentId);
  }
  /** Merge a partial update. Unknown keys ignored; invalid values rejected. */
  setBuiltinDisabled(agentId, disabled) {
    const set = new Set(this.cache.disabledBuiltinAgents);
    if (disabled) set.add(agentId);
    else set.delete(agentId);
    return this.update({ disabledBuiltinAgents: [...set] });
  }
  /** Absolute paths of all configured root folders. */
  rootFolderPaths() {
    return [...this.cache.rootFolders];
  }
}
const settingsService = new SettingsService();
function toDefinition(a, builtin, disabled = false) {
  return { ...a, builtin, disabled: builtin ? disabled : void 0 };
}
class AgentService {
  /**
   * All agents available to the picker: built-ins (unless disabled) then
   * user-defined, in creation order.
   */
  list() {
    const disabled = new Set(settingsService.get().disabledBuiltinAgents);
    const builtins = BUILTIN_AGENTS.map((a) => toDefinition(a, true, disabled.has(a.id)));
    const customs = settingsService.get().customAgents.map((a) => toDefinition(a, false));
    return [...builtins.filter((a) => !a.disabled), ...customs];
  }
  /** Every agent incl. disabled built-ins (settings UI needs full list). */
  listAll() {
    const disabled = new Set(settingsService.get().disabledBuiltinAgents);
    const builtins = BUILTIN_AGENTS.map((a) => toDefinition(a, true, disabled.has(a.id)));
    const customs = settingsService.get().customAgents.map((a) => toDefinition(a, false));
    return [...builtins, ...customs];
  }
  /** Resolve one agent by id (builtin or custom). */
  byId(agentId) {
    return this.listAll().find((a) => a.id === agentId);
  }
  add(payload) {
    const errors = [];
    if (!payload.name?.trim()) errors.push("name is required");
    if (!payload.command?.trim()) errors.push("command is required");
    if (payload.args && !Array.isArray(payload.args)) errors.push("args must be an array");
    if (errors.length > 0) return { ok: false, error: errors.join("; ") };
    const agent = {
      id: crypto.randomUUID(),
      name: payload.name.trim(),
      command: payload.command.trim(),
      args: Array.isArray(payload.args) ? payload.args.map(String) : [],
      env: payload.env && typeof payload.env === "object" ? { ...payload.env } : {},
      useShell: payload.useShell !== false,
      workingDirOverride: payload.workingDirOverride || void 0
    };
    const settings = settingsService.get();
    const result = settingsService.update({
      customAgents: [...settings.customAgents, agent]
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, data: toDefinition(agent, false) };
  }
  update(agent) {
    if (agent.builtin) return { ok: false, error: "cannot edit built-in agents" };
    const settings = settingsService.get();
    const idx = settings.customAgents.findIndex((a) => a.id === agent.id);
    if (idx === -1) return { ok: false, error: `unknown agent: ${agent.id}` };
    const updated = {
      id: agent.id,
      name: agent.name?.trim() || settings.customAgents[idx].name,
      command: agent.command?.trim() || settings.customAgents[idx].command,
      args: Array.isArray(agent.args) ? agent.args.map(String) : [],
      env: agent.env && typeof agent.env === "object" ? { ...agent.env } : {},
      useShell: agent.useShell !== false,
      workingDirOverride: agent.workingDirOverride || void 0
    };
    const next = [...settings.customAgents];
    next[idx] = updated;
    const result = settingsService.update({ customAgents: next });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  delete(agentId) {
    const settings = settingsService.get();
    const idx = settings.customAgents.findIndex((a) => a.id === agentId);
    if (idx === -1) return { ok: false, error: `unknown agent: ${agentId}` };
    const next = settings.customAgents.filter((a) => a.id !== agentId);
    const result = settingsService.update({ customAgents: next });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  toggleBuiltin(agentId, disabled) {
    const isBuiltin = BUILTIN_AGENTS.some((a) => a.id === agentId);
    if (!isBuiltin) return { ok: false, error: `not a built-in agent: ${agentId}` };
    const result = settingsService.setBuiltinDisabled(agentId, disabled);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
}
const agentService = new AgentService();
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
  terminalRefresh: "terminal:refresh",
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
const DB_DIR_NAME = "repo-index.lance";
const META_TABLE = "_meta";
const TABLE_PREFIX = "repo_";
const MAX_FILES = 5e3;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CHUNK_LINES = 120;
const MAX_CHUNK_CHARS = 8e3;
const ADD_BATCH = 500;
const WALK_CHUNK = 100;
const STALE_MS = 60 * 60 * 1e3;
const PROGRESS_EVERY_MS = 200;
const SNIPPET_LEN = 240;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",
  "vendor",
  "Pods",
  "DerivedData",
  ".gradle",
  ".idea",
  ".vscode",
  ".kilo",
  ".zig-cache",
  "zig-out",
  ".lance",
  ".store",
  ".svelte-kit",
  "bower_components"
]);
const TEXT_EXTS = /* @__PURE__ */ new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "txt",
  "rst",
  "adoc",
  "py",
  "pyi",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "hh",
  "m",
  "mm",
  "cs",
  "dart",
  "zig",
  "php",
  "lua",
  "pl",
  "pm",
  "ex",
  "exs",
  "erl",
  "hrl",
  "clj",
  "cljs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "env",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  "html",
  "htm",
  "vue",
  "svelte",
  "astro",
  "ejs",
  "hbs",
  "liquid",
  "sql",
  "graphql",
  "gql",
  "proto",
  "tf",
  "tfvars",
  "hcl",
  "xml",
  "svg",
  "csv",
  "tsv",
  "gradle",
  "groovy",
  "cmake",
  "dockerfile",
  "lock",
  "sum",
  "mod",
  "gemspec",
  "podspec"
]);
const TEXT_FILENAMES = /* @__PURE__ */ new Set([
  "dockerfile",
  "makefile",
  "cmakelists.txt",
  "rakefile",
  "gemfile",
  "procfile",
  "vagrantfile",
  "justfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".babelrc",
  ".eslintrc",
  ".prettierrc",
  ".dockerignore",
  "license",
  "license.md",
  "license.txt",
  "readme",
  "readme.md",
  "changes",
  "changelog",
  "changelog.md",
  "notice"
]);
function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}
function langOf(name) {
  const lower = name.toLowerCase();
  if (TEXT_FILENAMES.has(lower)) return lower.replace(/^./, (c) => c.toUpperCase());
  return extOf(name) || "text";
}
function isTextFile(name) {
  if (name.startsWith(".") && TEXT_FILENAMES.has(name.toLowerCase())) return true;
  if (!name.includes(".")) return TEXT_FILENAMES.has(name.toLowerCase());
  return TEXT_EXTS.has(extOf(name));
}
function escapeSql(s) {
  return s.replace(/'/g, "''");
}
function tableNameFor(repoId) {
  return `${TABLE_PREFIX}${repoId}`;
}
class RepoIndexService {
  conn;
  meta = /* @__PURE__ */ new Map();
  // repoId -> state (mirrors _meta table)
  metaLoaded = false;
  broadcast = () => {
  };
  lastProgressSent = 0;
  // Serial job queue: one indexing run at a time, cancellable per repo.
  queue = [];
  draining = false;
  cancelled = /* @__PURE__ */ new Set();
  setBroadcast(fn) {
    this.broadcast = fn;
  }
  // ── Public API ─────────────────────────────────────────────────────────
  /** Status for one repo, or all known repos when repoTileId is omitted. */
  async status(repoTileId) {
    await this.loadMeta();
    const rows = [...this.meta.values()].filter((m) => !repoTileId || m.repoId === repoTileId).map((m) => this.toStatus(m));
    return rows.sort((a, b) => a.repoName.localeCompare(b.repoName));
  }
  /**
   * Kick off (re)indexing for a repo. Queued behind any running job; safe to
   * call repeatedly — a pending job for the same repo is replaced.
   */
  reindex(tile) {
    const repoId = tile.id;
    this.cancelled.delete(repoId);
    this.setMetaState(repoId, tile, "queued");
    this.queue = this.queue.filter((j) => j.repoId !== repoId);
    this.queue.push({ repoId, run: () => this.runIndex(tile) });
    void this.drain();
  }
  /**
   * Called whenever a repo is opened. Auto-indexes when enabled and the
   * index is missing or stale. Fire-and-forget; errors land in meta state.
   */
  onRepoOpened(tile) {
    if (!settingsService.get().repoIndexEnabled) return;
    void (async () => {
      await this.loadMeta();
      const m = this.meta.get(tile.id);
      const fresh = m?.state === "ready" && (m.indexedAt ?? 0) > Date.now() - STALE_MS;
      if (m?.state === "indexing" || m?.state === "queued" || fresh) return;
      this.reindex(tile);
    })().catch(() => void 0);
  }
  /** Drop a repo's index + meta (root removed / repo deleted). */
  async remove(repoTileId) {
    this.cancelled.add(repoTileId);
    this.queue = this.queue.filter((j) => j.repoId !== repoTileId);
    try {
      const db = await this.db();
      if ((await db.tableNames()).includes(tableNameFor(repoTileId))) {
        await db.dropTable(tableNameFor(repoTileId));
      }
    } catch {
    }
    this.meta.delete(repoTileId);
    await this.persistMetaDelete(repoTileId);
  }
  /**
   * Full-text search over one repo's index. Terms are ANDed; special
   * characters are ignored. Falls back to substring matching when the FTS
   * query cannot run (e.g. punctuation-only query).
   */
  async search(req) {
    const started = Date.now();
    const limit = Math.min(Math.max(1, req.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const out = {
      repoTileId: req.repoTileId,
      query: req.query,
      hits: [],
      durationMs: 0
    };
    const query = req.query.trim();
    if (!query) return out;
    let table;
    try {
      const db = await this.db();
      table = await db.openTable(tableNameFor(req.repoTileId));
    } catch {
      return { ...out, durationMs: Date.now() - started, error: "not indexed" };
    }
    const where = this.pathPrefixFilter(req.pathPrefix);
    try {
      const clean = query.replace(/[^\p{L}\p{N}_]+/gu, " ").trim();
      if (!clean) throw new Error("empty fts query");
      let q = table.query().fullTextSearch(clean, { columns: "content" });
      const filter = where;
      if (filter) q = q.where(filter);
      const rows = await q.limit(limit).toArray();
      out.hits = rows.map((r) => this.toHit(r, r._score ?? 0));
      return { ...out, durationMs: Date.now() - started };
    } catch {
    }
    try {
      const terms = query.split(/\s+/).map((t) => t.replace(/['%_\\]/g, "")).filter((t) => t.length > 0);
      if (terms.length === 0) return { ...out, durationMs: Date.now() - started };
      const predicates = terms.map((t) => `contains(content, '${escapeSql(t)}')`);
      if (where) predicates.push(where);
      const rows = await table.query().where(predicates.join(" AND ")).limit(limit).toArray();
      out.hits = rows.map((r) => this.toHit(r, 0));
      return { ...out, hits: out.hits, durationMs: Date.now() - started, fallback: true };
    } catch (err) {
      return {
        ...out,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
  // ── Internals ──────────────────────────────────────────────────────────
  async db() {
    if (!this.conn) {
      const dir = path.join(electron.app.getPath("userData"), DB_DIR_NAME);
      this.conn = lancedb__namespace.connect(dir);
    }
    return this.conn;
  }
  toStatus(m) {
    return {
      repoTileId: m.repoId,
      repoPath: m.repoPath,
      repoName: m.repoName,
      state: m.state,
      files: m.files,
      chunks: m.chunks,
      indexedAt: m.indexedAt,
      error: m.error
    };
  }
  async loadMeta() {
    if (this.metaLoaded) return;
    this.metaLoaded = true;
    try {
      const db = await this.db();
      if (!(await db.tableNames()).includes(META_TABLE)) return;
      const table = await db.openTable(META_TABLE);
      const rows = await table.query().toArray();
      for (const r of rows) this.meta.set(r.repoId, r);
    } catch {
    }
  }
  setMetaState(repoId, tile, state) {
    const base = this.meta.get(repoId) ?? {
      repoId,
      repoPath: tile?.path ?? "",
      repoName: tile?.name ?? "",
      state: "none",
      files: 0,
      chunks: 0
    };
    if (tile) {
      base.repoPath = tile.path;
      base.repoName = tile.name;
    }
    base.state = state;
    if (state === "queued" || state === "indexing") base.error = void 0;
    this.meta.set(repoId, base);
    void this.persistMetaUpsert(base);
  }
  async persistMetaUpsert(row) {
    try {
      const db = await this.db();
      let table;
      if (!(await db.tableNames()).includes(META_TABLE)) {
        table = await db.createTable(META_TABLE, [row]);
      } else {
        table = await db.openTable(META_TABLE);
        await table.delete(`repoId = '${escapeSql(row.repoId)}'`);
        await table.add([row]);
      }
    } catch {
    }
  }
  async persistMetaDelete(repoId) {
    try {
      const db = await this.db();
      if (!(await db.tableNames()).includes(META_TABLE)) return;
      const table = await db.openTable(META_TABLE);
      await table.delete(`repoId = '${escapeSql(repoId)}'`);
    } catch {
    }
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (this.cancelled.has(job.repoId)) {
        this.cancelled.delete(job.repoId);
        continue;
      }
      try {
        await job.run();
      } catch (err) {
        console.error("[repo-index] job failed:", err);
      }
    }
    this.draining = false;
  }
  async runIndex(tile) {
    const started = Date.now();
    this.setMetaState(tile.id, tile, "indexing");
    let files = 0;
    let chunks = 0;
    try {
      const filePaths = await this.walkRepo(tile.path, (walked) => {
        this.maybeProgress(tile.id, "walk", walked, walked);
      });
      files = filePaths.length;
      const db = await this.db();
      const name = tableNameFor(tile.id);
      if ((await db.tableNames()).includes(name)) await db.dropTable(name);
      let table;
      let buffer = [];
      let batchFiles = 0;
      const flush = async () => {
        if (buffer.length === 0) return;
        if (!table) table = await db.createTable(name, buffer);
        else await table.add(buffer);
        chunks += buffer.length;
        buffer = [];
      };
      for (const fp of filePaths) {
        if (this.cancelled.has(tile.id)) throw new Error("cancelled");
        const rel = path.relative(tile.path, fp).split(path.sep).join("/");
        const rows = await this.chunkFile(fp, rel);
        if (rows.length > 0) {
          buffer.push(...rows);
          if (buffer.length >= ADD_BATCH) await flush();
        }
        batchFiles++;
        this.maybeProgress(tile.id, "chunk", batchFiles, files);
        if (batchFiles % 50 === 0) await new Promise((r) => setImmediate(r));
      }
      await flush();
      if (table) {
        this.maybeProgress(tile.id, "search-index", files, files);
        await table.createIndex("content", {
          config: lancedb.Index.fts({ withPosition: true }),
          replace: true
        });
      }
      const m = this.meta.get(tile.id);
      if (m) {
        m.state = "ready";
        m.files = files;
        m.chunks = chunks;
        m.indexedAt = Date.now();
        m.error = void 0;
        await this.persistMetaUpsert(m);
      }
      this.broadcast(IPC.indexComplete, {
        repoTileId: tile.id,
        ok: true,
        files,
        chunks,
        durationMs: Date.now() - started
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const m = this.meta.get(tile.id);
      if (m) {
        m.state = message === "cancelled" ? "none" : "error";
        m.error = message;
        await this.persistMetaUpsert(m);
      }
      this.broadcast(IPC.indexComplete, {
        repoTileId: tile.id,
        ok: false,
        files,
        chunks,
        durationMs: Date.now() - started,
        error: message
      });
    }
  }
  /**
   * Walk the repo collecting text files. Yields to the event loop every
   * WALK_CHUNK entries so IPC/PTY stay responsive; emits walk progress.
   */
  async walkRepo(root, onProgress) {
    const out = [];
    const stack = [root];
    let seen = 0;
    while (stack.length > 0 && out.length < MAX_FILES) {
      const dir = stack.pop();
      let dirents;
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        if (out.length >= MAX_FILES) break;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name) && !d.name.startsWith(".")) stack.push(full);
        } else if (d.isFile() && isTextFile(d.name)) {
          out.push(full);
        }
        if (++seen % WALK_CHUNK === 0) {
          onProgress(seen);
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    onProgress(seen);
    return out;
  }
  /** Read one file and split it into line-ranged chunks. */
  async chunkFile(absPath, relPath) {
    let stat;
    try {
      stat = await fs.promises.stat(absPath);
    } catch {
      return [];
    }
    if (stat.size > MAX_FILE_BYTES) return [];
    let text;
    try {
      const buf = await fs.promises.readFile(absPath);
      if (buf.includes(0)) return [];
      text = buf.toString("utf8");
    } catch {
      return [];
    }
    const lang = langOf(path.basename(relPath));
    const rows = [];
    const lines = text.split("\n");
    let start = 0;
    let size = 0;
    for (let i = 0; i < lines.length; i++) {
      size += lines[i].length + 1;
      const overLines = i - start + 1 > MAX_CHUNK_LINES;
      const overChars = size > MAX_CHUNK_CHARS;
      const isLast = i === lines.length - 1;
      if ((overLines || overChars) && i > start) {
        rows.push({
          path: relPath,
          startLine: start + 1,
          endLine: i,
          lang,
          content: lines.slice(start, i).join("\n")
        });
        start = i;
        size = lines[i].length + 1;
      }
      if (isLast && i >= start) {
        rows.push({
          path: relPath,
          startLine: start + 1,
          endLine: i + 1,
          lang,
          content: lines.slice(start, i + 1).join("\n")
        });
      }
    }
    return rows;
  }
  pathPrefixFilter(prefix) {
    if (!prefix) return "";
    const clean = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!clean) return "";
    const esc = escapeSql(clean);
    return `(path LIKE '${esc}/%' OR path = '${esc}')`;
  }
  toHit(r, score) {
    const content = r.content ?? "";
    return {
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      lang: r.lang,
      score,
      snippet: content.length > SNIPPET_LEN ? `${content.slice(0, SNIPPET_LEN)}…` : content
    };
  }
  maybeProgress(repoTileId, phase, filesIndexed, totalFiles) {
    const now = Date.now();
    if (now - this.lastProgressSent < PROGRESS_EVERY_MS && phase !== "search-index") return;
    this.lastProgressSent = now;
    this.broadcast(IPC.indexProgress, {
      repoTileId,
      phase,
      filesIndexed,
      totalFiles
    });
  }
}
const repoIndexService = new RepoIndexService();
const CHUNK_SIZE = 200;
const DEBOUNCE_MS = 150;
const IGNORED = /* @__PURE__ */ new Set(["node_modules", ".git", "Library", "lost+found", "$RECYCLE.BIN", "System Volume Information"]);
class ScannerService {
  rootRegistry = /* @__PURE__ */ new Map();
  // id -> root
  tileCache = /* @__PURE__ */ new Map();
  // tile.id -> tile
  scanState = /* @__PURE__ */ new Map();
  // rootId -> state
  broadcast = () => {
  };
  /** Injected by ipc.ts — broadcasts events to all windows. */
  setBroadcast(fn) {
    this.broadcast = fn;
  }
  /**
   * Stable id for a root path (survives restarts, no separate persistence
   * needed). Re-syncs the registry against settings.rootFolders.
   */
  syncRoots() {
    const paths = settingsService.rootFolderPaths();
    const byPath = new Map([...this.rootRegistry.values()].map((r) => [r.path, r]));
    const next = /* @__PURE__ */ new Map();
    for (const p of paths) {
      const existing = byPath.get(p);
      if (existing) {
        next.set(existing.id, existing);
      } else {
        const id = stableId(p);
        next.set(id, { id, path: p, name: path.basename(p) || p });
      }
    }
    this.rootRegistry = next;
    return [...next.values()];
  }
  listRoots() {
    return this.syncRoots();
  }
  /**
   * Scan a root folder (debounced). Tiles are delivered via the
   * `folder:scanProgress` and `folder:scanComplete` events.
   */
  scan(rootFolderId, immediate = false) {
    const root = this.rootRegistry.get(rootFolderId);
    if (!root) return;
    let state = this.scanState.get(rootFolderId);
    if (!state) {
      state = { token: 0, pending: false };
      this.scanState.set(rootFolderId, state);
    }
    if (state.timer) clearTimeout(state.timer);
    if (immediate) {
      void this.runScan(root, state);
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = void 0;
      void this.runScan(root, state);
    }, DEBOUNCE_MS);
  }
  scanAll(immediate = false) {
    for (const root of this.rootRegistry.values()) this.scan(root.id, immediate);
  }
  async runScan(root, state) {
    const token = ++state.token;
    let dirents;
    try {
      dirents = await fs.promises.readdir(root.path, { withFileTypes: true });
    } catch (err) {
      const result = {
        rootId: root.id,
        tiles: [],
        error: `Cannot read ${root.path}: ${err instanceof Error ? err.message : String(err)}`
      };
      this.broadcast(IPC.folderScanComplete, result);
      return;
    }
    const candidates = dirents.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !IGNORED.has(d.name)).sort((a, b) => a.name.localeCompare(b.name));
    const tiles = [];
    const total = candidates.length;
    let scanned = 0;
    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      if (state.token !== token) return;
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      for (const dirent of chunk) {
        const dirPath = path.join(root.path, dirent.name);
        scanned++;
        try {
          await fs.promises.stat(dirPath);
          tiles.push({
            id: stableId(dirPath),
            name: dirent.name,
            path: dirPath,
            parentRootId: root.id,
            openCount: this.tileCache.get(stableId(dirPath))?.openCount ?? 0,
            lastOpenedAt: this.tileCache.get(stableId(dirPath))?.lastOpenedAt
          });
        } catch {
        }
      }
      this.broadcast(IPC.folderScanProgress, {
        rootId: root.id,
        scanned,
        total
      });
      await new Promise((r) => setImmediate(r));
    }
    if (state.token !== token) return;
    for (const tile of tiles) this.tileCache.set(tile.id, tile);
    this.broadcast(IPC.folderScanComplete, { rootId: root.id, tiles });
  }
  /** Cached tiles across all roots. */
  cachedTiles() {
    return [...this.tileCache.values()];
  }
  /** Merge freshly scanned tiles into cache (preserving usage metadata). */
  mergeTiles(incoming) {
    for (const tile of incoming) this.tileCache.set(tile.id, tile);
  }
  /** Persist usage metadata when a repo is opened. */
  recordOpen(tileId) {
    const existing = this.tileCache.get(tileId);
    if (existing) {
      existing.lastOpenedAt = Date.now();
      existing.openCount += 1;
    }
  }
  listTiles() {
    return sortTiles([...this.tileCache.values()], settingsService.get().sortOrder);
  }
}
function sortTiles(tiles, order) {
  const copy = [...tiles];
  switch (order) {
    case "recent":
      return copy.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name));
    case "manual":
    case "alpha":
    default:
      return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
}
function stableId(absPath) {
  return crypto.createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}
const scannerService = new ScannerService();
const TERM_COLS = 80;
const TERM_ROWS = 24;
const TERM_GRACE_MS = 1e3;
class PtyManager extends events.EventEmitter {
  sessions = /* @__PURE__ */ new Map();
  broadcast = () => {
  };
  setBroadcast(fn) {
    this.broadcast = fn;
  }
  /**
   * Spawn an agent terminal for a repo tile.
   * Mode resolution: explicit request.mode > settings.windowMode > 'tab'.
   */
  async spawn(req) {
    const agent = agentService.byId(req.agentId);
    if (!agent) throw new Error(`Unknown agent: ${req.agentId}`);
    if (agent.disabled) throw new Error(`Agent "${agent.name}" is disabled`);
    const tile = scannerService.listTiles().find((t) => t.id === req.repoTileId);
    const cwd = agent.workingDirOverride || tile?.path || os.homedir();
    const sessionId = crypto.randomUUID();
    const title = `${agent.name} @ ${path.basename(cwd)}`;
    const pty = this.spawnPty(agent, cwd);
    const info = {
      id: sessionId,
      repoTileId: req.repoTileId,
      agentId: agent.id,
      title,
      cwd,
      createdAt: Date.now(),
      cols: TERM_COLS,
      rows: TERM_ROWS
    };
    const session = { info, pty, titleState: {} };
    this.sessions.set(sessionId, session);
    pty.onData((data) => {
      this.handleData(session, data);
      this.broadcast(IPC.terminalData, { sessionId, data });
    });
    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(sessionId);
      const evt = {
        sessionId,
        exitCode,
        signal: signal === void 0 ? void 0 : String(signal)
      };
      this.broadcast(IPC.terminalExit, evt);
    });
    if (tile) {
      scannerService.recordOpen(tile.id);
      repoIndexService.onRepoOpened(tile);
      this.broadcast(IPC.gridInvalidate, { reason: "repo-opened", tileId: tile.id });
    }
    return { sessionId, windowId: req.windowId ?? "active", title };
  }
  spawnPty(agent, cwd) {
    const nodePty = require("node-pty");
    const env = {
      ...process.env,
      ...agent.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG ?? (os.platform() === "darwin" ? "en_US.UTF-8" : process.env.LANG ?? "")
    };
    if (agent.useShell) {
      const [shell, shellArgs] = this.detectShell();
      const commandLine = [agent.command, ...agent.args ?? []].join(" ");
      return nodePty.spawn(shell, [...shellArgs, commandLine], {
        name: "xterm-256color",
        cols: TERM_COLS,
        rows: TERM_ROWS,
        cwd,
        env
      });
    }
    return nodePty.spawn(agent.command, agent.args ?? [], {
      name: "xterm-256color",
      cols: TERM_COLS,
      rows: TERM_ROWS,
      cwd,
      env
    });
  }
  detectShell() {
    if (process.platform === "win32") {
      return ["powershell.exe", ["-NoLogo", "-Command"]];
    }
    const shell = process.env.SHELL && existsInPath(process.env.SHELL) ? process.env.SHELL : "/bin/bash";
    return [shell, ["-c"]];
  }
  /** Keystrokes from the renderer. */
  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session) session.pty.write(data);
  }
  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || cols <= 0 || rows <= 0) return;
    const c = Math.floor(cols);
    const r = Math.floor(rows);
    session.info.cols = c;
    session.info.rows = r;
    try {
      session.pty.resize(c, r);
    } catch {
    }
  }
  /** Graceful kill: SIGTERM, then SIGKILL after a grace period. */
  async kill(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await this.terminate(session);
  }
  async terminate(session) {
    const { pty } = session;
    let alive = true;
    const exit = new Promise((resolve) => pty.onExit(() => {
      alive = false;
      resolve();
    }));
    try {
      process.kill(pty.pid, "SIGTERM");
    } catch {
      return;
    }
    const timer = new Promise((resolve) => setTimeout(resolve, TERM_GRACE_MS));
    await Promise.race([exit, timer]);
    if (alive) {
      try {
        pty.kill();
      } catch {
      }
    }
    await exit;
  }
  /** Kill every live session — called on app quit. */
  async killAll() {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => this.terminate(s)));
  }
  list() {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }
  /** Live PIDs of all sessions — used by the hard-cleanup fallback. */
  livePids() {
    return [...this.sessions.values()].map((s) => s.pty.pid);
  }
  // ── OSC title detection ──────────────────────────────────────────────
  handleData(session, data) {
    const title = extractOscTitle(session.titleState, data);
    if (title && title !== session.info.title) {
      session.info.title = title;
      const evt = { sessionId: session.info.id, title };
      this.broadcast(IPC.terminalTitle, evt);
    }
  }
}
const OSC_START = "\x1B]";
const BEL = "\x07";
const ST = "\x1B\\";
const TITLE_CODES = /* @__PURE__ */ new Set(["0", "2"]);
function extractOscTitle(state, chunk) {
  let pending = state.buffer ?? "";
  const searchIn = pending + chunk;
  state.buffer = void 0;
  let idx = 0;
  let result = null;
  while (idx < searchIn.length) {
    const start = searchIn.indexOf(OSC_START, idx);
    if (start === -1) {
      state.buffer = searchIn.slice(Math.max(idx, searchIn.length - OSC_START.length));
      break;
    }
    const code = searchIn[start + OSC_START.length];
    if (!code || !TITLE_CODES.has(code)) {
      idx = start + OSC_START.length;
      continue;
    }
    const bodyStart = start + OSC_START.length + 1;
    const semi = searchIn.indexOf(";", bodyStart);
    if (semi === -1) {
      state.buffer = searchIn.slice(start);
      break;
    }
    const belEnd = searchIn.indexOf(BEL, semi + 1);
    const stEnd = searchIn.indexOf(ST, semi + 1);
    if (belEnd === -1 && stEnd === -1) {
      state.buffer = searchIn.slice(start);
      break;
    }
    const end = belEnd === -1 ? stEnd : stEnd === -1 ? belEnd : Math.min(belEnd, stEnd);
    const terminator = end === belEnd ? BEL.length : ST.length;
    result = searchIn.slice(semi + 1, end).trim();
    idx = end + terminator;
  }
  return result;
}
function existsInPath(file) {
  if (path.isAbsolute(file)) return true;
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  return dirs.some((d) => {
    try {
      require("fs").existsSync(path.join(d, file));
      return true;
    } catch {
      return false;
    }
  });
}
const ptyManager = new PtyManager();
const isDev = !electron.app.isPackaged;
class WindowManager {
  windows = /* @__PURE__ */ new Map();
  create(kind, sessionId, title) {
    const isTerminal = kind === "terminal";
    const win = new electron.BrowserWindow({
      width: isTerminal ? 1100 : 1280,
      height: isTerminal ? 760 : 860,
      minWidth: 480,
      minHeight: 360,
      title: title ?? "Hangar",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: { x: 12, y: 12 },
      // Native tabbing for terminal windows on macOS
      tabbingIdentifier: isTerminal ? "hangar-terminal" : void 0,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    });
    const windowId = `win-${win.id}`;
    const tracked = { id: windowId, kind, sessionId, win };
    this.windows.set(windowId, tracked);
    win.on("closed", () => this.windows.delete(windowId));
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void electron.shell.openExternal(url);
      }
      return { action: "deny" };
    });
    if (isDev) {
      const params = new URLSearchParams();
      if (isTerminal && sessionId) params.set("sessionId", sessionId);
      if (isTerminal) params.set("windowId", windowId);
      const qs = params.size > 0 ? `?${params.toString()}` : "";
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173"}${qs}`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
        query: isTerminal && sessionId ? { windowId, sessionId } : void 0
      });
    }
    return windowId;
  }
  close(windowId) {
    const tracked = this.windows.get(windowId);
    if (tracked && !tracked.win.isDestroyed()) tracked.win.close();
  }
  get(windowId) {
    return this.windows.get(windowId);
  }
  bySession(sessionId) {
    return [...this.windows.values()].find((w) => w.sessionId === sessionId);
  }
  all() {
    return [...this.windows.values()];
  }
  mainWindows() {
    return this.all().filter((w) => w.kind === "main");
  }
  firstMainWindowId() {
    return this.mainWindows()[0]?.id;
  }
  /**
   * Broadcast a main→renderer event to every window (all kinds).
   * Terminal events carry a sessionId so the renderer can filter.
   */
  broadcast(channel, payload) {
    for (const tracked of this.windows.values()) {
      if (!tracked.win.isDestroyed()) {
        tracked.win.webContents.send(channel, payload);
      }
    }
  }
  broadcastToMain(channel, payload) {
    for (const tracked of this.mainWindows()) {
      if (!tracked.win.isDestroyed()) {
        tracked.win.webContents.send(channel, payload);
      }
    }
  }
  /** A window requested a sidebar toggle — mirror to all windows. */
  toggleSidebar() {
    this.broadcast(IPC.windowToggleSidebar, {});
  }
  activeCount() {
    return this.windows.size;
  }
}
const windowManager = new WindowManager();
function wrap(fn) {
  return Promise.resolve().then(fn).then((data) => ({ ok: true, data })).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
}
function registerIpcHandlers() {
  scannerService.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload));
  ptyManager.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload));
  repoIndexService.setBroadcast((ch, payload) => windowManager.broadcast(ch, payload));
  electron.ipcMain.handle(IPC.settingsGet, () => wrap(() => settingsService.get()));
  electron.ipcMain.handle(IPC.settingsSet, (_e, partial) => {
    const result = settingsService.update(partial);
    if (result.ok) {
      windowManager.broadcast(IPC.gridInvalidate, { reason: "settings-changed" });
    }
    return result;
  });
  electron.ipcMain.handle(IPC.settingsReset, () => wrap(() => settingsService.reset()));
  electron.ipcMain.handle(
    IPC.foldersAdd,
    (e) => wrap(async () => {
      const win = electron.BrowserWindow.fromWebContents(e.sender);
      const result = await (win && !win.isDestroyed() ? electron.dialog.showOpenDialog(win, {
        properties: ["openDirectory", "multiSelections"],
        title: "Add root folders containing your repos",
        buttonLabel: "Add"
      }) : electron.dialog.showOpenDialog({
        properties: ["openDirectory", "multiSelections"],
        title: "Add root folders containing your repos",
        buttonLabel: "Add"
      }));
      if (result.canceled || result.filePaths.length === 0) return [];
      const current = settingsService.get().rootFolders;
      const merged = [...current, ...result.filePaths];
      const updated = settingsService.update({ rootFolders: merged });
      if (!updated.ok) throw new Error(updated.error);
      scannerService.syncRoots();
      windowManager.broadcast(IPC.gridInvalidate, { reason: "folders-changed" });
      return scannerService.listRoots();
    })
  );
  electron.ipcMain.handle(
    IPC.foldersRemove,
    (_e, rootFolderId) => wrap(async () => {
      const root = scannerService.listRoots().find((r) => r.id === rootFolderId);
      if (!root) throw new Error(`Unknown root folder: ${rootFolderId}`);
      const tilesUnderRoot = scannerService.listTiles().filter((t) => t.parentRootId === rootFolderId);
      const current = settingsService.get().rootFolders;
      const updated = settingsService.update({
        rootFolders: current.filter((p) => p !== root.path)
      });
      if (!updated.ok) throw new Error(updated.error);
      scannerService.syncRoots();
      for (const tile of tilesUnderRoot) {
        void repoIndexService.remove(tile.id).catch(() => void 0);
      }
      windowManager.broadcast(IPC.gridInvalidate, { reason: "folders-changed" });
    })
  );
  electron.ipcMain.handle(
    IPC.foldersScan,
    (_e, rootFolderId) => wrap(() => {
      scannerService.syncRoots();
      if (rootFolderId) scannerService.scan(rootFolderId);
      else scannerService.scanAll();
    })
  );
  electron.ipcMain.handle(IPC.rootsList, () => wrap(() => scannerService.listRoots()));
  electron.ipcMain.handle(IPC.agentsList, () => wrap(() => agentService.listAll()));
  electron.ipcMain.handle(
    IPC.agentsAdd,
    (_e, payload) => wrap(() => {
      const result = agentService.add(payload);
      if (!result.ok) throw new Error(result.error);
      windowManager.broadcast(IPC.gridInvalidate, { reason: "agents-changed" });
      return result.data;
    })
  );
  electron.ipcMain.handle(
    IPC.agentsUpdate,
    (_e, agent) => wrap(() => {
      const result = agentService.update(agent);
      if (!result.ok) throw new Error(result.error);
      windowManager.broadcast(IPC.gridInvalidate, { reason: "agents-changed" });
    })
  );
  electron.ipcMain.handle(
    IPC.agentsDelete,
    (_e, agentId) => wrap(() => {
      const result = agentService.delete(agentId);
      if (!result.ok) throw new Error(result.error);
      windowManager.broadcast(IPC.gridInvalidate, { reason: "agents-changed" });
    })
  );
  electron.ipcMain.handle(
    IPC.agentsToggleBuiltin,
    (_e, agentId, disabled) => wrap(() => {
      const result = agentService.toggleBuiltin(agentId, Boolean(disabled));
      if (!result.ok) throw new Error(result.error);
      windowManager.broadcast(IPC.gridInvalidate, { reason: "agents-changed" });
    })
  );
  electron.ipcMain.handle(IPC.terminalList, () => wrap(() => ptyManager.list()));
  electron.ipcMain.handle(IPC.tilesList, () => wrap(() => scannerService.listTiles()));
  electron.ipcMain.handle(
    IPC.indexStatus,
    (_e, repoTileId) => wrap(() => repoIndexService.status(repoTileId))
  );
  electron.ipcMain.handle(
    IPC.indexReindex,
    (_e, repoTileId) => wrap(() => {
      const tile = scannerService.listTiles().find((t) => t.id === repoTileId);
      if (!tile) throw new Error(`Unknown repo: ${repoTileId}`);
      repoIndexService.reindex(tile);
    })
  );
  electron.ipcMain.handle(
    IPC.indexSearch,
    (_e, req) => wrap(() => repoIndexService.search(req))
  );
  electron.ipcMain.handle(
    IPC.indexRemove,
    (_e, repoTileId) => wrap(() => repoIndexService.remove(repoTileId))
  );
  electron.ipcMain.handle(
    IPC.terminalSpawn,
    (e, req) => wrap(async () => {
      const settings = settingsService.get();
      const mode = req.mode ?? (settings.windowMode === "windows" ? "window" : "tab");
      if (mode === "window") {
        const windowId = windowManager.create("terminal");
        return await ptyManager.spawn({ ...req, mode, windowId });
      }
      const senderWindow = [...windowManager.all()].find((w) => w.win.webContents === e.sender);
      return await ptyManager.spawn({
        ...req,
        mode,
        windowId: req.windowId ?? senderWindow?.id
      });
    })
  );
  electron.ipcMain.on(IPC.terminalInput, (_e, sessionId, data) => {
    if (typeof sessionId === "string" && typeof data === "string") {
      ptyManager.write(sessionId, data);
    }
  });
  electron.ipcMain.handle(
    IPC.terminalResize,
    (_e, sessionId, cols, rows) => wrap(() => ptyManager.resize(sessionId, cols, rows))
  );
  electron.ipcMain.handle(
    IPC.terminalKill,
    (_e, sessionId) => wrap(() => ptyManager.kill(sessionId))
  );
  electron.ipcMain.handle(
    IPC.windowCreate,
    (_e, kind = "main") => wrap(() => windowManager.create(kind === "terminal" ? "terminal" : "main"))
  );
  electron.ipcMain.handle(
    IPC.windowClose,
    (_e, windowId) => wrap(() => windowManager.close(windowId))
  );
  electron.ipcMain.on(IPC.windowToggleSidebar, () => windowManager.toggleSidebar());
}
electron.app.commandLine.appendSwitch("disable-gpu-sandbox");
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    const main = windowManager.mainWindows()[0];
    if (main && !main.win.isDestroyed()) {
      if (main.win.isMinimized()) main.win.restore();
      main.win.focus();
    }
  });
  void electron.app.whenReady().then(() => {
    registerIpcHandlers();
    settingsService.get();
    scannerService.syncRoots();
    agentService.list();
    if (windowManager.activeCount() === 0) {
      windowManager.create("main");
    }
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) {
        windowManager.create("main");
      }
    });
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      electron.app.quit();
    }
  });
  let quitting = false;
  electron.app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void ptyManager.killAll().catch(() => void 0).finally(() => electron.app.quit());
  });
  process.on("exit", () => {
    for (const pid of ptyManager.livePids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
    }
  });
}
