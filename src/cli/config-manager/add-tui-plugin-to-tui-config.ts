import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME, LEGACY_PLUGIN_NAME, ACCEPTED_PACKAGE_NAMES } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { getPluginNameWithVersion } from "./plugin-name-with-version"

const TUI_SUBPATH = "tui"

function toTuiEntry(pluginEntry: string): string {
  const atIndex = pluginEntry.indexOf("@")
  if (atIndex === -1) {
    return `${pluginEntry}/${TUI_SUBPATH}`
  }
  const name = pluginEntry.slice(0, atIndex)
  const tag = pluginEntry.slice(atIndex)
  return `${name}/${TUI_SUBPATH}${tag}`
}

// Returns true if `entry` is a file:-URL pointing at a directory whose
// package.json declares one of our accepted package names. opencode-tui already
// loads such entries via the `./tui` subpath export, so appending the named
// `oh-my-openagent/tui` entry alongside causes opencode to additionally try to
// npm-install the published package — which currently fails on opencode dev with
// "An unknown git error occurred" and adds ~26s of dead wait per launch.
function isOurFilePluginEntry(entry: string): boolean {
  if (!entry.startsWith("file:")) return false
  let path = entry.slice("file:".length)
  if (path.startsWith("//")) path = path.slice(2)
  try {
    const pkgJsonPath = join(path, "package.json")
    if (!existsSync(pkgJsonPath)) return false
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: unknown }
    return typeof parsed.name === "string"
      && (ACCEPTED_PACKAGE_NAMES as readonly string[]).includes(parsed.name)
  } catch {
    return false
  }
}

interface TuiConfig {
  plugin?: string[]
  [key: string]: unknown
}

export async function addTuiPluginToTuiConfig(currentVersion: string): Promise<ConfigMergeResult> {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, "create config directory"),
    }
  }

  const configDir = getConfigDir()
  const tuiJsonPath = join(configDir, "tui.json")

  const baseEntry = await getPluginNameWithVersion(currentVersion, PLUGIN_NAME)
  const tuiEntry = toTuiEntry(baseEntry)

  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  const legacyPrefix = `${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}`

  try {
    if (!existsSync(tuiJsonPath)) {
      const config: TuiConfig = { plugin: [tuiEntry] }
      writeFileSync(tuiJsonPath, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: tuiJsonPath }
    }

    let config: TuiConfig
    try {
      config = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as TuiConfig
    } catch (err) {
      return {
        success: false,
        configPath: tuiJsonPath,
        error: formatErrorWithSuggestion(err, "parse tui.json"),
      }
    }

    const plugins = config.plugin ?? []

    const isCanonical = (p: string) => p === canonicalPrefix || p.startsWith(`${canonicalPrefix}@`)
    const isLegacy = (p: string) => p === legacyPrefix || p.startsWith(`${legacyPrefix}@`)

    const hasExisting = plugins.some((p) => isCanonical(p) || isLegacy(p))

    if (hasExisting) {
      const backupResult = backupConfigFile(tuiJsonPath)
      if (!backupResult.success) {
        return {
          success: false,
          configPath: tuiJsonPath,
          error: `Failed to create backup: ${backupResult.error}`,
        }
      }
    }

    const otherPlugins = plugins.filter((p) => !isCanonical(p) && !isLegacy(p))
    const fileProvidesPlugin = otherPlugins.some(isOurFilePluginEntry)
    const normalizedPlugins = fileProvidesPlugin ? otherPlugins : [...otherPlugins, tuiEntry]

    if (
      normalizedPlugins.length === plugins.length
      && normalizedPlugins.every((p, i) => p === plugins[i])
    ) {
      return { success: true, configPath: tuiJsonPath }
    }

    config.plugin = normalizedPlugins
    writeFileSync(tuiJsonPath, JSON.stringify(config, null, 2) + "\n")

    return { success: true, configPath: tuiJsonPath }
  } catch (err) {
    return {
      success: false,
      configPath: tuiJsonPath,
      error: formatErrorWithSuggestion(err, "update tui config"),
    }
  }
}
