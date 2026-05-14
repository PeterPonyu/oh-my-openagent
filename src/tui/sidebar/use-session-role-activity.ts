// IMPORTED BY: tui — reactive store for per-session role/model activity
//
// AGENT IDENTITY CHANNEL (post-QA investigation against opencode 1.14.50):
// The canonical source for "which agent produced this assistant message" is
// `AssistantMessage.agent` (flat field). Evidence:
//   1. SDK type declares it required: node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:481
//      (`agent: string` on AssistantMessage — non-optional).
//   2. Host schema declares it required: opencode/packages/opencode/src/session/message-v2.ts:549
//      (`agent: Schema.String` in the Assistant struct — Effect Schema, non-optional).
//   3. Host runtime populates it from `input.agent.name`:
//      opencode/packages/opencode/src/session/llm.ts:165 and processor.ts:434.
// AgentPart (types.gen.d.ts:711 — `{ type: "agent"; name: string }`) is used for
// PROMPT-side agent mentions (user "@sisyphus do X" → AgentPart in the user message
// parts), NOT for tagging assistant message authorship. Source verified at
// opencode/packages/opencode/src/session/prompt.ts:153 (`parts.push({ type: "agent", name })`).
// SessionStatus (types.gen.d.ts:110) carries only `{type: "idle"|"retry"|"busy"}` — no
// agent identity. EventSessionUpdated.info: Session (types.gen.d.ts:766) likewise.
// Therefore AssistantMessage.agent is the only correct, always-populated channel.
// AgentPart fallback added as defense-in-depth: if `info.agent` ever arrives empty,
// we scan parts for an AgentPart and use its name.
import { createSignal, type Accessor } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { deriveRow, type RoleRow } from "./derive-row"

export type { RoleRow }

// Defense-in-depth: if AssistantMessage.agent is unexpectedly empty, look for an
// AgentPart in the message's parts (state.part(messageID)). AgentPart carries a
// `name: string` field that mirrors what the host populates into message.agent.
function resolveAgentName(
  api: TuiPluginApi,
  msg: AssistantMessage,
): string | undefined {
  if (msg.agent && msg.agent !== "") return msg.agent
  const parts = api.state.part(msg.id)
  for (const p of parts) {
    if (p.type === "agent" && p.name && p.name !== "") return p.name
  }
  return undefined
}

export function useSessionRoleActivity(
  api: TuiPluginApi,
  sessionID: string,
): {
  rows: Accessor<RoleRow[]>
  activeCount: Accessor<number>
  totalCount: Accessor<number>
  dispose: () => void
} {
  const [rowMap, setRowMap] = createSignal<Map<string, RoleRow>>(new Map())

  // Derived accessors
  const rows: Accessor<RoleRow[]> = () =>
    [...rowMap().values()].sort((a, b) => a.role.localeCompare(b.role))
  // observedCount may exceed totalCount when sub-agent roles appear outside config.
  // Clamp the displayed active count to totalCount so the N/M ratio never exceeds 1.
  const activeCount: Accessor<number> = () => Math.min(rowMap().size, totalCount())
  // Defect B fix: derive denominator from AGENT_MODEL_REQUIREMENTS (the canonical OMO
  // role catalog — pure data already imported), NOT api.state.config.agent (which is
  // opencode-native Config.agent = plan/build/general/explore slots). AC9 forbids the
  // TUI from reading server-side OMO state, so the role universe is computed locally.
  const totalCount: Accessor<number> = () => Object.keys(AGENT_MODEL_REQUIREMENTS).length

  // --- Hydrate from snapshot (one-shot, not reactive) ---
  const messages = api.state.session.messages(sessionID)
  const initialMap = new Map<string, RoleRow>()
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    // Defect A fix: AssistantMessage.agent is the primary channel (host schema
    // makes it required); AgentPart fallback handles any edge case where it's empty.
    const role = resolveAgentName(api, msg)
    if (!role) continue
    // Flat fields per types.gen.d.ts:478-479 (NOT message.model.X — Critic C1)
    if (!msg.modelID || !msg.providerID) continue
    const configuredDefault = api.state.config.agent?.[role]?.model
    const requirements = AGENT_MODEL_REQUIREMENTS[role]
    const row = deriveRow({
      role,
      configuredDefault,
      observed: { providerID: msg.providerID, modelID: msg.modelID },
      requirements,
    })
    // last-write-wins: most recent message for this role wins
    initialMap.set(role, row)
  }
  setRowMap(initialMap)

  // --- Live updates via message.updated event ---
  const unsubscribe = api.event.on("message.updated", (event) => {
    // Cross-session isolation
    if (event.properties.sessionID !== sessionID) return
    const info = event.properties.info
    if (info.role !== "assistant") return
    const role = resolveAgentName(api, info)
    if (!role) return
    // Flat fields (Critic C1)
    if (!info.modelID || !info.providerID) return

    const configuredDefault = api.state.config.agent?.[role]?.model
    const requirements = AGENT_MODEL_REQUIREMENTS[role]
    const row = deriveRow({
      role,
      configuredDefault,
      observed: { providerID: info.providerID, modelID: info.modelID },
      requirements,
    })
    setRowMap((prev) => new Map(prev).set(row.role, row))
  })

  const dispose = () => {
    unsubscribe()
  }

  return { rows, activeCount, totalCount, dispose }
}
