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
//
// AGGREGATE-TEAM MODE (display.aggregate_team):
// When the flag is on, the store also surfaces role activity from team-member
// sub-sessions (children of the leader session). Mechanics:
//   - C1 filter loosening: accept `event.sessionID === sid` OR
//     `parentIDCache.get(event.sessionID) === sid`.
//   - parentID for unknown child sessions is fetched async via
//     `api.client.session.get({ sessionID })`; the cache prevents repeat calls.
//   - Initial child discovery uses `api.client.session.children({ sessionID: sid })`
//     and replays each child's messages to bootstrap rows.
//   - Per-role member breakdown lives in `RoleRow.memberSessions` and is
//     populated only when the same role is observed in >1 sessions.
// When the flag is off, the store path is byte-for-byte identical to the previous
// single-session behavior.
import { createSignal, type Accessor } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { deriveRow, deriveMemberRow, type RoleRow, type MemberRow } from "./derive-row"

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

export type UseSessionRoleActivityOptions = {
  // When true, surface child-session role activity in addition to the leader session's.
  // Default false preserves byte-for-byte legacy behavior.
  aggregateTeam?: boolean
}

export function useSessionRoleActivity(
  api: TuiPluginApi,
  sessionID: string,
  options: UseSessionRoleActivityOptions = {},
): {
  rows: Accessor<RoleRow[]>
  activeCount: Accessor<number>
  totalCount: Accessor<number>
  dispose: () => void
} {
  const aggregateTeam = options.aggregateTeam === true

  // Inner store: per-(role, sessionID) MemberRow plus per-(role, sessionID) authored-flag.
  // For solo mode this collapses to one entry per role keyed by the leader session.
  // For aggregate mode we accumulate one entry per (role, child session) tuple.
  // Key: `${role}::${sessionID}`. Value: the MemberRow (sessionID encoded for re-derivation).
  const [memberMap, setMemberMap] = createSignal<Map<string, { role: string; member: MemberRow }>>(new Map())

  // Aggregate roll-up: derive RoleRow[] from memberMap on read. Last-write-wins on
  // top-level providerID/modelID continues to be the most recent member event for that role.
  const rowMap: Accessor<Map<string, RoleRow>> = () => {
    const members = memberMap()
    const byRole = new Map<string, MemberRow[]>()
    // Track insertion order per role so last-write-wins picks the most recent member.
    for (const { role, member } of members.values()) {
      const list = byRole.get(role)
      if (list) list.push(member)
      else byRole.set(role, [member])
    }
    const out = new Map<string, RoleRow>()
    for (const [role, memberList] of byRole) {
      // Use the latest member's observed model as the role-row headline.
      const latest = memberList[memberList.length - 1]
      const configuredDefault = api.state.config.agent?.[role]?.model
      const requirements = AGENT_MODEL_REQUIREMENTS[role]
      const aggregateRow = deriveRow({
        role,
        configuredDefault,
        observed: { providerID: latest.providerID, modelID: latest.modelID },
        requirements,
      })
      if (aggregateTeam && memberList.length > 1) {
        const overrideCount = memberList.reduce((acc, m) => acc + (m.isOverride ? 1 : 0), 0)
        // The aggregate ◆ marker per F3: show ◆ if ANY member overrode.
        const anyOverride = overrideCount > 0
        out.set(role, {
          ...aggregateRow,
          isOverride: aggregateRow.isOverride || anyOverride,
          memberSessions: memberList,
          memberOverrideCount: overrideCount,
        })
      } else {
        out.set(role, aggregateRow)
      }
    }
    return out
  }

  // Derived accessors
  const rows: Accessor<RoleRow[]> = () =>
    [...rowMap().values()].sort((a, b) => a.role.localeCompare(b.role))
  // observedCount may exceed totalCount when sub-agent roles appear outside config.
  // Clamp the displayed active count to totalCount so the N/M ratio never exceeds 1.
  // Per spec section 'activeCount semantics': count unique roles, not member sessions.
  const activeCount: Accessor<number> = () => Math.min(rowMap().size, totalCount())
  // Defect B fix: derive denominator from AGENT_MODEL_REQUIREMENTS (the canonical OMO
  // role catalog — pure data already imported), NOT api.state.config.agent (which is
  // opencode-native Config.agent = plan/build/general/explore slots). AC9 forbids the
  // TUI from reading server-side OMO state, so the role universe is computed locally.
  const totalCount: Accessor<number> = () => Object.keys(AGENT_MODEL_REQUIREMENTS).length

  // parentID cache: maps any sessionID we've seen to its parentID (or null if root).
  // The leader sessionID is seeded as null to short-circuit lookups for the own session.
  const parentIDCache = new Map<string, string | null>()
  parentIDCache.set(sessionID, null)
  // Track sessions we consider "in-scope" (leader + known children) so we don't pollute
  // the row map with arbitrary cross-session events.
  const inScope = new Set<string>()
  inScope.add(sessionID)

  // Pending parentID resolutions: prevent duplicate session.get() calls for the same sid.
  const pendingParentIDLookups = new Set<string>()

  let disposed = false

  const ingestMessage = (
    msg: AssistantMessage,
    msgSessionID: string,
  ): void => {
    if (msg.role !== "assistant") return
    const role = resolveAgentName(api, msg)
    if (!role) return
    if (!msg.modelID || !msg.providerID) return
    const configuredDefault = api.state.config.agent?.[role]?.model
    const requirements = AGENT_MODEL_REQUIREMENTS[role]
    const member = deriveMemberRow({
      sessionID: msgSessionID,
      configuredDefault,
      observed: { providerID: msg.providerID, modelID: msg.modelID },
      requirements,
    })
    const key = `${role}::${msgSessionID}`
    setMemberMap((prev) => new Map(prev).set(key, { role, member }))
  }

  // --- Hydrate from snapshot (one-shot, not reactive) ---
  // Leader session messages first.
  const messages = api.state.session.messages(sessionID)
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    ingestMessage(msg, sessionID)
  }

  // Aggregate-team hydration: discover children + replay their messages.
  // Uses api.client.session.children() — see SDK gen sdk.gen.d.ts:528-536 (returns Array<Session>).
  if (aggregateTeam) {
    // Fire and forget; if we discover children we update the store async.
    // The TUI will re-render on each setMemberMap call.
    void (async () => {
      try {
        const res = await api.client.session.children({ sessionID })
        // The SDK client wraps responses in { data, error } per OpencodeClient convention.
        // Guard against either shape for resilience across SDK versions.
        const data: Session[] | undefined = (res as { data?: Session[] }).data
        const list: Session[] = Array.isArray(data) ? data : []
        for (const child of list) {
          if (disposed) return
          parentIDCache.set(child.id, child.parentID ?? null)
          if (child.parentID === sessionID) {
            inScope.add(child.id)
            // Replay child messages to bootstrap rows.
            const childMessages = api.state.session.messages(child.id)
            for (const msg of childMessages) {
              if (msg.role !== "assistant") continue
              ingestMessage(msg, child.id)
            }
          }
        }
      } catch {
        // Silent failure: aggregation degrades to "leader session only" if the
        // children endpoint is unavailable. This matches E1 graceful fallback.
      }
    })()
  }

  // --- Live updates via message.updated event ---
  const unsubscribe = api.event.on("message.updated", (event) => {
    const eventSID = event.properties.sessionID
    const info = event.properties.info
    if (info.role !== "assistant") return

    // Leader session direct hit — always in scope.
    if (eventSID === sessionID) {
      ingestMessage(info, eventSID)
      return
    }

    // Aggregate-team off → strict cross-session isolation (legacy behavior).
    if (!aggregateTeam) return

    // Already known to be in scope (cached child).
    if (inScope.has(eventSID)) {
      ingestMessage(info, eventSID)
      return
    }

    // Cached miss — definitely not a child of ours, ignore.
    if (parentIDCache.has(eventSID)) return

    // Unknown session: look up parentID asynchronously. If/when it turns out to
    // be a child of our session, replay any subsequent ingestion. Within this
    // event we drop the payload (re-deliveries handle the lag); for the first
    // message we re-ingest after the lookup resolves.
    if (pendingParentIDLookups.has(eventSID)) return
    pendingParentIDLookups.add(eventSID)
    const capturedInfo = info
    void (async () => {
      try {
        const res = await api.client.session.get({ sessionID: eventSID })
        const session: Session | undefined = (res as { data?: Session }).data
        const parentID: string | null = session?.parentID ?? null
        parentIDCache.set(eventSID, parentID)
        if (parentID === sessionID && !disposed) {
          inScope.add(eventSID)
          ingestMessage(capturedInfo, eventSID)
        }
      } catch {
        // Mark as not-a-child so we don't loop on the same sid.
        parentIDCache.set(eventSID, null)
      } finally {
        pendingParentIDLookups.delete(eventSID)
      }
    })()
  })

  const dispose = () => {
    disposed = true
    unsubscribe()
    parentIDCache.clear()
    inScope.clear()
    pendingParentIDLookups.clear()
  }

  return { rows, activeCount, totalCount, dispose }
}

export type { MemberRow }
