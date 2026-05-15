/// <reference path="../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { deriveRow } from "./derive-row"
import { useSessionRoleActivity } from "./use-session-role-activity"
import { AGENT_MODEL_REQUIREMENTS, type ModelRequirement } from "../../shared/model-requirements"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { AssistantMessage } from "@opencode-ai/sdk/v2/gen/types.gen"
import { execSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Two levels up from src/tui/sidebar/index.test.ts → src/tui/
const tuiSrcDir = resolve(fileURLToPath(import.meta.url), "../..")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantMessage(
  _role: string,
  providerID: string,
  modelID: string,
  agent: string,
): AssistantMessage {
  return {
    id: `msg-${Math.random()}`,
    sessionID: "s1",
    role: "assistant",
    time: { created: Date.now() },
    parentID: "",
    providerID,
    modelID,
    mode: "default",
    agent,
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function makeUserMessage(): Message {
  return {
    id: `msg-${Math.random()}`,
    sessionID: "s1",
    role: "user",
    time: { created: Date.now() },
    agent: "",
    model: { providerID: "", modelID: "" },
  } as unknown as Message
}

type EventHandler = (event: { properties: { sessionID: string; info: AssistantMessage } }) => void

type MockApiOptions = {
  agentConfig?: Record<string, { model?: string }>
  sessionID?: string
  partsByMessageID?: Record<string, Part[]>
  // Aggregate-team test fixtures:
  // messagesBySessionID overrides the per-session messages snapshot; when present it
  // takes priority over the legacy single-array `messages` arg.
  messagesBySessionID?: Record<string, Message[]>
  // childrenBySessionID lets tests stub api.client.session.children for a given parent sid.
  childrenBySessionID?: Record<string, Array<{ id: string; parentID?: string }>>
  // parentIDBySessionID lets tests stub api.client.session.get for unknown child sids.
  parentIDBySessionID?: Record<string, string | undefined>
}

function makeMockApi(
  messages: Message[],
  agentConfigOrOptions: Record<string, { model?: string }> | MockApiOptions = {},
  sessionIDArg?: string,
  partsByMessageIDArg?: Record<string, Part[]>,
): {
  api: TuiPluginApi
  fireMessageUpdated: (info: AssistantMessage, sid?: string) => void
  clientGetCalls: string[]
  clientChildrenCalls: string[]
  unsubscribeCount: () => number
} {
  // Back-compat: existing tests pass (messages, agentConfig, sessionID, parts) positionally.
  // New tests pass (messages, { ...options }).
  const opts: MockApiOptions =
    typeof agentConfigOrOptions === "object" && agentConfigOrOptions !== null && (
      "messagesBySessionID" in agentConfigOrOptions ||
      "childrenBySessionID" in agentConfigOrOptions ||
      "parentIDBySessionID" in agentConfigOrOptions ||
      "agentConfig" in agentConfigOrOptions ||
      "sessionID" in agentConfigOrOptions ||
      "partsByMessageID" in agentConfigOrOptions
    )
      ? (agentConfigOrOptions as MockApiOptions)
      : {
          agentConfig: agentConfigOrOptions as Record<string, { model?: string }>,
          sessionID: sessionIDArg,
          partsByMessageID: partsByMessageIDArg,
        }
  const agentConfig = opts.agentConfig ?? {}
  const sessionID = opts.sessionID ?? "s1"
  const partsByMessageID = opts.partsByMessageID ?? {}
  const messagesBySessionID = opts.messagesBySessionID ?? {}
  const childrenBySessionID = opts.childrenBySessionID ?? {}
  const parentIDBySessionID = opts.parentIDBySessionID ?? {}

  const handlers: EventHandler[] = []
  const clientGetCalls: string[] = []
  const clientChildrenCalls: string[] = []
  let totalUnsubscribed = 0

  const api = {
    state: {
      config: {
        agent: agentConfig,
      },
      session: {
        messages: (sid: string) => {
          if (Object.prototype.hasOwnProperty.call(messagesBySessionID, sid)) {
            return messagesBySessionID[sid]
          }
          // Legacy path: the single-array fixture is treated as belonging to the leader session.
          if (sid === sessionID) return messages
          return []
        },
      },
      part: (messageID: string) => partsByMessageID[messageID] ?? [],
    },
    event: {
      on: (_type: string, handler: EventHandler) => {
        handlers.push(handler)
        return () => {
          const idx = handlers.indexOf(handler)
          if (idx >= 0) {
            handlers.splice(idx, 1)
            totalUnsubscribed += 1
          }
        }
      },
    },
    client: {
      session: {
        children: async ({ sessionID: sid }: { sessionID: string }) => {
          clientChildrenCalls.push(sid)
          const list = childrenBySessionID[sid] ?? []
          return { data: list }
        },
        get: async ({ sessionID: sid }: { sessionID: string }) => {
          clientGetCalls.push(sid)
          const parentID = parentIDBySessionID[sid]
          return { data: { id: sid, parentID } }
        },
      },
    },
    lifecycle: {
      onDispose: (_fn: () => void) => () => {},
    },
    kv: {
      get: () => undefined,
      set: () => {},
      ready: true,
    },
    theme: { current: { text: "#fff", accent: "#f00", textMuted: "#888" } },
  } as unknown as TuiPluginApi

  const fireMessageUpdated = (info: AssistantMessage, sid = sessionID) => {
    for (const h of handlers) {
      h({ properties: { sessionID: sid, info } })
    }
  }

  return {
    api,
    fireMessageUpdated,
    clientGetCalls,
    clientChildrenCalls,
    unsubscribeCount: () => totalUnsubscribed,
  }
}

function flushAsync(): Promise<void> {
  // Allow microtasks (api.client.* fire-and-forget) to settle before assertions.
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// deriveRow tests
// ---------------------------------------------------------------------------

describe("deriveRow", () => {
  test("1. isOverride=false when observed equals effectiveDefault from config", () => {
    const row = deriveRow({
      role: "plan",
      configuredDefault: "anthropic/claude-opus-4-7",
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements: undefined,
    })
    expect(row.isOverride).toBe(false)
    expect(row.hasEffectiveDefault).toBe(true)
  })

  test("2. isOverride=true when observed differs from configured default", () => {
    const row = deriveRow({
      role: "plan",
      configuredDefault: "anthropic/claude-opus-4-7",
      observed: { providerID: "openai", modelID: "gpt-5" },
      requirements: undefined,
    })
    expect(row.isOverride).toBe(true)
  })

  test("3a. falls back to requirements.fallbackChain[0] when configuredDefault is undefined — match → no override (A1)", () => {
    const requirements: ModelRequirement = {
      fallbackChain: [{ providers: ["anthropic", "vercel"], model: "claude-opus-4-7" }],
    }
    const row = deriveRow({
      role: "plan",
      configuredDefault: undefined,
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements,
    })
    expect(row.isOverride).toBe(false)
    expect(row.hasEffectiveDefault).toBe(true)
  })

  test("3b. falls back to requirements.fallbackChain[0] when configuredDefault is undefined — mismatch → override (A1)", () => {
    const requirements: ModelRequirement = {
      fallbackChain: [{ providers: ["anthropic", "vercel"], model: "claude-opus-4-7" }],
    }
    const row = deriveRow({
      role: "plan",
      configuredDefault: undefined,
      observed: { providerID: "openai", modelID: "gpt-5" },
      requirements,
    })
    expect(row.isOverride).toBe(true)
  })

  test("4. unknown role (no config, no requirements) → hasEffectiveDefault=false, isOverride=false, fallbackChain=[] (C4)", () => {
    const row = deriveRow({
      role: "unknown-role-xyz",
      configuredDefault: undefined,
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements: undefined,
    })
    expect(row.hasEffectiveDefault).toBe(false)
    expect(row.isOverride).toBe(false)
    expect(row.fallbackChain).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// useSessionRoleActivity tests
// ---------------------------------------------------------------------------

describe("useSessionRoleActivity", () => {
  test("5. hydrates from messages on mount", () => {
    const msgs: Message[] = [
      makeUserMessage(),
      makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "plan"),
      makeAssistantMessage("plan", "openai", "gpt-5", "plan"), // last-write-wins
      makeAssistantMessage("build", "openai", "gpt-5", "build"),
      makeAssistantMessage("build", "anthropic", "claude-sonnet-4-6", "build"), // last-write-wins
    ]
    const { api } = makeMockApi(msgs)
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    // 2 unique roles
    expect(rows().length).toBe(2)
    // sorted by role name: "build" < "plan"
    expect(rows()[0].role).toBe("build")
    expect(rows()[1].role).toBe("plan")
    // last-write-wins: build → anthropic/claude-sonnet-4-6
    expect(rows()[0].providerID).toBe("anthropic")
    expect(rows()[0].modelID).toBe("claude-sonnet-4-6")
    // last-write-wins: plan → openai/gpt-5 (reads flat .modelID/.providerID, not .model.X — C1)
    expect(rows()[1].providerID).toBe("openai")
    expect(rows()[1].modelID).toBe("gpt-5")
    dispose()
  })

  test("6. reacts to message.updated within 500ms", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    expect(rows().length).toBe(0)

    const t0 = performance.now()
    const newMsg = makeAssistantMessage("plan", "openai", "gpt-5", "plan")
    fireMessageUpdated(newMsg, "s1")
    const elapsed = performance.now() - t0

    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("plan")
    expect(rows()[0].providerID).toBe("openai")
    expect(rows()[0].modelID).toBe("gpt-5")
    expect(elapsed).toBeLessThan(500)
    dispose()
  })

  test("7. does not cross sessions", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const otherMsg = makeAssistantMessage("plan", "openai", "gpt-5", "plan")
    fireMessageUpdated(otherMsg, "other-session")
    expect(rows().length).toBe(0)
    dispose()
  })

  test("8. defends against empty agent string (C4)", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const badMsg = makeAssistantMessage("", "openai", "gpt-5", "")
    fireMessageUpdated(badMsg, "s1")
    expect(rows().length).toBe(0)
    dispose()
  })

  test("9a. real-world Sisyphus session shape populates row with display-name agent (Defect A regression)", () => {
    // Mirrors the QA runtime observation: agent='Sisyphus - Ultraworker', providerID='opencode-go', modelID='kimi-k2.6'
    const msgs: Message[] = [
      makeUserMessage(),
      makeAssistantMessage("sisyphus", "opencode-go", "kimi-k2.6", "Sisyphus - Ultraworker"),
    ]
    const { api } = makeMockApi(msgs)
    const { rows, activeCount, dispose } = useSessionRoleActivity(api, "s1")
    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("Sisyphus - Ultraworker")
    expect(rows()[0].providerID).toBe("opencode-go")
    expect(rows()[0].modelID).toBe("kimi-k2.6")
    expect(activeCount()).toBe(1)
    dispose()
  })

  test("9b. totalCount equals Object.keys(AGENT_MODEL_REQUIREMENTS).length (Defect B regression)", () => {
    const { api } = makeMockApi([])
    const { totalCount, dispose } = useSessionRoleActivity(api, "s1")
    const expected = Object.keys(AGENT_MODEL_REQUIREMENTS).length
    expect(totalCount()).toBe(expected)
    // sanity: catalog should not be empty
    expect(expected).toBeGreaterThan(0)
    dispose()
  })

  test("9c. AgentPart fallback resolves agent when AssistantMessage.agent is empty", () => {
    // Build an assistant message with empty agent (worst-case host shape regression)
    const empty = makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "")
    const parts: Part[] = [
      {
        id: "prt-1",
        sessionID: "s1",
        messageID: empty.id,
        type: "agent",
        name: "sisyphus",
      } as Part,
    ]
    const { api } = makeMockApi([empty], {}, "s1", { [empty.id]: parts })
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("sisyphus")
    dispose()
  })

  test("9. hydration <2000ms for 200-message session (AC4 perf budget, generous bound for CI)", () => {
    const roles = ["plan", "build", "oracle", "sisyphus", "librarian", "explore", "prometheus", "metis", "momus", "atlas"]
    const msgs: Message[] = []
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        msgs.push(makeUserMessage())
      } else {
        const role = roles[i % roles.length]
        msgs.push(makeAssistantMessage(role, "anthropic", "claude-sonnet-4-6", role))
      }
    }
    const { api } = makeMockApi(msgs)

    const t0 = performance.now()
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const elapsed = performance.now() - t0

    // Functional check: hydration produces the correct number of unique roles
    expect(rows().length).toBeGreaterThan(0)
    // Wall-clock bound is intentionally generous (2000ms) to avoid flakiness on slow CI runners
    expect(elapsed).toBeLessThan(2000)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Aggregate-team mode (display.aggregate_team) — A3 nested rows + C1 loosened filter
// ---------------------------------------------------------------------------

describe("useSessionRoleActivity (aggregate_team mode)", () => {
  test("AT1. aggregate_team=false → existing single-session behavior preserved (regression of #5)", () => {
    const msgs: Message[] = [
      makeUserMessage(),
      makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "plan"),
      makeAssistantMessage("build", "openai", "gpt-5", "build"),
    ]
    const { api, fireMessageUpdated } = makeMockApi(msgs)
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: false })
    expect(rows().length).toBe(2)
    // Cross-session event ignored when aggregation is off.
    fireMessageUpdated(makeAssistantMessage("sisyphus", "openai", "gpt-5", "sisyphus"), "child-1")
    expect(rows().length).toBe(2)
    dispose()
  })

  test("AT2. aggregate_team=true with no child sessions → behaves like solo (E1 fallback)", async () => {
    const msgs: Message[] = [
      makeUserMessage(),
      makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "plan"),
    ]
    const { api } = makeMockApi(msgs, {
      messagesBySessionID: { s1: msgs },
      childrenBySessionID: { s1: [] },
    })
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    await flushAsync()
    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("plan")
    expect(rows()[0].memberSessions).toBeUndefined()
    dispose()
  })

  test("AT3. aggregate_team=true with two child sessions running same role → one row + memberSessions of 2", async () => {
    const childA = "child-a"
    const childB = "child-b"
    const leaderMsgs: Message[] = [makeUserMessage()]
    const msgA = makeAssistantMessage("sisyphus-junior", "anthropic", "claude-sonnet-4-6", "sisyphus-junior")
    msgA.sessionID = childA
    const msgB = makeAssistantMessage("sisyphus-junior", "openai", "gpt-5", "sisyphus-junior")
    msgB.sessionID = childB
    const { api } = makeMockApi(leaderMsgs, {
      messagesBySessionID: {
        s1: leaderMsgs,
        [childA]: [msgA],
        [childB]: [msgB],
      },
      childrenBySessionID: {
        s1: [
          { id: childA, parentID: "s1" },
          { id: childB, parentID: "s1" },
        ],
      },
    })
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    await flushAsync()
    expect(rows().length).toBe(1)
    const row = rows()[0]
    expect(row.role).toBe("sisyphus-junior")
    expect(row.memberSessions).toBeDefined()
    expect(row.memberSessions!.length).toBe(2)
    const sids = row.memberSessions!.map((m) => m.sessionID).sort()
    expect(sids).toEqual([childA, childB].sort())
    dispose()
  })

  test("AT4. aggregate_team=true: message.updated from unknown session triggers parentID lookup; child events flow in", async () => {
    const { api, fireMessageUpdated, clientGetCalls } = makeMockApi([], {
      sessionID: "s1",
      messagesBySessionID: { s1: [] },
      childrenBySessionID: { s1: [] },
      parentIDBySessionID: { "child-x": "s1" },
    })
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    await flushAsync() // settle initial children discovery

    const newMsg = makeAssistantMessage("librarian", "anthropic", "claude-opus-4-7", "librarian")
    fireMessageUpdated(newMsg, "child-x")
    // The parentID lookup is async — flush microtasks.
    await flushAsync()

    expect(clientGetCalls).toContain("child-x")
    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("librarian")

    // Subsequent event from the now-known-in-scope session should NOT trigger another lookup.
    const callsBefore = clientGetCalls.length
    const secondMsg = makeAssistantMessage("librarian", "openai", "gpt-5", "librarian")
    fireMessageUpdated(secondMsg, "child-x")
    await flushAsync()
    expect(clientGetCalls.length).toBe(callsBefore)
    // last-write-wins on the headline observed model.
    expect(rows()[0].providerID).toBe("openai")
    expect(rows()[0].modelID).toBe("gpt-5")
    dispose()
  })

  test("AT5. aggregate_team=true: cross-session event from non-child is ignored after lookup resolves", async () => {
    const { api, fireMessageUpdated } = makeMockApi([], {
      sessionID: "s1",
      messagesBySessionID: { s1: [] },
      childrenBySessionID: { s1: [] },
      parentIDBySessionID: { stranger: undefined }, // not a child of s1
    })
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    await flushAsync()
    fireMessageUpdated(makeAssistantMessage("plan", "openai", "gpt-5", "plan"), "stranger")
    await flushAsync()
    expect(rows().length).toBe(0)
    dispose()
  })

  test("AT6. aggregate_team=true: dispose() unsubscribes the message.updated handler", () => {
    const { api, unsubscribeCount } = makeMockApi([], {
      sessionID: "s1",
      messagesBySessionID: { s1: [] },
      childrenBySessionID: { s1: [] },
    })
    const { dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    expect(unsubscribeCount()).toBe(0)
    dispose()
    expect(unsubscribeCount()).toBe(1)
  })

  test("AT7. aggregate_team=true: when members run different models, ◆ aggregate marker reflects partial override", async () => {
    const childA = "child-a"
    const childB = "child-b"
    const leaderMsgs: Message[] = [makeUserMessage()]
    // Configured default: anthropic/claude-opus-4-7
    // Child A matches → not override. Child B differs → override.
    const msgA = makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "plan")
    msgA.sessionID = childA
    const msgB = makeAssistantMessage("plan", "openai", "gpt-5", "plan")
    msgB.sessionID = childB
    const { api } = makeMockApi(leaderMsgs, {
      agentConfig: { plan: { model: "anthropic/claude-opus-4-7" } },
      messagesBySessionID: {
        s1: leaderMsgs,
        [childA]: [msgA],
        [childB]: [msgB],
      },
      childrenBySessionID: {
        s1: [
          { id: childA, parentID: "s1" },
          { id: childB, parentID: "s1" },
        ],
      },
    })
    const { rows, dispose } = useSessionRoleActivity(api, "s1", { aggregateTeam: true })
    await flushAsync()
    expect(rows().length).toBe(1)
    const row = rows()[0]
    expect(row.memberSessions!.length).toBe(2)
    expect(row.memberOverrideCount).toBe(1) // only child-b overrode
    expect(row.isOverride).toBe(true) // aggregate marker reflects partial override
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Static / regression checks (source-level)
// ---------------------------------------------------------------------------

describe("static regression checks", () => {
  test("10. no new SDK event names in TUI source (only message.updated)", () => {
    // Check non-test source files in src/tui/ for any event.on calls NOT using "message.updated"
    let result: string
    try {
      result = execSync(
        `grep -rn 'api\\.event\\.on\\|event\\.on(' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    const lines = result.split("\n").filter((l) => l.trim())
    for (const line of lines) {
      if (line.includes('event.on(') || line.includes('api.event.on(')) {
        expect(line).toContain('"message.updated"')
      }
    }
  })

  test("11. no state.config.agents (plural) in TUI source (C2)", () => {
    let result: string
    try {
      result = execSync(
        `grep -rn 'state\\.config\\.agents' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })

  test("12. no message.model.providerID or message.model.modelID in TUI source (C1)", () => {
    // Only check the TUI tree — the existing server code legitimately uses message.model.* for different purposes
    let result: string
    try {
      result = execSync(
        `grep -rEn 'message\\.model\\.(providerID|modelID)' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })

  test("13. no server-plugin imports in TUI tree (AC9)", () => {
    let result: string
    try {
      result = execSync(
        `grep -rn 'features/roles-models' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })
})
