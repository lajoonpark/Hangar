import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Boot overlay: a small, unobtrusive spinner pill shown while a terminal
 * session is alive but the agent hasn't printed anything yet. Sits above the
 * xterm surface but is pointer-events-none, so typing/scrolling still works.
 *
 * 'booting' → quiet "Starting <agent>…" · 'stalled' → escalated wording
 * (the PTY is alive; the agent is just slow to produce output).
 */
export function BootOverlay({
  state,
  agentLabel,
  startedAt
}: {
  state: 'booting' | 'stalled'
  agentLabel: string
  startedAt: number
}): React.ReactElement {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  )

  useEffect(() => {
    const tick = (): void =>
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const stalled = state === 'stalled'

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="animate-fade-in flex items-center gap-2.5 rounded-full border border-zinc-200/80 bg-white/85 px-4 py-2 shadow-sm backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-900/75">
        <Loader2 size={14} className="shrink-0 animate-spin text-amber-500 dark:text-amber-400" />
        <p
          className={`text-xs leading-none ${
            stalled ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {stalled ? (
            <>
              Still starting <span className="font-medium">{agentLabel}</span>… this is taking
              longer than usual
            </>
          ) : (
            <>
              Starting <span className="font-medium">{agentLabel}</span>…
            </>
          )}
          <span className="ml-2 font-mono tabular-nums opacity-70">{elapsed}s</span>
        </p>
      </div>
    </div>
  )
}
