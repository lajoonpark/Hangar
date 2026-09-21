import Store from 'electron-store'
import { AppSettings, BUILTIN_AGENTS, CustomAgent, DEFAULT_SETTINGS, Result } from '@shared/types'

/**
 * Settings persistence backed by electron-store (JSON in userData).
 *
 * The schema is versioned; when new fields are added, bump SCHEMA_VERSION
 * and extend `migrations` so existing users upgrade transparently.
 */

const SCHEMA_VERSION = 3

type StoredSettings = AppSettings & { __schemaVersion: number }

const migrations: Record<number, (prev: Record<string, unknown>) => StoredSettings> = {
  // v1 → v2: added disabledBuiltinAgents
  1: (prev) => {
    const next = { ...DEFAULT_SETTINGS, ...(prev as object) } as StoredSettings
    next.disabledBuiltinAgents = []
    next.__schemaVersion = SCHEMA_VERSION
    return next
  },
  // v2 → v3: added repoIndexEnabled
  2: (prev) => {
    const next = { ...DEFAULT_SETTINGS, ...(prev as object) } as StoredSettings
    next.repoIndexEnabled = true
    next.__schemaVersion = SCHEMA_VERSION
    return next
  }
}

function applyMigrations(raw: Record<string, unknown>): StoredSettings {
  let version = (raw.__schemaVersion as number) ?? 1
  let current = { ...raw }
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version]
    if (!migrate) break
    current = migrate(current) as unknown as Record<string, unknown>
    current.__schemaVersion = version + 1
    version++
  }
  // Fill any missing keys from defaults (forward-compatible)
  const merged: StoredSettings = { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION, ...(current as object) }
  merged.__schemaVersion = SCHEMA_VERSION
  return merged
}

function validate(settings: AppSettings): string[] {
  const errors: string[] = []
  if (!Array.isArray(settings.rootFolders)) errors.push('rootFolders must be an array')
  if (!['recent', 'alpha', 'manual'].includes(settings.sortOrder))
    errors.push(`invalid sortOrder: ${String(settings.sortOrder)}`)
  if (!['tabs', 'windows', 'both'].includes(settings.windowMode))
    errors.push(`invalid windowMode: ${String(settings.windowMode)}`)
  if (!['system', 'light', 'dark'].includes(settings.theme))
    errors.push(`invalid theme: ${String(settings.theme)}`)
  if (
    typeof settings.terminalFontSize !== 'number' ||
    settings.terminalFontSize < 8 ||
    settings.terminalFontSize > 32
  )
    errors.push('terminalFontSize must be a number between 8 and 32')
  if (typeof settings.terminalFontFamily !== 'string')
    errors.push('terminalFontFamily must be a string')
  if (typeof settings.repoIndexEnabled !== 'boolean')
    errors.push('repoIndexEnabled must be a boolean')
  if (
    !settings.agentTabLabels ||
    typeof settings.agentTabLabels !== 'object' ||
    Array.isArray(settings.agentTabLabels)
  )
    errors.push('agentTabLabels must be an object')
  return errors
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const norm = p.replace(/\/+$/, '')
    if (!seen.has(norm)) {
      seen.add(norm)
      out.push(norm)
    }
  }
  return out
}

const SETTING_KEYS: (keyof AppSettings)[] = [
  'rootFolders',
  'customAgents',
  'sortOrder',
  'windowMode',
  'theme',
  'terminalFontSize',
  'terminalFontFamily',
  'disabledBuiltinAgents',
  'repoIndexEnabled',
  'agentTabLabels'
]

class SettingsService {
  private store: Store<StoredSettings>
  private cache: StoredSettings

  constructor() {
    this.store = new Store<StoredSettings>({
      name: 'hangar-settings',
      defaults: { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION } as StoredSettings
    })
    // Migrate + sanitize whatever is on disk
    this.cache = applyMigrations(this.store.store as unknown as Record<string, unknown>)
    this.cache.customAgents = this.sanitizeAgents(this.cache.customAgents)
    this.cache.rootFolders = dedupePaths(
      this.cache.rootFolders.filter((p) => typeof p === 'string' && p.length > 0)
    )
    this.cache.agentTabLabels = this.sanitizeLabels(this.cache.agentTabLabels)
    this.persist()
  }

  private sanitizeLabels(labels: unknown): Record<string, string> {
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return {}
    const out: Record<string, string> = {}
    for (const [id, label] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof label === 'string' && label.trim()) out[id] = label.trim()
    }
    return out
  }

  private sanitizeAgents(agents: unknown): CustomAgent[] {
    if (!Array.isArray(agents)) return []
    return agents
      .filter((a): a is CustomAgent => {
        const rec = a as Record<string, unknown>
        return (
          !!rec &&
          typeof rec.id === 'string' &&
          typeof rec.name === 'string' &&
          typeof rec.command === 'string'
        )
      })
      .map((a) => ({
        ...a,
        args: Array.isArray(a.args) ? a.args.map(String) : [],
        env: a.env && typeof a.env === 'object' ? a.env : {},
        useShell: a.useShell !== false
      }))
  }

  private persist(): void {
    this.store.set(this.cache)
  }

  get(): AppSettings {
    const { __schemaVersion, ...settings } = this.cache
    return settings
  }

  /** Merge a partial update. Unknown keys ignored; invalid values rejected. */
  update(partial: Partial<AppSettings>): Result<AppSettings> {
    const next: StoredSettings = { ...this.cache }
    for (const key of SETTING_KEYS) {
      if (key in partial) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(next as any)[key] = (partial as any)[key]
      }
    }
    if ('rootFolders' in partial) {
      next.rootFolders = dedupePaths(
        next.rootFolders.filter((p) => typeof p === 'string' && p.length > 0)
      )
    }
    next.customAgents = this.sanitizeAgents(next.customAgents)
    next.agentTabLabels = this.sanitizeLabels(next.agentTabLabels)
    const errors = validate(next)
    if (errors.length > 0) {
      return { ok: false, error: errors.join('; ') }
    }
    this.cache = next
    this.persist()
    const { __schemaVersion: _, ...result } = this.cache
    return { ok: true, data: result }
  }

  reset(): AppSettings {
    this.cache = { ...DEFAULT_SETTINGS, __schemaVersion: SCHEMA_VERSION }
    this.persist()
    const { __schemaVersion, ...settings } = this.cache
    return settings
  }

  isBuiltinDisabled(agentId: string): boolean {
    return this.cache.disabledBuiltinAgents.includes(agentId)
  }

  /** Merge a partial update. Unknown keys ignored; invalid values rejected. */
  setBuiltinDisabled(agentId: string, disabled: boolean): Result<AppSettings> {
    const set = new Set(this.cache.disabledBuiltinAgents)
    if (disabled) set.add(agentId)
    else set.delete(agentId)
    return this.update({ disabledBuiltinAgents: [...set] })
  }

  /** Absolute paths of all configured root folders. */
  rootFolderPaths(): string[] {
    return [...this.cache.rootFolders]
  }
}

export const settingsService = new SettingsService()
export { BUILTIN_AGENTS }
