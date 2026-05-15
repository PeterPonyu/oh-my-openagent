/// <reference path="../../bun-test.d.ts" />

import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readOmoDisplayConfig,
  resetReadOmoDisplayConfigCache,
} from "./read-omo-display-config"

describe("readOmoDisplayConfig", () => {
  beforeEach(() => {
    resetReadOmoDisplayConfigCache()
  })

  test("returns defaults when file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const result = readOmoDisplayConfig(join(dir, "does-not-exist.json"))
    expect(result.aggregate_team).toBe(false)
    expect(result.auto_pick).toBe(false)
    expect(result.show_models_on_session_start).toBe(false)
    expect(result.show_models_on_fallback).toBe(false)
    expect(result.auto_pick_budget).toBe(2)
  })

  test("returns defaults when file is malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const path = join(dir, "oh-my-openagent.json")
    writeFileSync(path, "{not valid json", "utf-8")
    const result = readOmoDisplayConfig(path)
    expect(result.aggregate_team).toBe(false)
  })

  test("returns defaults when display section is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const path = join(dir, "oh-my-openagent.json")
    writeFileSync(path, JSON.stringify({ other_section: { x: 1 } }), "utf-8")
    const result = readOmoDisplayConfig(path)
    expect(result.aggregate_team).toBe(false)
  })

  test("reads aggregate_team=true when set in display section", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const path = join(dir, "oh-my-openagent.json")
    writeFileSync(
      path,
      JSON.stringify({ display: { aggregate_team: true } }),
      "utf-8",
    )
    const result = readOmoDisplayConfig(path)
    expect(result.aggregate_team).toBe(true)
  })

  test("ignores wrong-typed values and falls back to defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const path = join(dir, "oh-my-openagent.json")
    writeFileSync(
      path,
      JSON.stringify({ display: { aggregate_team: "yes", auto_pick: 1 } }),
      "utf-8",
    )
    const result = readOmoDisplayConfig(path)
    expect(result.aggregate_team).toBe(false)
    expect(result.auto_pick).toBe(false)
  })

  test("memoizes the default-path lookup across calls", () => {
    // No pathOverride → first call populates the cache; second returns the same object.
    const a = readOmoDisplayConfig()
    const b = readOmoDisplayConfig()
    expect(a).toBe(b)
    resetReadOmoDisplayConfigCache()
    const c = readOmoDisplayConfig()
    expect(c).not.toBe(a)
  })

  test("pathOverride bypasses the memo so tests can use different fixtures", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-display-"))
    const pathA = join(dir, "a.json")
    const pathB = join(dir, "b.json")
    writeFileSync(pathA, JSON.stringify({ display: { aggregate_team: true } }), "utf-8")
    writeFileSync(pathB, JSON.stringify({ display: { aggregate_team: false } }), "utf-8")
    expect(readOmoDisplayConfig(pathA).aggregate_team).toBe(true)
    expect(readOmoDisplayConfig(pathB).aggregate_team).toBe(false)
  })
})
