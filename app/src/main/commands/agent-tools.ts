/**
 * Agent tool dispatch — the point where an agent's request becomes a command.
 *
 * Arguments are re-validated here against the same zod schemas the shim
 * advertises. **The shim is not trusted** (T-02.2-13): it is an ordinary local
 * process that any program running as this user could replace, so main checks
 * every field again before a command runs.
 *
 * The actor is supplied by the caller (the socket server, from the token) and
 * never read from `args`. No schema has an actor field, and each is `.strict()`,
 * so an `actor` key is a validation failure rather than something to ignore.
 */

import type { Actor } from './actor'
import type { CommandResult, NoteCommands } from './notes'
import { TOOL_DEFINITIONS } from '../mcp/schemas'

/** Flatten a zod failure into one readable line. */
function zodMessage(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.map((p) => String(p)).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Run one tool for `actor`, or refuse it.
 *
 * Returns the command layer's `{ ok }` shape; it never throws, so a malformed
 * request cannot take down the socket server handling it.
 */
export function runAgentTool(
  commands: NoteCommands,
  actor: Actor,
  tool: string,
  args: unknown,
): CommandResult<unknown> {
  const definition = TOOL_DEFINITIONS.find((d) => d.name === tool)
  if (!definition) {
    return { ok: false, error: `Unknown tool: ${tool}` }
  }

  const parsed = definition.schema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, error: zodMessage(parsed.error.issues) }
  }

  switch (tool) {
    case 'create_note':
      return commands.createFrom(
        actor,
        parsed.data as { tree: string; grewFrom: string; title: string; text: string },
      )
    default:
      return { ok: false, error: `Unknown tool: ${tool}` }
  }
}
