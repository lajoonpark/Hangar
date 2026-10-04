import { isSecretKey, SECRET_MASK } from '@shared/types'
import { secretsService } from './secrets'

/**
 * Helpers for separating an agent's env into plaintext (persisted in settings)
 * and secret (persisted encrypted, never sent to the renderer). Shared by the
 * settings and agent services so both agree on the classification rules.
 */

function normalize(env: unknown): Record<string, string> {
  return env && typeof env === 'object' && !Array.isArray(env)
    ? (env as Record<string, string>)
    : {}
}

/** Drop secret-classified entries — used before persisting to plaintext settings. */
export function stripSecretKeys(env: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(normalize(env))) {
    if (!isSecretKey(k)) out[k] = v
  }
  return out
}

/**
 * Split an incoming (renderer-supplied) env into plaintext + secret parts.
 * A secret-keyed value equal to `SECRET_MASK` means "keep the stored value".
 * Secret keys absent from `env` are intentionally omitted from the result so
 * the caller's `replaceAll` deletes them.
 */
export function splitIncomingEnv(
  agentId: string,
  env: unknown
): { plainEnv: Record<string, string>; secrets: Record<string, string> } {
  const existing = secretsService.getAll(agentId)
  const plainEnv: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  for (const [k, v] of Object.entries(normalize(env))) {
    if (!isSecretKey(k)) {
      plainEnv[k] = v
      continue
    }
    if (v === SECRET_MASK) {
      if (existing[k] !== undefined) secrets[k] = existing[k]
    } else {
      secrets[k] = v
    }
  }
  return { plainEnv, secrets }
}

/** Overlay `SECRET_MASK` for every stored secret key — renderer-facing env. */
export function maskEnv(agentId: string, env: unknown): Record<string, string> {
  const masked = { ...normalize(env) }
  if (secretsService.isInit()) {
    for (const k of secretsService.keys(agentId)) masked[k] = SECRET_MASK
  }
  return masked
}
