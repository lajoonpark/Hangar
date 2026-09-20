import { AlertTriangle, Check, Clock, Folder, Loader2, RefreshCw, Search } from 'lucide-react'
import type { RepoIndexStatus, RepoTile } from '@shared/types'
import { relativeTime } from './ui'

/**
 * Repo tiles. Two variants: 'grid' (main view cards) and 'row'
 * (compact list rows for the sidebar). A small status dot reflects the
 * repo's LanceDB index state; click anywhere to open the agent picker.
 */

export function IndexDot({ status }: { status?: RepoIndexStatus }): React.ReactElement | null {
  if (!status) return null
  switch (status.state) {
    case 'indexing':
    case 'queued':
      return (
        <span title="Indexing…" className="inline-flex">
          <Loader2 size={11} className="animate-spin text-accent" />
        </span>
      )
    case 'ready': {
      const tip =
        status.files > 0
          ? `Indexed · ${status.files} files · ${status.chunks} chunks`
          : 'Indexed'
      return (
        <span title={tip} className="inline-flex">
          <Check size={11} className="text-emerald-500" strokeWidth={3} />
        </span>
      )
    }
    case 'error':
      return (
        <span
          title={status.error ? `Index error: ${status.error}` : 'Index error'}
          className="inline-flex"
        >
          <AlertTriangle size={11} className="text-red-500" />
        </span>
      )
    default:
      return null
  }
}

interface TileProps {
  tile: RepoTile
  indexStatus?: RepoIndexStatus
  onSelect(tile: RepoTile, openInWindow: boolean): void
  compact?: boolean
}

export function RepoTile({ tile, indexStatus, onSelect, compact }: TileProps): React.ReactElement {
  const opened = relativeTime(tile.lastOpenedAt)

  if (compact) {
    return (
      <button
        type="button"
        title={`${tile.name}\n${tile.path}`}
        onClick={(e) => onSelect(tile, e.metaKey || e.ctrlKey)}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-b from-zinc-100 to-zinc-200 text-zinc-500 shadow-tile dark:from-zinc-800 dark:to-zinc-800 dark:text-zinc-400">
          <Folder size={14} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
            {tile.name}
          </span>
          {opened && (
            <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">
              opened {opened}
            </span>
          )}
        </span>
        <IndexDot status={indexStatus} />
      </button>
    )
  }

  return (
    <button
      type="button"
      title={`${tile.name}\n${tile.path}`}
      onClick={(e) => onSelect(tile, e.metaKey || e.ctrlKey)}
      className={[
        'group relative flex flex-col rounded-xl border p-3.5 text-left shadow-tile transition-all',
        'border-zinc-200 bg-white hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-tile-hover',
        'dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-accent/50 dark:hover:bg-zinc-800/80'
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-amber-50 to-amber-100 text-amber-600 ring-1 ring-amber-200/60 dark:from-amber-950/40 dark:to-amber-900/30 dark:text-amber-400 dark:ring-amber-900/50">
          <Folder size={17} strokeWidth={2} />
        </span>
        <span className="flex items-center gap-1.5 pt-1">
          <IndexDot status={indexStatus} />
        </span>
      </div>

      <span className="mt-3 block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {tile.name}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
        {tile.path}
      </span>

      <span className="mt-2.5 flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
        {opened ? (
          <>
            <Clock size={10} />
            {opened}
            {tile.openCount > 1 && (
              <span className="ml-auto tabular-nums">
                {tile.openCount}×
              </span>
            )}
          </>
        ) : (
          <>
            <Search size={10} className="opacity-0" />
            <span>Never opened</span>
          </>
        )}
      </span>
    </button>
  )
}

/** Small "rescan" affordance used by the toolbar while a scan runs. */
export function ScanningBadge(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-dim dark:text-accent-soft">
      <RefreshCw size={11} className="animate-spin" />
      Scanning…
    </span>
  )
}
