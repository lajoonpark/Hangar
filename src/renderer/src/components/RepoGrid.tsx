import { useMemo, useState } from 'react'
import { FolderSearch, RefreshCw, Warehouse } from 'lucide-react'
import type { RepoIndexStatus, RepoTile } from '@shared/types'
import { useAppActions, useAppState } from '@renderer/state/AppProvider'
import { Button, inputClass } from './ui'
import { RepoTile as RepoTileCard } from './RepoTile'

/**
 * The repo grid with client-side name filtering, plus the first-run
 * welcome and the "no repos found" empty state.
 */

interface GridProps {
  tiles: RepoTile[]
  indexStatuses: Record<string, RepoIndexStatus>
  scanning: boolean
  onSelect(tile: RepoTile, openInWindow: boolean): void
  variant?: 'grid' | 'row'
}

export function useTileFilter(tiles: RepoTile[]): [RepoTile[], string, (q: string) => void] {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tiles
    return tiles.filter(
      (t) => t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q)
    )
  }, [tiles, query])
  return [filtered, query, setQuery]
}

export function RepoGrid({
  tiles,
  indexStatuses,
  scanning,
  onSelect,
  variant = 'grid'
}: GridProps): React.ReactElement {
  const [filtered, query, setQuery] = useTileFilter(tiles)
  const { rescanAll } = useAppActions()
  const { sessions } = useAppState()
  // Repos that currently have at least one open session → green "open" tick
  const openIds = useMemo(() => new Set(sessions.map((s) => s.repoTileId)), [sessions])

  if (tiles.length === 0) {
    return <NoRepos scanning={scanning} onRescan={() => void rescanAll()} />
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
      <div className="mb-3 max-w-md">
        <div className="relative">
          <FolderSearch
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter repositories…"
            spellCheck={false}
            className={`${inputClass} h-8 pl-8`}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-400">No repositories match “{query}”.</p>
      ) : variant === 'row' ? (
        <div className="flex flex-col gap-0.5">
          {filtered.map((tile) => (
            <RepoTileCard
              key={tile.id}
              tile={tile}
              indexStatus={indexStatuses[tile.id]}
              isOpen={openIds.has(tile.id)}
              onSelect={onSelect}
              compact
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {filtered.map((tile) => (
            <RepoTileCard
              key={tile.id}
              tile={tile}
              indexStatus={indexStatuses[tile.id]}
              isOpen={openIds.has(tile.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoRepos({
  scanning,
  onRescan
}: {
  scanning: boolean
  onRescan(): void
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-50 to-amber-100 text-amber-600 ring-1 ring-amber-200/70 dark:from-amber-950/40 dark:to-amber-900/20 dark:text-amber-400 dark:ring-amber-900/60">
        {scanning ? (
          <RefreshCw size={22} className="animate-spin" />
        ) : (
          <Warehouse size={24} />
        )}
      </div>
      <h2 className="mt-4 text-base font-semibold text-zinc-800 dark:text-zinc-100">
        {scanning ? 'Scanning your folders…' : 'No repos found yet'}
      </h2>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        {scanning
          ? 'Hangar is reading the immediate subfolders of your root folders.'
          : 'Subfolders of your root folders will appear here as launchable repos. Make sure your root folders actually contain project folders, or rescan.'}
      </p>
      {!scanning && (
        <Button className="mt-4" onClick={onRescan}>
          <RefreshCw size={13} />
          Rescan folders
        </Button>
      )}
    </div>
  )
}

export function Welcome({ onAddFolders }: { onAddFolders(): void }): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-400 to-amber-500 text-zinc-950 shadow-tile-hover ring-1 ring-amber-600/40">
        <Warehouse size={28} strokeWidth={2.2} />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Welcome to Hangar
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        Point Hangar at folders full of projects and launch your coding agents — kilo, Claude
        Code, aider, OpenCode or your own commands — straight into any repo.
      </p>

      <Button variant="primary" className="mt-6 h-9 px-4 text-sm" onClick={onAddFolders}>
        Add Root Folder…
      </Button>

      <ul className="mt-10 grid gap-3 text-left sm:grid-cols-3">
        {[
          ['One-click agents', 'Pick a repo, pick an agent — a live terminal opens in that folder.'],
          ['Tabs or windows', 'Run many sessions side by side, in tabs or separate windows.'],
          ['Local-first', 'Settings, usage history and repo search live entirely on your machine.']
        ].map(([title, body]) => (
          <li
            key={title}
            className="max-w-[220px] rounded-xl border border-zinc-200 bg-white p-3.5 shadow-tile dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
