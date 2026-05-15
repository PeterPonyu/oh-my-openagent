// IMPORTED BY: tui — keep pure data, no runtime side effects
import type { FallbackEntry, ModelRequirement } from "../../shared/model-requirements"

export type { FallbackEntry }

export type MemberRow = {
  sessionID: string
  providerID: string
  modelID: string
  isOverride: boolean // ◆ marker iff this member's observed model ≠ role's effective default
}

export type RoleRow = {
  role: string
  providerID: string
  modelID: string
  isOverride: boolean // ◆ marker iff true
  hasEffectiveDefault: boolean // false for unknown roles → suppresses ◆ + ↓
  fallbackChain: FallbackEntry[] // empty array for unknown roles
  // Aggregate-mode (display.aggregate_team) extension: per-(role, sub-session) breakdown.
  // Empty / undefined when the role was observed in only a single session (or in solo mode).
  // When populated and length > 1, the JSX renders an expandable member breakdown per F3.
  memberSessions?: MemberRow[]
  // F3 footer hint: how many distinct member sessions exhibited an override for this role.
  // Counted against `memberSessions.length`. Only meaningful when memberSessions is populated.
  memberOverrideCount?: number
}

export type DeriveRowInput = {
  role: string
  // configuredDefault is `state.config.agent?.[role]?.model` — verified at types.gen.d.ts:1269-1278
  configuredDefault: string | undefined
  // observed comes from AssistantMessage flat fields (types.gen.d.ts:478-479), NOT message.model.X
  observed: { providerID: string; modelID: string }
  // requirements is AGENT_MODEL_REQUIREMENTS[role] (src/shared/model-requirements.ts:20) or undefined for unknown roles
  requirements: ModelRequirement | undefined
}

export function deriveRow(input: DeriveRowInput): RoleRow {
  const { role, configuredDefault, observed, requirements } = input

  // Effective-default rule (fixes Architect A1): prefer explicit config; else first fallback entry.
  // Unknown role policy (fixes Critic C4): if BOTH configuredDefault is undefined AND requirements is undefined,
  // hasEffectiveDefault is false → isOverride is always false → renderer skips ◆ and skips ↓ expansion.
  let effectiveDefault: string | undefined = configuredDefault
  if (!effectiveDefault && requirements && requirements.fallbackChain.length > 0) {
    const first = requirements.fallbackChain[0]
    if (first.providers.length > 0) {
      effectiveDefault = `${first.providers[0]}/${first.model}`
    }
  }
  const hasEffectiveDefault = effectiveDefault !== undefined
  const observedStr = `${observed.providerID}/${observed.modelID}`
  const isOverride = hasEffectiveDefault && observedStr !== effectiveDefault

  return {
    role,
    providerID: observed.providerID,
    modelID: observed.modelID,
    isOverride,
    hasEffectiveDefault,
    fallbackChain: requirements?.fallbackChain ?? [],
  }
}

export type DeriveMemberRowInput = {
  sessionID: string
  // Same effective-default semantics as deriveRow: prefer explicit configuredDefault,
  // else first entry of requirements.fallbackChain.
  configuredDefault: string | undefined
  observed: { providerID: string; modelID: string }
  requirements: ModelRequirement | undefined
}

export function deriveMemberRow(input: DeriveMemberRowInput): MemberRow {
  const { sessionID, configuredDefault, observed, requirements } = input
  let effectiveDefault: string | undefined = configuredDefault
  if (!effectiveDefault && requirements && requirements.fallbackChain.length > 0) {
    const first = requirements.fallbackChain[0]
    if (first.providers.length > 0) {
      effectiveDefault = `${first.providers[0]}/${first.model}`
    }
  }
  const hasEffectiveDefault = effectiveDefault !== undefined
  const observedStr = `${observed.providerID}/${observed.modelID}`
  const isOverride = hasEffectiveDefault && observedStr !== effectiveDefault
  return {
    sessionID,
    providerID: observed.providerID,
    modelID: observed.modelID,
    isOverride,
  }
}
