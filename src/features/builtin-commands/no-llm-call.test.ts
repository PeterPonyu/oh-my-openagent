/// <reference path="../../../bun-test.d.ts" />

/**
 * Spec AC8 verification for /show-models, /pick, /auto-pick.
 *
 * Primary assertion (behavioral): each command definition carries `noReply: true`,
 * which signals the opencode host to short-circuit at `prompt.ts:1387` before
 * dispatching the LLM. Requires opencode >= 1.14.51, which added the `noReply`
 * flag to the command schema.
 *
 * Secondary assertion (defensive): templates do not contain prompt directives
 * that would induce a follow-up turn — guards against accidental reintroduction
 * if a future refactor drops the `noReply` flag.
 */

import { describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("no-llm-call: display-only commands must skip LLM dispatch via noReply", () => {
  const commands = loadBuiltinCommands(undefined, {})

  for (const name of ["show-models", "pick", "auto-pick"] as const) {
    test(`${name} sets noReply: true on the command definition`, () => {
      expect(commands[name]?.noReply).toBe(true)
    })

    test(`${name} template does not contain "Acknowledge"`, () => {
      const template = commands[name]?.template ?? ""
      expect(template).not.toContain("Acknowledge")
    })

    test(`${name} template does not contain "stay silent"`, () => {
      const template = commands[name]?.template ?? ""
      expect(template).not.toContain("stay silent")
    })
  }
})
