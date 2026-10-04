import { randomUUID } from 'crypto'
import {
  AgentDefinition,
  BUILTIN_AGENTS,
  CustomAgent,
  effectiveTabLabel,
  NewAgentPayload,
  Result
} from '@shared/types'
import { maskEnv, splitIncomingEnv } from './agentEnv'
import { secretsService } from './secrets'
import { settingsService } from './settings'

/**
 * Agent registry: built-in agents (const, never stored) merged with
 * user-defined agents persisted in settings.
 */

/** Renderer-facing definition — secret env values are masked, never sent. */
function toDto(a: CustomAgent, builtin: boolean, disabled = false): AgentDefinition {
  const secretKeys = builtin ? [] : secretsService.keys(a.id)
  return {
    ...a,
    env: builtin ? (a.env ?? {}) : maskEnv(a.id, a.env),
    builtin,
    disabled: builtin ? disabled : undefined,
    tabLabel: effectiveTabLabel(a.id, a.name, settingsService.get().agentTabLabels),
    secretKeys: secretKeys.length > 0 ? secretKeys : undefined
  }
}

class AgentService {
  /**
   * Order agents by the user's saved `agentOrder` (agent ids). Entries are
   * matched in stored order; agents missing from the list keep their default
   * relative order (built-ins first in BUILTIN_AGENTS order, then customs in
   * creation order) appended after. Unknown ids are ignored.
   */
  private applyOrder(agents: AgentDefinition[]): AgentDefinition[] {
    const rank = new Map<string, number>()
    settingsService.get().agentOrder.forEach((id, i) => {
      if (!rank.has(id)) rank.set(id, i)
    })
    return [...agents].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return 0
    })
  }

  private allDtos(): AgentDefinition[] {
    const disabled = new Set(settingsService.get().disabledBuiltinAgents)
    const builtins = BUILTIN_AGENTS.map((a) => toDto(a, true, disabled.has(a.id)))
    const customs = settingsService.get().customAgents.map((a) => toDto(a, false))
    return this.applyOrder([...builtins, ...customs])
  }

  /**
   * All agents available to the picker (enabled only), in the user's saved
   * `agentOrder` (see `applyOrder`).
   */
  list(): AgentDefinition[] {
    return this.allDtos().filter((a) => !a.disabled)
  }

  /** Every agent incl. disabled built-ins (settings UI needs full list). */
  listAll(): AgentDefinition[] {
    return this.allDtos()
  }

  /**
   * Resolve one agent by id (builtin or custom) with its FULL env — secret
   * values included. This is the internal path used by the PTY spawner; it is
   * never exposed over IPC.
   */
  byId(agentId: string): AgentDefinition | undefined {
    const settings = settingsService.get()
    const builtin = BUILTIN_AGENTS.find((a) => a.id === agentId)
    const raw = builtin ?? settings.customAgents.find((a) => a.id === agentId)
    if (!raw) return undefined
    const disabled = builtin ? settings.disabledBuiltinAgents.includes(agentId) : undefined
    return {
      ...raw,
      env: builtin
        ? (raw.env ?? {})
        : { ...(raw.env ?? {}), ...secretsService.getAll(agentId) },
      builtin: !!builtin,
      disabled,
      tabLabel: effectiveTabLabel(raw.id, raw.name, settings.agentTabLabels)
    }
  }

  /**
   * Merge a tab-label override into the settings map: a non-empty label is
   * stored keyed by agent id, an empty one removes the override.
   */
  private mergedLabels(
    labels: Record<string, string>,
    agentId: string,
    label: string
  ): Record<string, string> {
    const merged = { ...(labels ?? {}) }
    const trimmed = (label ?? '').trim()
    if (trimmed) merged[agentId] = trimmed
    else delete merged[agentId]
    return merged
  }

  add(payload: NewAgentPayload): Result<AgentDefinition> {
    const errors: string[] = []
    if (!payload.name?.trim()) errors.push('name is required')
    if (!payload.command?.trim()) errors.push('command is required')
    if (payload.args && !Array.isArray(payload.args)) errors.push('args must be an array')
    if (errors.length > 0) return { ok: false, error: errors.join('; ') }

    const agentId = randomUUID()
    const { plainEnv, secrets } = splitIncomingEnv(agentId, payload.env)
    const agent: CustomAgent = {
      id: agentId,
      name: payload.name.trim(),
      command: payload.command.trim(),
      args: Array.isArray(payload.args) ? payload.args.map(String) : [],
      env: plainEnv,
      useShell: payload.useShell !== false,
      workingDirOverride: payload.workingDirOverride || undefined
    }
    secretsService.replaceAll(agentId, secrets)
    const settings = settingsService.get()
    const result = settingsService.update({
      customAgents: [...settings.customAgents, agent],
      agentTabLabels: this.mergedLabels(settings.agentTabLabels, agentId, payload.tabLabel ?? '')
    })
    if (!result.ok) {
      secretsService.removeAgent(agentId)
      return { ok: false, error: result.error }
    }
    return { ok: true, data: toDto(agent, false) }
  }

  update(agent: AgentDefinition): Result<void> {
    if (agent.builtin) return { ok: false, error: 'cannot edit built-in agents' }
    const settings = settingsService.get()
    const idx = settings.customAgents.findIndex((a) => a.id === agent.id)
    if (idx === -1) return { ok: false, error: `unknown agent: ${agent.id}` }
    const { plainEnv, secrets } = splitIncomingEnv(agent.id, agent.env)
    secretsService.replaceAll(agent.id, secrets)
    const updated: CustomAgent = {
      id: agent.id,
      name: agent.name?.trim() || settings.customAgents[idx].name,
      command: agent.command?.trim() || settings.customAgents[idx].command,
      args: Array.isArray(agent.args) ? agent.args.map(String) : [],
      env: plainEnv,
      useShell: agent.useShell !== false,
      workingDirOverride: agent.workingDirOverride || undefined
    }
    const next = [...settings.customAgents]
    next[idx] = updated
    const result = settingsService.update({
      customAgents: next,
      agentTabLabels: this.mergedLabels(settings.agentTabLabels, agent.id, agent.tabLabel ?? '')
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  /** Change the tab-label prefix for any agent (built-in or custom). */
  setTabLabel(agentId: string, label: string): Result<void> {
    const known = this.listAll().some((a) => a.id === agentId)
    if (!known) return { ok: false, error: `unknown agent: ${agentId}` }
    const settings = settingsService.get()
    const result = settingsService.update({
      agentTabLabels: this.mergedLabels(settings.agentTabLabels, agentId, label)
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  delete(agentId: string): Result<void> {
    const settings = settingsService.get()
    const idx = settings.customAgents.findIndex((a) => a.id === agentId)
    if (idx === -1) return { ok: false, error: `unknown agent: ${agentId}` }
    const next = settings.customAgents.filter((a) => a.id !== agentId)
    const result = settingsService.update({ customAgents: next })
    if (result.ok) secretsService.removeAgent(agentId)
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  toggleBuiltin(agentId: string, disabled: boolean): Result<void> {
    const isBuiltin = BUILTIN_AGENTS.some((a) => a.id === agentId)
    if (!isBuiltin) return { ok: false, error: `not a built-in agent: ${agentId}` }
    const result = settingsService.setBuiltinDisabled(agentId, disabled)
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }
}

export const agentService = new AgentService()
