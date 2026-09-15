# API Coverage — Model Context Protocol server (`@modelcontextprotocol/server` 2.0.0)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Phase 2.2 implements an MCP **server** (`tapestry-mcp`, a stdio process) that agents such as Claude Code connect to (D-03). The Obsidian half is not an API integration: it reads and writes the vault's files directly. The matrix below covers the server-side MCP capability surface.

| capability | decision | reason |
|---|---|---|
| initialize / lifecycle (serveStdio, legacy openings served) | INTEGRATE | |
| stdio transport | INTEGRATE | |
| tools/list | INTEGRATE | |
| tools/call | INTEGRATE | |
| tool input schemas (zod, no actor field) | INTEGRATE | |
| tool annotations (readOnlyHint, destructiveHint) | INTEGRATE | |
| ping | INTEGRATE | |
| cancellation notifications | INTEGRATE | |
| structured tool output (outputSchema) | OPT-OUT | not needed yet — tools return JSON text content, which Claude Code and other local clients read; revisit when a client needs typed results |
| resources (list, read, subscribe) | OPT-OUT | not needed yet — D-03 asks for a small, clear set of tools; notes are reached through read_note and search_notes |
| resource templates | OPT-OUT | not needed yet — same reason as resources |
| prompts | OPT-OUT | explicitly out of scope — agents bring their own prompts; no decision in 02.2-CONTEXT.md asks for server prompts |
| sampling (server asks the client's model) | OPT-OUT | explicitly out of scope — Tapestry never calls a model (HIST-05 replay rule; the companion is Phase 6) |
| elicitation | OPT-OUT | not needed yet — refusals (D-04, D-05) are returned as tool errors to the agent |
| logging notifications | OPT-OUT | not needed — the shim logs to stderr only, because stdout carries the protocol |
| completions | OPT-OUT | not needed — tool arguments are note ids, paths and free text |
| progress notifications | OPT-OUT | not needed yet — every tool call is a single short commit or file write |
| subscriptions / list_changed | OPT-OUT | not needed yet — the tool list is static for a running shim |
| roots (client capability) | OPT-OUT | not needed — the vault root comes from Tapestry's settings, not from the client |
| Streamable HTTP transport (ChatGPT via public HTTPS or Secure MCP Tunnel) | OPT-OUT | explicitly out of scope for 2.2 — a public endpoint to a local world needs Kaelen present; deferred in 02.2-12-PLAN.md; stdio serves Claude Code and local clients |
| HTTP authorization (OAuth) | OPT-OUT | not needed — local agents authenticate with a per-agent token over a 0600 Unix socket; only the deferred HTTP slice would need it |
