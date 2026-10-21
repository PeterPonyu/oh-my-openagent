import { describe, expect, spyOn, test } from "bun:test"

import { validateNonTuiArgs } from "./install-validators"
import type { InstallArgs } from "./types"

function createArgs(overrides: Partial<InstallArgs> = {}): InstallArgs {
  return {
    tui: false,
    claude: "no",
    openai: "no",
    gemini: "no",
    copilot: "no",
    opencodeZen: "no",
    zaiCodingPlan: "no",
    kimiForCoding: "no",
    opencodeGo: "no",
    skipAuth: false,
    ...overrides,
  }
}

describe("validateNonTuiArgs", () => {
  test("rejects invalid --opencode-go values", () => {
    // #given
    const args = createArgs({ opencodeGo: "maybe" as InstallArgs["opencodeGo"] })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Invalid --opencode-go value: maybe (expected: no, yes)")
  })
})

describe("printBox", () => {
  test("uses ASCII borders in CI", async () => {
    // given
    const originalCI = process.env.CI
    process.env.CI = "true"
    const logs: string[] = []
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "))
    })
    try {
      const { printBox } = await import(`./install-validators?ci-box-${Date.now()}`)

      // when
      printBox("hello", "Title")

      // then
      const rendered = logs.join("\n").replace(new RegExp("\u001b\\[[0-9;]*m", "g"), "")
      expect(logSpy).toHaveBeenCalled()
      expect(rendered).toContain("+")
      expect(rendered).toContain("| hello")
      expect(rendered).not.toContain("┌")
      expect(rendered).not.toContain("│")
    } finally {
      logSpy.mockRestore()
      if (originalCI === undefined) delete process.env.CI
      else process.env.CI = originalCI
    }
  })
})
