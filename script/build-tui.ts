#!/usr/bin/env bun
// Build the TUI entry point using @opentui/solid's Bun plugin for JSX transform.
// The plugin uses babel-preset-solid to transform JSX into solid-js reactive calls.
// This replaces `--jsx-runtime automatic --jsx-import-source @opentui/solid` CLI flags
// because @opentui/solid/jsx-runtime has no JS implementation — only types.
import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist/tui",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/sdk",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("✓ TUI entry built: dist/tui/index.js")
