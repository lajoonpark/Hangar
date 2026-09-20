import * as lancedb from '@lancedb/lancedb'
import { Index } from '@lancedb/lancedb'
import type { Connection, Table } from '@lancedb/lancedb'
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import {
  RepoIndexCompleteEvent,
  RepoIndexProgress,
  RepoIndexState,
  RepoIndexStatus,
  RepoSearchHit,
  RepoSearchRequest,
  RepoSearchResponse,
  RepoTile
} from '@shared/types'
import { IPC } from '@shared/ipc'
import { settingsService } from './settings'

/**
 * Repo indexing service — local, offline, LanceDB-backed.
 *
 * LanceDB (https://lancedb.com) is an embedded columnar database ("SQLite for
 * vectors/text"): each repo's index is a Lance table stored on disk under
 * userData, queried in-process with tantivy full-text search (BM25). No
 * server, no network, no embeddings — pure local-first search over file
 * contents.
 *
 * Model:
 * - One LanceDB database at `<userData>/repo-index.lance`.
 * - One table per repo: `repo_<tileId>` with one row per text chunk.
 *   Row: path, startLine, endLine, lang, content.
 * - A `_meta` table tracks per-repo state so the UI can show badges without
 *   opening the repo table.
 *
 * Lifecycle:
 * - Auto-index on first repo open (and re-index when stale) if enabled.
 * - Manual reindex via IPC; one indexing job runs at a time (queued).
 * - Removing a root folder / tile drops its tables.
 */

// ── Tuning knobs ─────────────────────────────────────────────────────────────

const DB_DIR_NAME = 'repo-index.lance'
const META_TABLE = '_meta'
const TABLE_PREFIX = 'repo_'

const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024
const MAX_CHUNK_LINES = 120
const MAX_CHUNK_CHARS = 8000
const ADD_BATCH = 500
const WALK_CHUNK = 100
const STALE_MS = 60 * 60 * 1000 // auto re-index after 1h
const PROGRESS_EVERY_MS = 200
const SNIPPET_LEN = 240
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.output', '.cache', '.parcel-cache', '.turbo',
  'coverage', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.venv', 'venv', 'env', 'vendor', 'Pods', 'DerivedData',
  '.gradle', '.idea', '.vscode', '.kilo', '.zig-cache', 'zig-out',
  '.lance', '.store', '.svelte-kit', 'bower_components'
])

const TEXT_EXTS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc',
  'md', 'mdx', 'txt', 'rst', 'adoc',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'm', 'mm', 'cs', 'dart', 'zig',
  'php', 'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env',
  'css', 'scss', 'sass', 'less', 'styl',
  'html', 'htm', 'vue', 'svelte', 'astro', 'ejs', 'hbs', 'liquid',
  'sql', 'graphql', 'gql', 'proto', 'tf', 'tfvars', 'hcl',
  'xml', 'svg', 'csv', 'tsv', 'gradle', 'groovy', 'cmake', 'dockerfile',
  'lock', 'sum', 'mod', 'gemspec', 'podspec'
])

const TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', 'rakefile', 'gemfile',
  'procfile', 'vagrantfile', 'justfile', '.gitignore', '.gitattributes',
  '.editorconfig', '.npmrc', '.nvmrc', '.babelrc', '.eslintrc',
  '.prettierrc', '.dockerignore', 'license', 'license.md', 'license.txt',
  'readme', 'readme.md', 'changes', 'changelog', 'changelog.md', 'notice'
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function langOf(name: string): string {
  const lower = name.toLowerCase()
  if (TEXT_FILENAMES.has(lower)) return lower.replace(/^./, (c) => c.toUpperCase())
  return extOf(name) || 'text'
}

function isTextFile(name: string): boolean {
  if (name.startsWith('.') && TEXT_FILENAMES.has(name.toLowerCase())) return true
  if (!name.includes('.')) return TEXT_FILENAMES.has(name.toLowerCase())
  return TEXT_EXTS.has(extOf(name))
}

interface IndexChunkRow {
  [key: string]: unknown
  path: string
  startLine: number
  endLine: number
  lang: string
  content: string
}

interface MetaRow {
  [key: string]: unknown
  repoId: string
  repoPath: string
  repoName: string
  state: RepoIndexState
  files: number
  chunks: number
  indexedAt?: number
  error?: string
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''")
}

function tableNameFor(repoId: string): string {
  // repo ids are hex from scanner.stableId — prefix guarantees a valid name
  return `${TABLE_PREFIX}${repoId}`
}

// ── Service ──────────────────────────────────────────────────────────────────

class RepoIndexService {
  private conn: Promise<Connection> | undefined
  private meta = new Map<string, MetaRow>() // repoId -> state (mirrors _meta table)
  private metaLoaded = false
  private broadcast: (channel: string, payload: unknown) => void = () => {}
  private lastProgressSent = 0

  // Serial job queue: one indexing run at a time, cancellable per repo.
  private queue: Array<{ repoId: string; run: () => Promise<void> }> = []
  private draining = false
  private cancelled = new Set<string>()

  setBroadcast(fn: (channel: string, payload: unknown) => void): void {
    this.broadcast = fn
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Status for one repo, or all known repos when repoTileId is omitted. */
  async status(repoTileId?: string): Promise<RepoIndexStatus[]> {
    await this.loadMeta()
    const rows = [...this.meta.values()]
      .filter((m) => !repoTileId || m.repoId === repoTileId)
      .map((m) => this.toStatus(m))
    return rows.sort((a, b) => a.repoName.localeCompare(b.repoName))
  }

  /**
   * Kick off (re)indexing for a repo. Queued behind any running job; safe to
   * call repeatedly — a pending job for the same repo is replaced.
   */
  reindex(tile: RepoTile): void {
    const repoId = tile.id
    this.cancelled.delete(repoId)
    this.setMetaState(repoId, tile, 'queued')
    this.queue = this.queue.filter((j) => j.repoId !== repoId)
    this.queue.push({ repoId, run: () => this.runIndex(tile) })
    void this.drain()
  }

  /**
   * Called whenever a repo is opened. Auto-indexes when enabled and the
   * index is missing or stale. Fire-and-forget; errors land in meta state.
   */
  onRepoOpened(tile: RepoTile): void {
    if (!settingsService.get().repoIndexEnabled) return
    void (async () => {
      await this.loadMeta()
      const m = this.meta.get(tile.id)
      const fresh = m?.state === 'ready' && (m.indexedAt ?? 0) > Date.now() - STALE_MS
      if (m?.state === 'indexing' || m?.state === 'queued' || fresh) return
      this.reindex(tile)
    })().catch(() => undefined)
  }

  /** Drop a repo's index + meta (root removed / repo deleted). */
  async remove(repoTileId: string): Promise<void> {
    this.cancelled.add(repoTileId)
    this.queue = this.queue.filter((j) => j.repoId !== repoTileId)
    try {
      const db = await this.db()
      if ((await db.tableNames()).includes(tableNameFor(repoTileId))) {
        await db.dropTable(tableNameFor(repoTileId))
      }
    } catch {
      // db not open yet or table already gone
    }
    this.meta.delete(repoTileId)
    await this.persistMetaDelete(repoTileId)
  }

  /**
   * Full-text search over one repo's index. Terms are ANDed; special
   * characters are ignored. Falls back to substring matching when the FTS
   * query cannot run (e.g. punctuation-only query).
   */
  async search(req: RepoSearchRequest): Promise<RepoSearchResponse> {
    const started = Date.now()
    const limit = Math.min(Math.max(1, req.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
    const out: RepoSearchResponse = {
      repoTileId: req.repoTileId,
      query: req.query,
      hits: [],
      durationMs: 0
    }

    const query = req.query.trim()
    if (!query) return out

    let table: Table
    try {
      const db = await this.db()
      table = await db.openTable(tableNameFor(req.repoTileId))
    } catch {
      return { ...out, durationMs: Date.now() - started, error: 'not indexed' }
    }

    const where = this.pathPrefixFilter(req.pathPrefix)

    // Primary path: tantivy BM25 full-text search on `content`.
    try {
      const clean = query.replace(/[^\p{L}\p{N}_]+/gu, ' ').trim()
      if (!clean) throw new Error('empty fts query')
      let q = table.query().fullTextSearch(clean, { columns: 'content' })
      const filter = where
      if (filter) q = q.where(filter)
      const rows = (await q.limit(limit).toArray()) as Array<IndexChunkRow & { _score?: number }>
      out.hits = rows.map((r) => this.toHit(r, r._score ?? 0))
      return { ...out, durationMs: Date.now() - started }
    } catch {
      // fall through to substring search
    }

    // Fallback: substring AND over content (works with no FTS index and
    // handles punctuation-heavy queries).
    try {
      const terms = query
        .split(/\s+/)
        .map((t) => t.replace(/['%_\\]/g, ''))
        .filter((t) => t.length > 0)
      if (terms.length === 0) return { ...out, durationMs: Date.now() - started }
      const predicates = terms.map((t) => `contains(content, '${escapeSql(t)}')`)
      if (where) predicates.push(where)
      const rows = (await table
        .query()
        .where(predicates.join(' AND '))
        .limit(limit)
        .toArray()) as IndexChunkRow[]
      out.hits = rows.map((r) => this.toHit(r, 0))
      return { ...out, hits: out.hits, durationMs: Date.now() - started, fallback: true }
    } catch (err) {
      return {
        ...out,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async db(): Promise<Connection> {
    if (!this.conn) {
      const dir = path.join(app.getPath('userData'), DB_DIR_NAME)
      this.conn = lancedb.connect(dir)
    }
    return this.conn
  }

  private toStatus(m: MetaRow): RepoIndexStatus {
    return {
      repoTileId: m.repoId,
      repoPath: m.repoPath,
      repoName: m.repoName,
      state: m.state,
      files: m.files,
      chunks: m.chunks,
      indexedAt: m.indexedAt,
      error: m.error
    }
  }

  private async loadMeta(): Promise<void> {
    if (this.metaLoaded) return
    this.metaLoaded = true
    try {
      const db = await this.db()
      if (!(await db.tableNames()).includes(META_TABLE)) return
      const table = await db.openTable(META_TABLE)
      const rows = (await table.query().toArray()) as MetaRow[]
      for (const r of rows) this.meta.set(r.repoId, r)
    } catch {
      // first run — no db dir yet
    }
  }

  private setMetaState(repoId: string, tile: RepoTile | undefined, state: RepoIndexState): void {
    const base: MetaRow =
      this.meta.get(repoId) ??
      ({
        repoId,
        repoPath: tile?.path ?? '',
        repoName: tile?.name ?? '',
        state: 'none',
        files: 0,
        chunks: 0
      } satisfies MetaRow)
    if (tile) {
      base.repoPath = tile.path
      base.repoName = tile.name
    }
    base.state = state
    if (state === 'queued' || state === 'indexing') base.error = undefined
    this.meta.set(repoId, base)
    void this.persistMetaUpsert(base)
  }

  private async persistMetaUpsert(row: MetaRow): Promise<void> {
    try {
      const db = await this.db()
      let table: Table
      if (!(await db.tableNames()).includes(META_TABLE)) {
        table = await db.createTable(META_TABLE, [row])
      } else {
        table = await db.openTable(META_TABLE)
        await table.delete(`repoId = '${escapeSql(row.repoId)}'`)
        await table.add([row])
      }
    } catch {
      // meta persistence is best-effort; in-memory state still works
    }
  }

  private async persistMetaDelete(repoId: string): Promise<void> {
    try {
      const db = await this.db()
      if (!(await db.tableNames()).includes(META_TABLE)) return
      const table = await db.openTable(META_TABLE)
      await table.delete(`repoId = '${escapeSql(repoId)}'`)
    } catch {
      // best-effort
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    while (this.queue.length > 0) {
      const job = this.queue.shift()!
      if (this.cancelled.has(job.repoId)) {
        this.cancelled.delete(job.repoId)
        continue
      }
      try {
        await job.run()
      } catch (err) {
        // run() reports its own errors into meta; this is a safety net
        console.error('[repo-index] job failed:', err)
      }
    }
    this.draining = false
  }

  private async runIndex(tile: RepoTile): Promise<void> {
    const started = Date.now()
    this.setMetaState(tile.id, tile, 'indexing')
    let files = 0
    let chunks = 0

    try {
      // 1. Walk — collect text files (capped)
      const filePaths = await this.walkRepo(tile.path, (walked) => {
        this.maybeProgress(tile.id, 'walk', walked, walked)
      })
      files = filePaths.length

      // 2. Chunk + write in batches
      const db = await this.db()
      const name = tableNameFor(tile.id)
      if ((await db.tableNames()).includes(name)) await db.dropTable(name)

      let table: Table | undefined
      let buffer: IndexChunkRow[] = []
      let batchFiles = 0

      const flush = async (): Promise<void> => {
        if (buffer.length === 0) return
        if (!table) table = await db.createTable(name, buffer)
        else await table.add(buffer)
        chunks += buffer.length
        buffer = []
      }

      for (const fp of filePaths) {
        if (this.cancelled.has(tile.id)) throw new Error('cancelled')
        const rel = path.relative(tile.path, fp).split(path.sep).join('/')
        const rows = await this.chunkFile(fp, rel)
        if (rows.length > 0) {
          buffer.push(...rows)
          if (buffer.length >= ADD_BATCH) await flush()
        }
        batchFiles++
        this.maybeProgress(tile.id, 'chunk', batchFiles, files)
        if (batchFiles % 50 === 0) await new Promise((r) => setImmediate(r))
      }
      await flush()

      // 3. FTS index over content
      if (table) {
        this.maybeProgress(tile.id, 'search-index', files, files)
        await table.createIndex('content', {
          config: Index.fts({ withPosition: true }),
          replace: true
        })
      }

      // 4. Commit meta
      const m = this.meta.get(tile.id)
      if (m) {
        m.state = 'ready'
        m.files = files
        m.chunks = chunks
        m.indexedAt = Date.now()
        m.error = undefined
        await this.persistMetaUpsert(m)
      }
      this.broadcast(IPC.indexComplete, {
        repoTileId: tile.id,
        ok: true,
        files,
        chunks,
        durationMs: Date.now() - started
      } satisfies RepoIndexCompleteEvent)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const m = this.meta.get(tile.id)
      if (m) {
        m.state = message === 'cancelled' ? 'none' : 'error'
        m.error = message
        await this.persistMetaUpsert(m)
      }
      this.broadcast(IPC.indexComplete, {
        repoTileId: tile.id,
        ok: false,
        files,
        chunks,
        durationMs: Date.now() - started,
        error: message
      } satisfies RepoIndexCompleteEvent)
    }
  }

  /**
   * Walk the repo collecting text files. Yields to the event loop every
   * WALK_CHUNK entries so IPC/PTY stay responsive; emits walk progress.
   */
  private async walkRepo(
    root: string,
    onProgress: (count: number) => void
  ): Promise<string[]> {
    const out: string[] = []
    const stack: string[] = [root]
    let seen = 0

    while (stack.length > 0 && out.length < MAX_FILES) {
      const dir = stack.pop()!
      let dirents
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue // unreadable dir — skip
      }
      for (const d of dirents) {
        if (out.length >= MAX_FILES) break
        const full = path.join(dir, d.name)
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) stack.push(full)
        } else if (d.isFile() && isTextFile(d.name)) {
          out.push(full)
        }
        if (++seen % WALK_CHUNK === 0) {
          onProgress(seen)
          await new Promise((r) => setImmediate(r))
        }
      }
    }
    onProgress(seen)
    return out
  }

  /** Read one file and split it into line-ranged chunks. */
  private async chunkFile(absPath: string, relPath: string): Promise<IndexChunkRow[]> {
    let stat
    try {
      stat = await fs.stat(absPath)
    } catch {
      return []
    }
    if (stat.size > MAX_FILE_BYTES) return []

    let text: string
    try {
      const buf = await fs.readFile(absPath)
      // Binary heuristics: NUL byte anywhere in the buffer
      if (buf.includes(0)) return []
      text = buf.toString('utf8')
    } catch {
      return []
    }

    const lang = langOf(path.basename(relPath))
    const rows: IndexChunkRow[] = []
    const lines = text.split('\n')
    let start = 0
    let size = 0

    for (let i = 0; i < lines.length; i++) {
      size += lines[i].length + 1
      const overLines = i - start + 1 > MAX_CHUNK_LINES
      const overChars = size > MAX_CHUNK_CHARS
      const isLast = i === lines.length - 1
      if ((overLines || overChars) && i > start) {
        rows.push({
          path: relPath,
          startLine: start + 1,
          endLine: i,
          lang,
          content: lines.slice(start, i).join('\n')
        })
        start = i
        size = lines[i].length + 1
      }
      if (isLast && i >= start) {
        rows.push({
          path: relPath,
          startLine: start + 1,
          endLine: i + 1,
          lang,
          content: lines.slice(start, i + 1).join('\n')
        })
      }
    }
    return rows
  }

  private pathPrefixFilter(prefix?: string): string {
    if (!prefix) return ''
    const clean = prefix.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!clean) return ''
    const esc = escapeSql(clean)
    return `(path LIKE '${esc}/%' OR path = '${esc}')`
  }

  private toHit(r: IndexChunkRow, score: number): RepoSearchHit {
    const content = r.content ?? ''
    return {
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      lang: r.lang,
      score,
      snippet: content.length > SNIPPET_LEN ? `${content.slice(0, SNIPPET_LEN)}…` : content
    }
  }

  private maybeProgress(
    repoTileId: string,
    phase: RepoIndexProgress['phase'],
    filesIndexed: number,
    totalFiles: number
  ): void {
    const now = Date.now()
    if (now - this.lastProgressSent < PROGRESS_EVERY_MS && phase !== 'search-index') return
    this.lastProgressSent = now
    this.broadcast(IPC.indexProgress, {
      repoTileId,
      phase,
      filesIndexed,
      totalFiles
    } satisfies RepoIndexProgress)
  }
}

export const repoIndexService = new RepoIndexService()
