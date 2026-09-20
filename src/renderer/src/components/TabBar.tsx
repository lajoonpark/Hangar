import { Ban, SquareTerminal, X, Zap, Sparkles, Bot } from 'lucide-react'
import type { AgentDefinition } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'

/**
 * Tab strip for tabbed terminal sessions. Middle-click or ✕ closes a tab
 * (killing its PTY); dead sessions show a ⌦ marker until closed.
 */

function TabGlyph({ agentId }: { agentId: string }): React.ReactElement {
  const icon =
    agentId === 'kilo' ? (
      <Zap size={11} />
    ) : agentId === 'claude' || agentId === 'opencode' || agentId === 'pi' ? (
      <Sparkles size={11} />
    ) : agentId === 'cursor' ? (
      <Bot size={11} />
    ) : (
      <SquareTerminal size={11} />
    )
  return <span className="shrink-0 text-accent-dim dark:text-accent-soft">{icon}</span>
}

export function TabBar({
  activeId,
  onActivate
}: {
  activeId: string | null
  onActivate(id: string): void
}): React.ReactElement {
  const { sessions, agents, exits } = useAppState()
  const { closeTab } = useAppActions()

  const agentById = new Map<string, AgentDefinition>(agents.map((a) => [a.id, a]))

  if (sessions.length === 0) return <div className="h-9 shrink-0" />

  return (
    <div className="no-drag flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-zinc-200/80 bg-zinc-100/60 px-2 dark:border-zinc-800/80 dark:bg-zinc-950/60">
      {sessions.map((s) => {
        const dead = !!exits[s.id]
        const active = s.id === activeId
        return (
          <div
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(s.id)}
            onMouseDown={(e) => {
              if (e.button === 1) void closeTab(s.id)
            }}
            title={dead ? `Exited (${exits[s.id].exitCode}) — click ✕ to close` : s.title}
            className={[
              'group flex h-[30px] max-w-[220px] min-w-[120px] cursor-default select-none items-center gap-2',
              'rounded-t-lg px-3 text-xs transition-colors',
              active
                ? 'bg-white text-zinc-800 shadow-tile dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
            ].join(' ')}
          >
            {dead ? <Ban size={11} className="shrink-0 text-red-400" /> : <TabGlyph agentId={s.agentId} />}
            <span className="min-w-0 flex-1 truncate">
              {dead ? `${agentById.get(s.agentId)?.name ?? s.title} — exited` : s.title}
            </span>
            <button
              type="button"
              aria-label="Close tab"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                void closeTab(s.id)
              }}
              className="ml-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-300/60 hover:text-zinc-700 group-hover:flex dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
