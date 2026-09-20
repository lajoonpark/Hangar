import { randomUUID } from 'crypto'
import {
  AgentDefinition,
  BUILTIN_AGENTS,
  CustomAgent,
  NewAgentPayload,
  Result
} from '@shared/types'
import { settingsService } from './settings'

/**
 * Agent registry: built-in agents (const, never stored) merged with
 * user-defined agents persisted in settings.
 */

function toDefinition(a: CustomAgent, builtin: boolean, disabled = false): AgentDefinition {
  return { ...a, builtin, disabled: builtin ? disabled : undefined }
}

class AgentService {
  /**
   * All agents available to the picker: built-ins (unless disabled) then
   * user-defined, in creation order.
   */
  list(): AgentDefinition[] {
    const disabled = new Set(settingsService.get().disabledBuiltinAgents)
    const builtins = BUILTIN_AGENTS.map((a) => toDefinition(a, true, disabled.has(a.id)))
    const customs = settingsService.get().customAgents.map((a) => toDefinition(a, false))
    return [...builtins.filter((a) => !a.disabled), ...customs]
  }

  /** Every agent incl. disabled built-ins (settings UI needs full list). */
  listAll(): AgentDefinition[] {
    const disabled = new Set(settingsService.get().disabledBuiltinAgents)
    const builtins = BUILTIN_AGENTS.map((a) => toDefinition(a, true, disabled.has(a.id)))
    const customs = settingsService.get().customAgents.map((a) => toDefinition(a, false))
    return [...builtins, ...customs]
  }

  /** Resolve one agent by id (builtin or custom). */
  byId(agentId: string): AgentDefinition | undefined {
    return this.listAll().find((a) => a.id === agentId)
  }

  add(payload: NewAgentPayload): Result<AgentDefinition> {
    const errors: string[] = []
    if (!payload.name?.trim()) errors.push('name is required')
    if (!payload.command?.trim()) errors.push('command is required')
    if (payload.args && !Array.isArray(payload.args)) errors.push('args must be an array')
    if (errors.length > 0) return { ok: false, error: errors.join('; ') }

    const agent: CustomAgent = {
      id: randomUUID(),
      name: payload.name.trim(),
      command: payload.command.trim(),
      args: Array.isArray(payload.args) ? payload.args.map(String) : [],
      env: payload.env && typeof payload.env === 'object' ? { ...payload.env } : {},
      useShell: payload.useShell !== false,
      workingDirOverride: payload.workingDirOverride || undefined
    }
    const settings = settingsService.get()
    const result = settingsService.update({
      customAgents: [...settings.customAgents, agent]
    })
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, data: toDefinition(agent, false) }
  }

  update(agent: AgentDefinition): Result<void> {
    if (agent.builtin) return { ok: false, error: 'cannot edit built-in agents' }
    const settings = settingsService.get()
    const idx = settings.customAgents.findIndex((a) => a.id === agent.id)
    if (idx === -1) return { ok: false, error: `unknown agent: ${agent.id}` }
    const updated: CustomAgent = {
      id: agent.id,
      name: agent.name?.trim() || settings.customAgents[idx].name,
      command: agent.command?.trim() || settings.customAgents[idx].command,
      args: Array.isArray(agent.args) ? agent.args.map(String) : [],
      env: agent.env && typeof agent.env === 'object' ? { ...agent.env } : {},
      useShell: agent.useShell !== false,
      workingDirOverride: agent.workingDirOverride || undefined
    }
    const next = [...settings.customAgents]
    next[idx] = updated
    const result = settingsService.update({ customAgents: next })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  delete(agentId: string): Result<void> {
    const settings = settingsService.get()
    const idx = settings.customAgents.findIndex((a) => a.id === agentId)
    if (idx === -1) return { ok: false, error: `unknown agent: ${agentId}` }
    const next = settings.customAgents.filter((a) => a.id !== agentId)
    const result = settingsService.update({ customAgents: next })
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
