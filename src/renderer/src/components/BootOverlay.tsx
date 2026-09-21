import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Boot overlay: a small, unobtrusive spinner pill shown while a terminal
 * session is alive but the agent hasn't printed anything yet. Sits above the
 * xterm surface but is pointer-events-none, so typing/scrolling still works.
 *
 * Three states, escalating in prominence:
 * - 'booting'   → quiet "Starting <agent>…" (PTY spawned, no output yet)
 * - 'rendering' → "Waiting for <agent> to render…" — output bytes have
 *   arrived but xterm hasn't painted visible content yet (typical short
 *   blank window for full-screen TUIs like kilo). Copy changes but the
 *   treatment stays quiet: no amber, no urgency.
 * - 'stalled'   → amber wording; the PTY is alive but the agent is slow to
 *   produce any output at all.
 */
export function BootOverlay({
  state,
  agentLabel,
  startedAt
}: {
  state: 'booting' | 'rendering' | 'stalled'
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
  const rendering = state === 'rendering'

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="animate-fade-in flex items-center gap-2.5 rounded-full border border-zinc-200/80 bg-white/85 px-4 py-2 shadow-sm backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-900/75">
        <Loader2
          size={14}
          className={`shrink-0 animate-spin ${
            stalled ? 'text-amber-500 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'
          }`}
        />
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
          ) : rendering ? (
            <>
              Waiting for <span className="font-medium">{agentLabel}</span> to render…
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
