---
created: 2026-09-24T16:42:39.988Z
title: Run Claude in the app with an ask and respond channel
area: ui
severity: major
files:
  - app/src/renderer/components/AgentsPanel.tsx
  - app/src/renderer/components/ConnectAgentDialog.tsx
  - app/src/renderer/components/NoteControls.tsx
  - app/src/main/mcp/schemas.ts
  - app/src/main/commands/agent-tools.ts
---

## Problem

Kaelen (2026-09-24): "agents also need to be able to be imported, I think in notes there should be a button to access claude and then do a little ask and respond channel; or to have agent inputs in the agents window, to be able to ask them to do something so that way they can create notes or move stuff around or whatever."

Clarified 2026-09-24:

- **"Imported" means the agent runs in the app.** Tapestry itself starts and runs Claude; no separate Claude Code window.
- **Scope is a small slice now, as a new inserted phase.** Phase 6 (Conversational Companion & Guessing Policy) later builds the full companion on top of it.

Today an agent is always external. Claude Code connects through `claude mcp add` (ConnectAgentDialog), reaching Tapestry through a stdio shim and a 0600 Unix socket. It acts through the 10 MCP tools (`create_note`, `update_note`, `look`, `place`, and so on), and main stamps its actor from a per-agent token. Nothing inside Tapestry can start an agent or send it a request.

## Solution

TBD — needs a discuss step first. Open decisions:

- **Where the ask box lives.** A per-note button that opens an ask/respond thread about that note, an input in the Agents panel, or both.
- **How Tapestry runs Claude. This is a real decision: CLAUDE.md says no AI provider has been chosen.** Options:
  - Spawn the `claude` CLI (Claude Code) headless with Tapestry's MCP server configured. This reuses the existing tools, socket and actor stamping, and needs Claude Code installed.
  - Embed the Claude Agent SDK in the main process.
  - Call the Claude API directly and implement the tool loop over the same command layer. This needs an API key and key storage.
- **Keep the architecture.** The agent should act through the same command set and locks as external agents, so provenance (`agent.*` actor), `lock.layout` and refusals behave identically. The core must keep working with the agent absent (Phase 6 SC5, and the offline and minimal-core constraints in CLAUDE.md).
- **What is recorded.** Is the ask/respond conversation stored in the world as readable content, as Phase 6 SC1 wants eventually, or kept outside the `.tree` for this slice?
- **Plugin boundary.** Per CLAUDE.md, the companion should be a plugin on the public API rather than core code; check whether the plugin API can host this now.
