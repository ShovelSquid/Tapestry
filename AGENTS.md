<!-- GSD:project-start source:PROJECT.md -->

## Project

**Tapestry**

Tapestry is a spatial second brain built on a small extensible core, where people create, connect, and arrange readable nodes containing notes, drawings, structured data, people, events, concepts, and executable natural-language rules. Plugins provide the conversational companion, specialized editing tools, integrations, and other features, while the deterministic core owns the world's state and branching history. Human-readable `.tree` files preserve that history so its meaning remains accessible without Tapestry itself.

**Core Value:** Your world of thoughts must remain readable and under your control—in its spatial interface, its editable relationships and behavior, and its files and branching history.

### Constraints

- **Readability:** Core content, relationships, changes, and provenance must be inspectable without the application. Binary attachments may be referenced; their bytes cannot substitute for readable descriptions.
- **Control:** Users can edit content, properties, dates, connections, placement, and guessing policies. Historical origin remains available after correction.
- **History:** Editing the past preserves the original future in a branch. Replay must use recorded outcomes, not new model guesses.
- **Simple core:** Storage, graph state, and rule execution must be conceptually small and separable from live AI and integration adapters.
- **Plugins from the beginning:** Features extend a versioned public API. First-party plugins exercise the same API as third-party plugins; adding a normal feature must not require a core fork.
- **Developer accessibility:** Plugin authors need a short development loop and clear examples, without having to build the native application to try an extension.
- **Usable UI:** The initial milestone includes actual editing, spatial interaction, rule effects, and timeline navigation, not only backend demonstrations.
- **Development scope:** Work remains in the current Conductor workspace. Do not rename its branch or write planning artifacts into the primary checkout.
- **Unspecified:** No delivery date, budget, monetization model, AI provider, final UI toolkit, or universal cross-platform replay guarantee has been chosen.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
