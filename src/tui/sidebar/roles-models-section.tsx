// JSX-RUNTIME-SOURCE: @opentui/solid (verified: node_modules/@opentui/solid/package.json exports ./jsx-runtime)
// Sub-agent / team-member tracking is out of scope: this section only shows roles observed
// in the current leader session. Member panes handle their own routes.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useSessionRoleActivity } from "./use-session-role-activity"
import type { RoleRow } from "./derive-row"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { readOmoDisplayConfig } from "../../shared/read-omo-display-config"

type Props = { session_id: string; api: TuiPluginApi }

// totalCount is pure data — the canonical OMO role catalog. Hoisted out of the
// `activity` indirection so the header renders the correct denominator on first
// paint, before createEffect fires (D1 fix from visual QA).
const TOTAL_COUNT = Object.keys(AGENT_MODEL_REQUIREMENTS).length

export function RolesModelsSection(props: Props): JSX.Element {
  const [collapsed, setCollapsed] = createSignal<boolean>(true)
  const [expandedRows, setExpandedRows] = createSignal<Set<string>>(new Set())

  // Architect A4 fix: re-create the subscription when session_id changes.
  // D1 fix: `activity` is a Solid signal (not `let`) so the JSX re-renders when
  // the effect populates it — previously, `let activity` was non-reactive and the
  // header stayed at `?? 0` from first paint forever.
  // createEffect re-runs whenever props.session_id mutates; Solid automatically runs
  // the previous onCleanup before re-executing the effect, so onCleanup owns teardown.
  const [activity, setActivity] = createSignal<ReturnType<typeof useSessionRoleActivity> | undefined>(undefined)
  // B1: read `display.aggregate_team` from oh-my-openagent.json on disk. The TUI
  // plugin runs in its own process so OMO-side runtime config isn't in api.state.
  // The helper memoizes, so calling it once per effect run is cheap.
  const aggregateTeam = readOmoDisplayConfig().aggregate_team
  createEffect(() => {
    const sid = props.session_id
    const next = useSessionRoleActivity(props.api, sid, { aggregateTeam })
    setActivity(next)
    onCleanup(() => {
      next.dispose()
      setActivity(undefined)
    })
  })

  // Theme reactivity (Critic C5 resolution):
  // api.theme.current is a TuiThemeCurrent (tui.d.ts:151-205) — a frozen object of readonly RGBA fields.
  // It is NOT a Solid accessor. There is no `theme.changed` event in the Event union (types.gen.d.ts:819).
  // Theme colors are pinned at component-mount time. Mid-session theme switches do NOT re-render
  // this section until the slot remounts. Documented Non-Goal (FU6).
  const theme = props.api.theme.current

  return (
    <box flexDirection="column" gap={0}>
      <text
        fg={theme.text}
        onMouseDown={(e) => {
          if (e.button === 0) setCollapsed(!collapsed())
        }}
      >
        {collapsed() ? "▶" : "▼"} Roles · Models   {activity()?.activeCount() ?? 0}/{TOTAL_COUNT} active
      </text>
      <Show when={!collapsed() && activity()}>
        <For each={activity()!.rows()}>
          {(row: RoleRow) => (
            <box flexDirection="column">
              <text
                fg={theme.text}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  setExpandedRows((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.role)) next.delete(row.role)
                    else next.add(row.role)
                    return next
                  })
                }}
              >
                {row.role}   {row.hasEffectiveDefault && row.isOverride ? "◆" : "●"} {row.providerID}/{row.modelID}{row.memberSessions && row.memberSessions.length > 1 ? ` (${row.memberOverrideCount ?? 0}/${row.memberSessions.length} members override)` : ""}
              </text>
              {/* Aggregate-team member breakdown (F3): one muted row per team-member session
                  when the same role was observed in >1 sub-sessions. Plain strings only —
                  nested <text> inside <text> crashes the renderer (1db63e1a50). */}
              <Show when={expandedRows().has(row.role) && row.memberSessions && row.memberSessions.length > 1}>
                <For each={row.memberSessions!}>
                  {(member) => (
                    <text fg={theme.textMuted}>
                      {"      "}{member.sessionID}   {member.isOverride ? "◆" : "●"} {member.providerID}/{member.modelID}
                    </text>
                  )}
                </For>
              </Show>
              <Show when={expandedRows().has(row.role) && row.hasEffectiveDefault && row.fallbackChain.length > 0}>
                <For each={row.fallbackChain}>
                  {(entry) => (
                    <text fg={theme.textMuted}>
                      {"  "}↓ {entry.model}{entry.variant ? ` (${entry.variant})` : ""}
                    </text>
                  )}
                </For>
              </Show>
            </box>
          )}
        </For>
        {/* Auto-pick footer DEFERRED per Critic C3 / FU5; section ends here in v1. */}
      </Show>
    </box>
  )
}
