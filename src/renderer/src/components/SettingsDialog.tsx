import { useEffect, useState } from 'react'
import {
  Database,
  Folder,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Sliders,
  SquareTerminal,
  Trash2,
  UserPlus,
  X
} from 'lucide-react'
import type { AgentDefinition, NewAgentPayload } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'
import { isMac } from '@renderer/hooks/useTheme'
import {
  Button,
  Field,
  IconButton,
  Modal,
  ModalHeader,
  Segmented,
  TextArea,
  Toggle,
  inputClass
} from './ui'

/**
 * Settings window content: General | Agents | Appearance | Advanced.
 * Every change is persisted immediately through the backend.
 */

type Tab = 'general' | 'agents' | 'appearance' | 'advanced'

export function SettingsDialog({
  initialTab,
  onClose
}: {
  initialTab: Tab
  onClose(): void
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab)

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <LayoutGrid size={14} /> },
    { id: 'agents', label: 'Agents', icon: <SquareTerminal size={14} /> },
    { id: 'appearance', label: 'Appearance', icon: <Sliders size={14} /> },
    { id: 'advanced', label: 'Advanced', icon: <Database size={14} /> }
  ]

  return (
    <Modal onClose={onClose} width="max-w-2xl" labelledBy="settings-title">
      <ModalHeader id="settings-title" title="Settings" onClose={onClose} />
      <div className="flex min-h-[420px]">
        <nav className="w-40 shrink-0 border-r border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-950/50">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-white text-zinc-900 shadow-tile dark:bg-zinc-800 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
          {tab === 'general' && <GeneralTab />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'advanced' && <AdvancedTab onDone={onClose} />}
        </div>
      </div>
    </Modal>
  )
}

// ── General ────────────────────────────────────────────────────────────────

function GeneralTab(): React.ReactElement {
  const { settings, roots, scanning } = useAppState()
  const { removeFolder, addFolders, updateSettings } = useAppActions()
  if (!settings) return <Loading />

  return (
    <section className="space-y-6">
      <div>
        <SectionTitle
          title="Root folders"
          desc="Immediate subfolders of these directories are shown as launchable repos."
        />
        <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {roots.length === 0 && (
            <li className="px-3 py-3 text-[13px] text-zinc-400">No root folders yet.</li>
          )}
          {roots.map((root) => (
            <li key={root.id} className="flex items-center gap-3 px-3 py-2">
              <Folder size={15} className="shrink-0 text-accent-dim dark:text-accent-soft" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                  {root.name}
                </span>
                <span className="block truncate text-[11px] text-zinc-400">{root.path}</span>
              </span>
              {scanning[root.id] && (
                <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
              )}
              <IconButton
                label="Remove root folder"
                danger
                onClick={() => void removeFolder(root.id)}
              >
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button className="mt-2" onClick={() => void addFolders()}>
          <Plus size={13} />
          Add folder…
        </Button>
      </div>

      <div>
        <SectionTitle title="Sort repositories" />
        <div className="mt-2">
          <Segmented
            value={settings.sortOrder}
            options={[
              { value: 'recent', label: 'Recently opened' },
              { value: 'alpha', label: 'Alphabetical' },
              { value: 'manual', label: 'Manual' }
            ]}
            onChange={(order) => void updateSettings({ sortOrder: order })}
          />
        </div>
      </div>

      <div>
        <SectionTitle title="Terminal windows" desc="How new agent sessions are opened." />
        <div className="mt-2">
          <Segmented
            value={settings.windowMode}
            options={[
              { value: 'tabs', label: 'Tabs' },
              { value: 'windows', label: 'Windows' },
              { value: 'both', label: 'Choose per launch' }
            ]}
            onChange={(mode) => void updateSettings({ windowMode: mode })}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">
          With “Choose per launch”, sessions open as tabs by default — {isMac ? '⌘' : 'Ctrl'}-click
          an agent to open a window instead.
        </p>
      </div>
    </section>
  )
}

// ── Agents ─────────────────────────────────────────────────────────────────

function AgentsTab(): React.ReactElement {
  const { agents } = useAppState()
  const { toggleBuiltinAgent, deleteAgent } = useAppActions()
  const [editing, setEditing] = useState<AgentDefinition | 'new' | null>(null)

  const builtins = agents.filter((a) => a.builtin)
  const customs = agents.filter((a) => !a.builtin)

  if (editing) {
    return editing === 'new' ? (
      <AgentForm onCancel={() => setEditing(null)} />
    ) : (
      <AgentForm agent={editing} onCancel={() => setEditing(null)} />
    )
  }

  return (
    <section className="space-y-6">
      <div>
        <SectionTitle
          title="Built-in agents"
          desc="Disable the ones you never use; edit the letter(s) shown in default tab names (e.g. K_hangar)."
        />
        <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {builtins.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13px] font-medium ${
                    a.disabled ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-100'
                  }`}
                >
                  {a.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-zinc-400">
                  {a.command}
                </span>
              </span>
              <BuiltinLabelEditor agent={a} />
              <Toggle
                checked={!a.disabled}
                label={`Enable ${a.name}`}
                onChange={(enabled) => void toggleBuiltinAgent(a.id, !enabled)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <SectionTitle title="Custom agents" desc="Your own commands and wrappers." />
          <Button className="mb-2" onClick={() => setEditing('new')}>
            <UserPlus size={13} />
            New agent
          </Button>
        </div>
        {customs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-[13px] text-zinc-400 dark:border-zinc-700">
            No custom agents yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {customs.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                    {a.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-zinc-400">
                    {a.command} {a.args?.join(' ') ?? ''}
                  </span>
                </span>
                <IconButton label="Edit agent" onClick={() => setEditing(a)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton label="Delete agent" danger onClick={() => void deleteAgent(a.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ── Agent tab-label editor (built-in rows) ────────────────────────────────

function BuiltinLabelEditor({ agent }: { agent: AgentDefinition }): React.ReactElement {
  const { setAgentTabLabel } = useAppActions()
  const [value, setValue] = useState(agent.tabLabel)

  // Re-sync if the effective label changes externally (e.g. settings reset).
  useEffect(() => setValue(agent.tabLabel), [agent.tabLabel])

  const commit = (): void => {
    const next = value.trim()
    if (next === agent.tabLabel) {
      setValue(agent.tabLabel)
      return
    }
    void setAgentTabLabel(agent.id, next)
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      maxLength={8}
      spellCheck={false}
      aria-label={`Tab label for ${agent.name}`}
      title="Tab label — letter(s) used in default tab names, e.g. K_hangar"
      className="h-7 w-14 shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 text-center font-mono text-xs text-zinc-700 transition-colors placeholder:text-zinc-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
    />
  )
}

function AgentForm({
  agent,
  onCancel
}: {
  agent?: AgentDefinition
  onCancel(): void
}): React.ReactElement {
  const { addAgent, saveAgent } = useAppActions()
  const [name, setName] = useState(agent?.name ?? '')
  const [command, setCommand] = useState(agent?.command ?? '')
  const [argsText, setArgsText] = useState(agent?.args?.join(' ') ?? '')
  const [envText, setEnvText] = useState(
    Object.entries(agent?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )
  const [useShell, setUseShell] = useState(agent?.useShell ?? true)
  const [dirOverride, setDirOverride] = useState(agent?.workingDirOverride ?? '')
  const [tabLabel, setTabLabel] = useState(agent?.tabLabel ?? '')
  const [advanced, setAdvanced] = useState(
    !!agent?.env || agent?.workingDirOverride !== undefined || agent?.useShell === false
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseEnv = (): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const line of envText.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
    }
    return env
  }

  const submit = async (): Promise<void> => {
    if (!name.trim() || !command.trim()) {
      setError('Name and command are required.')
      return
    }
    const payload: NewAgentPayload = {
      name: name.trim(),
      command: command.trim(),
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      env: parseEnv(),
      useShell,
      tabLabel: tabLabel.trim()
    }
    if (dirOverride.trim()) payload.workingDirOverride = dirOverride.trim()
    setBusy(true)
    setError(null)
    try {
      if (agent) {
        await saveAgent({ ...agent, ...payload })
      } else {
        await addAgent(payload)
      }
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle title={agent ? `Edit “${agent.name}”` : 'New agent'} />
        <IconButton label="Back to agents" onClick={onCancel}>
          <X size={14} />
        </IconButton>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My linter agent"
            className={inputClass}
          />
        </Field>
        <Field label="Command" hint="Found via PATH when “run in shell” is on.">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="opencode"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Arguments" hint="Space-separated. Quoted values are not parsed.">
        <input
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder="--model opus --verbose"
          className={inputClass}
        />
      </Field>

      <Field
        label="Tab label"
        hint="Letter(s) used in default tab names — e.g. setting K gives “K_repo”. Leave blank to use the first letter of the name."
      >
        <input
          value={tabLabel}
          onChange={(e) => setTabLabel(e.target.value)}
          placeholder="K"
          maxLength={8}
          spellCheck={false}
          className={`${inputClass} w-28 font-mono text-center`}
        />
      </Field>

      <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div>
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Run in shell</p>
          <p className="text-[11px] text-zinc-400">
            Resolves aliases and PATH. Turn off for direct executables.
          </p>
        </div>
        <Toggle checked={useShell} onChange={setUseShell} label="Run in shell" />
      </div>

      <button
        type="button"
        onClick={() => setAdvanced(!advanced)}
        className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {advanced ? '− Hide advanced' : '+ Advanced'}
      </button>

      {advanced && (
        <div className="space-y-3">
          <Field label="Environment variables" hint="One per line: KEY=value">
            <TextArea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={'AGENT_API_KEY=abc123\nDEBUG=1'}
              spellCheck={false}
            />
          </Field>
          <Field label="Working directory override" hint="Rarely needed; defaults to the repo path.">
            <input
              value={dirOverride}
              onChange={(e) => setDirOverride(e.target.value)}
              placeholder="/absolute/path"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          {agent ? 'Save changes' : 'Create agent'}
        </Button>
      </div>
    </section>
  )
}

// ── Appearance ─────────────────────────────────────────────────────────────

function AppearanceTab(): React.ReactElement {
  const { settings } = useAppState()
  const { updateSettings } = useAppActions()
  if (!settings) return <Loading />

  return (
    <section className="space-y-6">
      <div>
        <SectionTitle title="Theme" />
        <div className="mt-2">
          <Segmented
            value={settings.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
            onChange={(theme) => void updateSettings({ theme })}
          />
        </div>
      </div>

      <div>
        <SectionTitle title="Terminal font size" />
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={8}
            max={24}
            step={1}
            value={settings.terminalFontSize}
            onChange={(e) => void updateSettings({ terminalFontSize: Number(e.target.value) })}
            className="no-drag h-1.5 flex-1 cursor-pointer accent-[#f59e0b]"
          />
          <span className="w-10 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {settings.terminalFontSize}px
          </span>
        </div>
      </div>

      <div>
        <SectionTitle title="Terminal font family" />
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: 'SF Mono / Menlo', value: 'Menlo, Consolas, monospace' },
            { label: 'System mono', value: 'ui-monospace, monospace' },
            { label: 'Custom…', value: '' }
          ].map((preset) =>
            preset.value ? (
              <Button
                key={preset.label}
                variant={
                  settings.terminalFontFamily === preset.value ? 'primary' : 'secondary'
                }
                onClick={() => void updateSettings({ terminalFontFamily: preset.value })}
              >
                {preset.label}
              </Button>
            ) : null
          )}
        </div>
        <input
          value={settings.terminalFontFamily}
          onChange={(e) => void updateSettings({ terminalFontFamily: e.target.value })}
          spellCheck={false}
          placeholder="Menlo, Consolas, monospace"
          className={`${inputClass} mt-2 font-mono text-xs`}
        />
      </div>
    </section>
  )
}

// ── Advanced ───────────────────────────────────────────────────────────────

function AdvancedTab({ onDone }: { onDone(): void }): React.ReactElement {
  const { settings } = useAppState()
  const { updateSettings, resetSettings } = useAppActions()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!settings) return <Loading />

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
        <div>
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
            Repo indexing
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
            Builds a local LanceDB full-text index per repo so agents and search can find code
            fast. Indexes are stored offline in your user data folder.
          </p>
        </div>
        <Toggle
          checked={settings.repoIndexEnabled}
          onChange={(v) => void updateSettings({ repoIndexEnabled: v })}
          label="Repo indexing"
        />
      </div>

      <div className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Storage</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
          Settings live in <span className="font-mono">hangar-settings.json</span> inside your
          user data directory; repo indexes in <span className="font-mono">repo-index.lance</span>.
          Everything stays on this machine — no network calls, no telemetry.
        </p>
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50/50 p-3.5 dark:border-red-900/50 dark:bg-red-950/20">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Reset settings</p>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Restores defaults: root folders, custom agents, theme, fonts and window mode.
        </p>
        <div className="mt-2.5">
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" disabled={busy} onClick={() => {
                setBusy(true)
                void resetSettings().finally(() => {
                  setBusy(false)
                  setConfirming(false)
                  onDone()
                })
              }}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                Yes, reset everything
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <RotateCcw size={13} />
              Reset to defaults…
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Shared bits ────────────────────────────────────────────────────────────

function SectionTitle({ title, desc }: { title: string; desc?: string }): React.ReactElement {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
      {desc && <p className="mt-0.5 text-[11px] text-zinc-400">{desc}</p>}
    </div>
  )
}

function Loading(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center py-16">
      <Loader2 size={18} className="animate-spin text-zinc-400" />
    </div>
  )
}

export type { Tab as SettingsTab }
