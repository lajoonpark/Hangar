import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Ban, Pencil, RotateCcw, SquareTerminal, X, Zap, Sparkles, Bot } from 'lucide-react'
import type { AgentDefinition } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'

/**
 * Tab strip for tabbed terminal sessions.
 *
 * - Middle-click or ✕ closes a tab (killing its PTY); dead sessions show a
 *   ⌦-style marker until closed.
 * - Right-click opens a context menu: rename the tab (inline edit), reset a
 *   custom name, or close. Renames freeze live OSC-title updates until reset.
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

function MenuItem({
  icon,
  danger,
  onSelect,
  children
}: {
  icon?: React.ReactNode
  danger?: boolean
  onSelect(): void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={[
        'flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors focus:outline-none',
        danger
          ? 'text-red-600 hover:bg-red-500/10 focus:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:bg-red-900/30'
          : 'text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700/70 dark:focus:bg-zinc-700/70'
      ].join(' ')}
    >
      {icon && (
        <span className={danger ? 'text-red-500/70 dark:text-red-400/80' : 'text-zinc-400 dark:text-zinc-500'}>
          {icon}
        </span>
      )}
      {children}
    </button>
  )
}

export function TabBar({
  activeId,
  onActivate
}: {
  activeId: string | null
  onActivate(id: string): void
}): React.ReactElement {
  const { sessions, agents, exits } = useAppState()
  const { closeTab, renameSession } = useAppActions()

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Escape cancels the inline edit without committing (blur fires on unmount).
  const renameCancelled = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const startRename = (id: string): void => {
    renameCancelled.current = false
    setRenamingId(id)
  }

  // Clamp the menu inside the viewport (measured at paint time) and focus it
  // so arrow keys can move between items right after the right-click.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const x = Math.min(Math.max(8, menu.x + 2), window.innerWidth - el.offsetWidth - 8)
    const y = Math.min(Math.max(8, menu.y + 2), window.innerHeight - el.offsetHeight - 8)
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.focus()
  }, [menu])

  // Roving focus between menu items (↑/↓/Home/End; Enter clicks natively).
  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    e.stopPropagation()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    )
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (idx + 1 + items.length) % items.length
            : (idx - 1 + items.length) % items.length
    items[next].focus()
  }

  const agentById = useMemo(
    () => new Map<string, AgentDefinition>(agents.map((a) => [a.id, a])),
    [agents]
  )

  // Dismiss the context menu on outside clicks, window blur or resize.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (sessions.length === 0) return <div className="h-9 shrink-0" />

  return (
    <div
      className="no-drag flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-zinc-200/80 bg-zinc-100/60 px-2 dark:border-zinc-800/80 dark:bg-zinc-950/60"
      onScroll={() => setMenu(null)}
    >
      {sessions.map((s) => {
        const dead = !!exits[s.id]
        const active = s.id === activeId
        const renaming = renamingId === s.id
        const displayTitle =
          s.customTitle?.trim() || (dead ? agentById.get(s.agentId)?.name ?? s.title : s.title)

        const commitRename = (raw: string): void => {
          renameSession(s.id, raw.trim())
          setRenamingId(null)
        }

        return (
          <div
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!renaming) onActivate(s.id)
            }}
            onMouseDown={(e) => {
              if (e.button === 1 && !renaming) void closeTab(s.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setRenamingId(null)
              if (s.id !== activeId) onActivate(s.id)
              setMenu({ id: s.id, x: e.clientX, y: e.clientY })
            }}
            title={dead ? `Exited (${exits[s.id].exitCode}) — click ✕ to close` : displayTitle}
            className={[
              'group flex h-[30px] max-w-[220px] min-w-[120px] cursor-default select-none items-center gap-2',
              'rounded-t-lg px-3 text-xs transition-colors',
              active
                ? 'bg-white text-zinc-800 shadow-tile dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
            ].join(' ')}
          >
            {renaming ? (
              <input
                autoFocus
                spellCheck={false}
                defaultValue={s.customTitle?.trim() || s.title}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename(e.currentTarget.value)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    renameCancelled.current = true
                    setRenamingId(null)
                  }
                }}
                onBlur={(e) => {
                  if (renameCancelled.current) {
                    renameCancelled.current = false
                    return
                  }
                  commitRename(e.currentTarget.value)
                }}
                aria-label="Tab name"
                className="h-[22px] w-full min-w-0 flex-1 rounded-[5px] border border-accent bg-white px-1.5 font-mono text-[11px] text-zinc-800 shadow-tile outline-none ring-2 ring-accent/25 transition-colors focus:border-accent-soft dark:bg-zinc-900 dark:text-zinc-100 dark:ring-accent/20"
              />
            ) : (
              <>
                {dead ? (
                  <Ban size={11} className="shrink-0 text-red-400" />
                ) : (
                  <TabGlyph agentId={s.agentId} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {dead ? `${displayTitle} — exited` : displayTitle}
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
              </>
            )}
          </div>
        )
      })}

      {menu &&
        (() => {
          const target = sessions.find((s) => s.id === menu.id)
          if (!target) return null
          return (
            <div
              ref={menuRef}
              role="menu"
              tabIndex={-1}
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={onMenuKeyDown}
              className="no-drag animate-pop-in fixed z-50 w-48 origin-top-left overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-menu dark:border-zinc-700 dark:bg-zinc-800"
            >
              <MenuItem
                icon={<Pencil size={12} />}
                onSelect={() => {
                  setMenu(null)
                  startRename(target.id)
                }}
              >
                Rename tab…
              </MenuItem>
              {target.customTitle?.trim() && (
                <MenuItem
                  icon={<RotateCcw size={12} />}
                  onSelect={() => {
                    setMenu(null)
                    renameSession(target.id, '')
                  }}
                >
                  Reset name
                </MenuItem>
              )}
              <div role="separator" className="mx-1.5 my-1 h-px bg-zinc-200/90 dark:bg-zinc-700/60" />
              <MenuItem
                danger
                icon={<X size={12} />}
                onSelect={() => {
                  setMenu(null)
                  void closeTab(target.id)
                }}
              >
                Close tab
              </MenuItem>
            </div>
          )
        })()}
    </div>
  )
}
