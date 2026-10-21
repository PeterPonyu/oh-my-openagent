import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"

describe("bundled model capabilities snapshot", () => {
  test("keeps the built-in DeepSeek fallback backed by documented capabilities", () => {
    // given the canonical model and its provider-prefixed form
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot()

    // when capabilities are resolved without a runtime catalog
    for (const modelID of ["deepseek-v4-pro", "deepseek/deepseek-v4-pro"]) {
      const result = getModelCapabilities({ providerID: "deepseek", modelID, bundledSnapshot })

      // then supported tools, thinking and output limits come from bundled metadata
      expect(result).toMatchObject({
        canonicalModelID: "deepseek-v4-pro",
        reasoning: true,
        supportsThinking: true,
        supportsTemperature: true,
        toolCall: true,
        maxOutputTokens: 393216,
        modalities: { input: ["text"], output: ["text"] },
        diagnostics: { resolutionMode: "snapshot-backed", snapshot: { source: "bundled-snapshot" } },
      })
    }
  })

  test("keeps GPT-4.1 OpenAI variants marked as supporting tool calls", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot()
    const modelIDs = [
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
    ]

    // when
    const results = modelIDs.map((modelID) =>
      getModelCapabilities({
        providerID: "openai",
        modelID,
        bundledSnapshot,
      }),
    )

    // then
    for (const result of results) {
      expect(result.toolCall).toBe(true)
      expect(result.diagnostics).toMatchObject({
        resolutionMode: "snapshot-backed",
        snapshot: { source: "bundled-snapshot" },
        toolCall: { source: "bundled-snapshot" },
      })
    }
  })
})
