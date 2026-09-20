import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Bot, Search, Settings2, Sparkles, TerminalSquare, Zap } from 'lucide-react'
import type { AgentDefinition, RepoTile } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'
import { isMac } from '@renderer/hooks/useTheme'
import { Kbd, Modal, ModalHeader } from './ui'

/**
 * Agent picker — opened from a repo tile. Lists enabled built-in and custom
 * agents with keyboard navigation (↑ ↓ Enter, Esc). Choosing an agent spawns
 * a terminal; the mode (tab vs window) follows settings.windowMode, with
 * ⌘/Ctrl-click flipping it when the mode is 'both'.
 */

function AgentGlyph({ agent }: { agent: AgentDefinition }): React.ReactElement {
  const icon =
    agent.id === 'kilo' ? (
      <Zap size={16} />
    ) : agent.id === 'claude' || agent.id === 'opencode' || agent.id === 'pi' ? (
      <Sparkles size={15} />
    ) : agent.id === 'cursor' ? (
      <Bot size={16} />
    ) : (
      <TerminalSquare size={15} />
    )
  const tone = agent.builtin
    ? 'from-amber-50 to-amber-100 text-amber-600 ring-amber-200/60 dark:from-amber-950/40 dark:to-amber-900/30 dark:text-amber-400 dark:ring-amber-900/50'
    : 'from-zinc-100 to-zinc-200 text-zinc-500 ring-zinc-300/60 dark:from-zinc-800 dark:to-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b ring-1 ${tone}`}
    >
      {icon}
    </span>
  )
}

export function AgentPicker({
  tile,
  onClose,
  onManageAgents
}: {
  tile: RepoTile
  onClose(): void
  onManageAgents(): void
}): React.ReactElement {
  const { agents, settings } = useAppState()
  const { spawnTerminal } = useAppActions()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { builtins, customs } = useMemo(() => {
    const enabled = agents.filter((a) => !a.disabled)
    const q = query.trim().toLowerCase()
    const match = (a: AgentDefinition): boolean =>
      !q || a.name.toLowerCase().includes(q) || a.command.toLowerCase().includes(q)
    return {
      builtins: enabled.filter((a) => a.builtin && match(a)),
      customs: enabled.filter((a) => !a.builtin && match(a))
    }
  }, [agents, query])

  const flat = useMemo(() => [...builtins, ...customs], [builtins, customs])
  useEffect(() => setCursor(0), [query])

  const launch = async (agent: AgentDefinition, flipMode: boolean): Promise<void> => {
    const windowMode = settings?.windowMode ?? 'both'
    const base: 'tab' | 'window' = windowMode === 'windows' ? 'window' : 'tab'
    const mode = flipMode && windowMode !== 'tabs' && windowMode !== 'windows'
      ? base === 'tab' ? 'window' : 'tab'
      : base
    try {
      setError(null)
      await spawnTerminal({ repoTileId: tile.id, agentId: agent.id, mode }, tile)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, flat.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (e.key === 'Enter' && flat[cursor]) {
        e.preventDefault()
        void launch(flat[cursor], e.metaKey || e.ctrlKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, cursor])

  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const renderGroup = (label: string, group: AgentDefinition[], offset: number): React.ReactElement | null =>
    group.length === 0 ? null : (
      <div>
        <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {label}
        </p>
        {group.map((agent, i) => {
          const idx = offset + i
          const isCursor = idx === cursor
          return (
            <button
              key={agent.id}
              type="button"
              data-cursor={isCursor}
              onMouseEnter={() => setCursor(idx)}
              onClick={(e) => void launch(agent, e.metaKey || e.ctrlKey)}
              className={[
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                isCursor ? 'bg-accent/10' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
              ].join(' ')}
            >
              <AgentGlyph agent={agent} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                  {agent.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  {agent.command}
                  {agent.args && agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    )

  const modeHint =
    settings?.windowMode === 'windows'
      ? 'Opens in a new window'
      : settings?.windowMode === 'tabs'
        ? 'Opens in a tab'
        : `Opens in a tab · ${isMac ? '⌘' : 'Ctrl'}-click for a new window`

  return (
    <Modal onClose={onClose} width="max-w-sm" labelledBy="agent-picker-title">
      <ModalHeader
        id="agent-picker-title"
        title={`Open “${tile.name}”`}
        subtitle={tile.path}
        onClose={onClose}
      />

      <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            spellCheck={false}
            className="no-drag selectable h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-14 text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:border-accent focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 gap-0.5">
            <Kbd>↑↓</Kbd>
            <Kbd>↩</Kbd>
          </span>
        </div>
      </div>

      <div ref={listRef} className="max-h-[46vh] overflow-y-auto px-1.5 pb-1">
        {flat.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-zinc-400">
            {agents.length === 0 ? 'No agents configured.' : 'No agents match your search.'}
          </p>
        ) : (
          <>
            {renderGroup('Built-in', builtins, 0)}
            {renderGroup('Custom', customs, builtins.length)}
          </>
        )}
        {agents.some((a) => a.disabled) && (
          <p className="flex items-center gap-1.5 px-3 pb-2 pt-1 text-[11px] text-zinc-400">
            <Ban size={11} />
            Disabled agents can be re-enabled in Settings → Agents.
          </p>
        )}
      </div>

      {error && (
        <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-2.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <span className="truncate">{modeHint}</span>
        <button
          type="button"
          onClick={onManageAgents}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-500 hover:text-accent-dim dark:text-zinc-400 dark:hover:text-accent-soft"
        >
          <Settings2 size={12} />
          Manage agents
        </button>
      </div>
    </Modal>
  )
}
