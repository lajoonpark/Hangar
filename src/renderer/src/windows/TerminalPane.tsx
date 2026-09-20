import { useState } from 'react'
import { CircleAlert, RotateCcw, X } from 'lucide-react'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'
import { TerminalView } from '@renderer/components/Terminal'

/**
 * Renders every session's terminal (stacked; only the active one visible)
 * plus the "process exited" overlay for dead sessions.
 */
export function TerminalPane({ activeId, dark }: { activeId: string | null; dark: boolean }): React.ReactElement {
  const { settings, sessions, exits, tiles } = useAppState()
  const { closeTab, spawnTerminal } = useAppActions()
  const [reopening, setReopening] = useState<string | null>(null)

  const exitCodeOf = (id: string): number | undefined => exits[id]?.exitCode

  return (
    <div className="relative min-h-0 flex-1 bg-white dark:bg-[#0c0c0f]">
      {sessions.map((s) => (
        <TerminalView
          key={s.id}
          session={s}
          active={s.id === activeId}
          fontSize={settings?.terminalFontSize ?? 13}
          fontFamily={settings?.terminalFontFamily ?? 'Menlo, Consolas, monospace'}
          dark={dark}
        />
      ))}

      {activeId && exits[activeId] && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-amber-300/50 bg-amber-50/95 px-4 py-2.5 backdrop-blur dark:border-amber-700/40 dark:bg-amber-950/60">
          <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
            <CircleAlert size={14} />
            <span>
              <span className="font-medium">
                {sessions.find((s) => s.id === activeId)?.title ?? 'Session'} exited
              </span>
              {exitCodeOf(activeId) !== 0 && (
                <span className="ml-1.5 font-mono">(code {exitCodeOf(activeId)})</span>
              )}
            </span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={reopening === activeId}
              onClick={() => {
                const dead = sessions.find((s) => s.id === activeId)
                if (!dead) return
                const tile = tiles.find((t) => t.id === dead.repoTileId)
                setReopening(activeId)
                void closeTab(activeId)
                  .catch(() => undefined)
                  .then(async () => {
                    if (tile) {
                      await spawnTerminal(
                        { repoTileId: dead.repoTileId, agentId: dead.agentId, mode: 'tab' },
                        tile
                      ).catch(() => undefined)
                    }
                  })
                  .finally(() => setReopening(null))
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-200/60 dark:text-amber-200 dark:hover:bg-amber-900/50"
            >
              <RotateCcw size={11} className={reopening ? 'animate-spin' : ''} />
              Relaunch
            </button>
            <button
              type="button"
              onClick={() => void closeTab(activeId)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-200/60 dark:text-amber-200 dark:hover:bg-amber-900/50"
            >
              <X size={11} />
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
