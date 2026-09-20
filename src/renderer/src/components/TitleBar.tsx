import { Moon, Settings, Sun, Warehouse } from 'lucide-react'
import { useAppState, useAppActions } from '@renderer/state/AppProvider'
import { isMac } from '@renderer/hooks/useTheme'
import { IconButton } from './ui'

/**
 * Frameless-window title bar: drag region, wordmark, global actions.
 * On macOS the left padding reserves space for the traffic lights.
 */
export function TitleBar({ onOpenSettings }: { onOpenSettings(): void }): React.ReactElement {
  const { settings } = useAppState()
  const { updateSettings } = useAppActions()
  const dark = (settings?.theme ?? 'system') === 'dark'

  return (
    <header
      className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-zinc-200/80 bg-white/80 pl-3 pr-2 dark:border-zinc-800/80 dark:bg-zinc-950/80"
      style={isMac ? { paddingLeft: 78 } : undefined}
    >
      <div className="flex items-center gap-2 pointer-events-none select-none">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-accent text-zinc-950">
          <Warehouse size={13} strokeWidth={2.4} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
          Hangar
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton
          label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Settings (⌘,)" onClick={onOpenSettings}>
          <Settings size={15} />
        </IconButton>
      </div>
    </header>
  )
}
