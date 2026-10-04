import type { SpawnPointApi } from '@shared/api'

/**
 * Global augmentation so the renderer can call `window.spawnpoint.*`
 * with full type safety. The design agent's UI code gets autocomplete
 * for the entire backend surface from this declaration.
 */
declare global {
  interface Window {
    spawnpoint: SpawnPointApi
  }
}

export {}
