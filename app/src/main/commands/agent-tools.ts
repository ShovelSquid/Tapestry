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
 *
 * Every tool lands in the shared command layer (D-01). The D-05 ownership rule
 * lives there, not here, so it holds for any transport a later plan adds.
 */

import type { Actor } from './actor'
import type { ConnectionCommands, ConnectionEndpoint } from './connections'
import type { CommandResult, NoteCommands } from './notes'
import { TOOL_DEFINITIONS } from '../mcp/schemas'
import { runThreadTool, THREAD_NODE_TYPE, THREAD_TOOL_DEFINITIONS, type ThreadToolCommands } from '../threads/thread-tools'

/** The command layer an agent reaches: notes and the connections between them. */
export interface AgentCommands {
  notes: NoteCommands
  connections: ConnectionCommands
  /**
   * The five D-20..D-24 thread tools (Plan 08). Optional so a caller that
   * only needs the base note/connection tools (e.g. a test harness with no
   * ThreadService) is not forced to wire one in — a thread tool call is then
   * refused with a clear message rather than this module throwing.
   */
  threads?: ThreadToolCommands
}

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
  commands: AgentCommands,
  actor: Actor,
  tool: string,
  args: unknown,
): CommandResult<unknown> {
  const definition = TOOL_DEFINITIONS.find((d) => d.name === tool)
  if (!definition) {
    // Not one of the base note/connection tools -- try the D-20..D-24
    // thread tools before giving up. THREAD_TOOL_DEFINITIONS re-validates
    // args itself (the same "never trust the shim" discipline this module
    // applies above), so no schema lookup happens twice here.
    if (THREAD_TOOL_DEFINITIONS.some((d) => d.name === tool)) {
      if (!commands.threads) {
        return { ok: false, error: 'Thread tools are not available' }
      }
      return runThreadTool(commands.threads, actor, tool, args)
    }
    return { ok: false, error: `Unknown tool: ${tool}` }
  }

  const parsed = definition.schema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, error: zodMessage(parsed.error.issues) }
  }

  switch (tool) {
    case 'list_trees':
      return commands.notes.listTrees()

    case 'search_notes':
      return commands.notes.searchNotes(
        parsed.data as { tree?: string; query: string; limit?: number },
      )

    case 'read_note':
      return commands.notes.readNote(parsed.data as { tree: string; note: string })

    case 'create_note':
      return commands.notes.createFrom(
        actor,
        parsed.data as { tree: string; grewFrom: string; title: string; text: string },
      )

    case 'update_note': {
      const updateArgs = parsed.data as { tree: string; note: string; text: string }
      // T-02.3-08-02: update_note's whole-body rewrite would otherwise
      // bypass D-22's per-letter rule entirely. Routed to a plain refusal
      // for a thread node; the thread tools above are the only way to
      // change a thread's text. Best-effort: an unresolvable tree/note is
      // left for commands.notes.updateNote's own, better-scoped error.
      if (commands.threads) {
        try {
          const tree = commands.threads.registry.resolveRef(updateArgs.tree)
          const node = tree.bridge.getNode(updateArgs.note)
          if (node && node.type === THREAD_NODE_TYPE) {
            return {
              ok: false,
              error: `${updateArgs.note} is a thread; use append_to_thread, insert_into_thread, replace_in_thread or delete_from_thread instead of update_note`,
            }
          }
        } catch {
          // Fall through to updateNote's own resolution/error handling.
        }
      }
      return commands.notes.updateNote(actor, updateArgs)
    }

    case 'rename_note':
      return commands.notes.renameNote(
        actor,
        parsed.data as { tree: string; note: string; title: string },
      )

    case 'delete_note':
      return commands.notes.deleteNote(actor, parsed.data as { tree: string; note: string })

    case 'connect_notes':
      return commands.connections.connect(
        actor,
        parsed.data as { from: ConnectionEndpoint; to: ConnectionEndpoint; label?: string },
      )

    default:
      return { ok: false, error: `Unknown tool: ${tool}` }
  }
}
