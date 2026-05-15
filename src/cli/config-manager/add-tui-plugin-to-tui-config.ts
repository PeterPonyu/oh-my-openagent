import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME, LEGACY_PLUGIN_NAME } from "../../shared"
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
    const normalizedPlugins = [...otherPlugins, tuiEntry]

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
