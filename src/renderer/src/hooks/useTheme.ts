import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * Resolves settings.theme (system|light|dark) to a concrete scheme, tracks
 * OS-level changes live, and keeps the `dark` class on <html> in sync for
 * Tailwind's darkMode:'class'.
 */
export function useResolvedTheme(settings: AppSettings | null): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = settings?.theme ?? 'system'
  const resolved: 'dark' | 'light' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  return resolved
}

export const isMac = /Mac/i.test(navigator.platform)
