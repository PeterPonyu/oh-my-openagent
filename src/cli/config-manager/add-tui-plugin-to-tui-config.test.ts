/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { resetConfigContext, initConfigContext } from "./config-context"
import * as pluginNameWithVersionModule from "./plugin-name-with-version"

// Import after mocking setup
import { addTuiPluginToTuiConfig } from "./add-tui-plugin-to-tui-config"

describe("addTuiPluginToTuiConfig", () => {
  let tempDir: string
  let tuiJsonPath: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `omo-tui-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    tuiJsonPath = join(tempDir, "tui.json")

    // Point config context at our temp dir
    initConfigContext("opencode", null)
    // Override getConfigDir via context paths by directly patching the module
    // We use spyOn on config-context to return our tempDir
    spyOn(
      require("./config-context") as { getConfigDir: () => string },
      "getConfigDir"
    ).mockReturnValue(tempDir)

    // Mock getPluginNameWithVersion to avoid npm calls
    spyOn(pluginNameWithVersionModule, "getPluginNameWithVersion").mockResolvedValue(
      "oh-my-openagent@latest"
    )
  })

  afterEach(() => {
    resetConfigContext()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("creates tui.json with correct entry on fresh install", async () => {
    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    expect(result.configPath).toBe(tuiJsonPath)
    expect(existsSync(tuiJsonPath)).toBe(true)

    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toEqual(["oh-my-openagent/tui@latest"])
  })

  it("appends entry to existing tui.json that has other plugins", async () => {
    writeFileSync(tuiJsonPath, JSON.stringify({ plugin: ["some-other-plugin@1.0.0"] }, null, 2) + "\n")

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toContain("oh-my-openagent/tui@latest")
    expect(content.plugin).toContain("some-other-plugin@1.0.0")
  })

  it("replaces older version of our entry without duplicating", async () => {
    writeFileSync(
      tuiJsonPath,
      JSON.stringify({ plugin: ["oh-my-openagent/tui@3.10.0"] }, null, 2) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toEqual(["oh-my-openagent/tui@latest"])
    expect(content.plugin.length).toBe(1)
  })

  it("replaces legacy oh-my-opencode/tui entry with current entry", async () => {
    writeFileSync(
      tuiJsonPath,
      JSON.stringify({ plugin: ["oh-my-opencode/tui@latest", "some-other@1.0.0"] }, null, 2) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toContain("oh-my-openagent/tui@latest")
    expect(content.plugin).toContain("some-other@1.0.0")
    // Legacy entry removed
    expect(content.plugin).not.toContain("oh-my-opencode/tui@latest")
    expect(content.plugin.filter((p: string) => p.startsWith("oh-my-openagent/tui")).length).toBe(1)
  })

  it("preserves non-plugin fields in tui.json", async () => {
    writeFileSync(
      tuiJsonPath,
      JSON.stringify({ theme: "dark", plugin: [] }, null, 2) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { theme: string; plugin: string[] }
    expect(content.theme).toBe("dark")
    expect(content.plugin).toContain("oh-my-openagent/tui@latest")
  })

  it("returns success=false when tui.json contains invalid JSON", async () => {
    writeFileSync(tuiJsonPath, "{ invalid json }")

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it("does NOT add named entry when a file: entry already provides the plugin", async () => {
    // Simulate a dev install: a file: entry pointing at a checkout whose
    // package.json declares one of our accepted package names.
    const filePluginDir = join(tempDir, "local-checkout")
    mkdirSync(filePluginDir, { recursive: true })
    writeFileSync(
      join(filePluginDir, "package.json"),
      JSON.stringify({ name: "oh-my-openagent" }) + "\n"
    )
    writeFileSync(
      tuiJsonPath,
      JSON.stringify({ plugin: [`file:${filePluginDir}`] }, null, 2) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toEqual([`file:${filePluginDir}`])
    // No oh-my-openagent/tui duplicate appended
    expect(content.plugin.some((p: string) => p.startsWith("oh-my-openagent/tui"))).toBe(false)
  })

  it("removes stale named entry when a file: entry already provides the plugin", async () => {
    const filePluginDir = join(tempDir, "local-checkout")
    mkdirSync(filePluginDir, { recursive: true })
    writeFileSync(
      join(filePluginDir, "package.json"),
      JSON.stringify({ name: "oh-my-opencode" }) + "\n" // legacy name still accepted
    )
    writeFileSync(
      tuiJsonPath,
      JSON.stringify(
        { plugin: [`file:${filePluginDir}`, "oh-my-openagent/tui@3.10.0"] },
        null,
        2
      ) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    expect(content.plugin).toEqual([`file:${filePluginDir}`])
  })

  it("ignores file: entries that do not point at our package", async () => {
    const filePluginDir = join(tempDir, "third-party-plugin")
    mkdirSync(filePluginDir, { recursive: true })
    writeFileSync(
      join(filePluginDir, "package.json"),
      JSON.stringify({ name: "some-other-plugin" }) + "\n"
    )
    writeFileSync(
      tuiJsonPath,
      JSON.stringify({ plugin: [`file:${filePluginDir}`] }, null, 2) + "\n"
    )

    const result = await addTuiPluginToTuiConfig("3.13.1")

    expect(result.success).toBe(true)
    const content = JSON.parse(readFileSync(tuiJsonPath, "utf-8")) as { plugin: string[] }
    // file: entry stays AND named entry is appended (third-party doesn't satisfy ours)
    expect(content.plugin).toContain(`file:${filePluginDir}`)
    expect(content.plugin).toContain("oh-my-openagent/tui@latest")
  })
})
