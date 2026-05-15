// IMPORTED BY: tui — filesystem read of oh-my-openagent.json display section.
//
// The TUI plugin process runs in a separate process from the server plugin and
// has no direct access to OMO-side runtime config (state.config is the
// opencode-native PluginConfig view, NOT the parsed OMO config). To learn the
// user's `display.aggregate_team` preference, the TUI plugin reads the OMO
// config file directly from disk.
//
// Path resolution mirrors src/shared/opencode-config-dir.ts:
//   - OPENCODE_CONFIG_DIR env var
//   - else XDG_CONFIG_HOME (or ~/.config) + "opencode/oh-my-openagent.json"
//
// File-missing / malformed-JSON / missing-display-section cases all yield the
// default DisplayConfig — never throw. The result is memoized for the lifetime
// of the process so the TUI section can call it cheaply on mount/re-mount.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// Display defaults must match src/config/schema/display.ts (zod defaults).
// Duplicated here to avoid pulling zod into the TUI bundle.
export type DisplayConfigShape = {
  show_models_on_session_start: boolean
  show_models_on_fallback: boolean
  auto_pick: boolean
  auto_pick_budget: number
  aggregate_team: boolean
}

const DEFAULT_DISPLAY: DisplayConfigShape = {
  show_models_on_session_start: false,
  show_models_on_fallback: false,
  auto_pick: false,
  auto_pick_budget: 2,
  aggregate_team: false,
}

function resolveOmoConfigPath(): string {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (envConfigDir) {
    return join(envConfigDir, "oh-my-openagent.json")
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "opencode", "oh-my-openagent.json")
}

function coerceDisplay(raw: unknown): DisplayConfigShape {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DISPLAY }
  const obj = raw as Record<string, unknown>
  const out: DisplayConfigShape = { ...DEFAULT_DISPLAY }
  if (typeof obj.show_models_on_session_start === "boolean")
    out.show_models_on_session_start = obj.show_models_on_session_start
  if (typeof obj.show_models_on_fallback === "boolean")
    out.show_models_on_fallback = obj.show_models_on_fallback
  if (typeof obj.auto_pick === "boolean") out.auto_pick = obj.auto_pick
  if (typeof obj.auto_pick_budget === "number" && Number.isFinite(obj.auto_pick_budget))
    out.auto_pick_budget = obj.auto_pick_budget
  if (typeof obj.aggregate_team === "boolean") out.aggregate_team = obj.aggregate_team
  return out
}

function readUncached(pathOverride?: string): DisplayConfigShape {
  const configPath = pathOverride ?? resolveOmoConfigPath()
  if (!existsSync(configPath)) return { ...DEFAULT_DISPLAY }
  let raw: string
  try {
    raw = readFileSync(configPath, "utf-8")
  } catch {
    return { ...DEFAULT_DISPLAY }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_DISPLAY }
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DISPLAY }
  const display = (parsed as Record<string, unknown>).display
  return coerceDisplay(display)
}

let cached: DisplayConfigShape | undefined

/**
 * Returns the OMO display config from disk, memoized for the process lifetime.
 * Use `resetReadOmoDisplayConfigCache()` in tests to clear the memo.
 */
export function readOmoDisplayConfig(pathOverride?: string): DisplayConfigShape {
  // When a path override is supplied (test injection), bypass the cache —
  // tests need to read different fixtures within one process.
  if (pathOverride) return readUncached(pathOverride)
  if (cached) return cached
  cached = readUncached()
  return cached
}

export function resetReadOmoDisplayConfigCache(): void {
  cached = undefined
}
