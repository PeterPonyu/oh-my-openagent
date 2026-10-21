import { describe, expect, test } from "bun:test"

describe("test environment restoration", () => {
  test("allows a fixture to replace the environment object", () => {
    process.env = { ...process.env, OMO_TEST_DETACHED_ENVIRONMENT: "fixture" }

    expect(process.env.OMO_TEST_DETACHED_ENVIRONMENT).toBe("fixture")
    expect(Bun.env.OMO_TEST_DETACHED_ENVIRONMENT).toBeUndefined()
  })

  test("restores the native environment object before the next test", () => {
    expect(process.env === Bun.env).toBe(true)
    expect(process.env.OMO_TEST_DETACHED_ENVIRONMENT).toBeUndefined()
    expect(Bun.env.OMO_TEST_DETACHED_ENVIRONMENT).toBeUndefined()
  })
})
