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
 * Every tool lands in the shared command layer (D-01). The lock rule (02.4
 * D-01) lives there, not in this dispatcher, so it holds for any transport a
 * later plan adds.
 */

import type { Actor } from './actor'
import type { ConnectionCommands, ConnectionEndpoint } from './connections'
import type { CommandResult, NoteCommands } from './notes'
import type { SpatialCommands } from './spatial'
import type { WorkspaceFileCommands } from './file-tools'
import { NO_WORKSPACE_MESSAGE } from '../workspace/sandbox'
import type { WherePlacement } from '../../renderer/layout/placement'
import { TOOL_DEFINITIONS } from '../mcp/schemas'

/**
 * The command layer an agent reaches: notes, the connections between them,
 * and the spatial verbs that read and set where notes sit.
 */
export interface AgentCommands {
  notes: NoteCommands
  connections: ConnectionCommands
  spatial: SpatialCommands
  /** Workspace file tools (02.7); absent means no workspace can be open. */
  files?: WorkspaceFileCommands
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

    case 'look':
      return commands.spatial.look(
        parsed.data as { tree: string; from: string; toward?: string; limit?: number },
      )

    case 'place':
      // The actor is the socket's, never read from the arguments.
      return commands.spatial.place(actor, parsed.data as { tree: string; note: string; where: WherePlacement })

    case 'create_note':
      return commands.notes.createFrom(
        actor,
        parsed.data as { tree: string; grewFrom: string; title: string; text: string; where?: WherePlacement },
      )

    case 'update_note':
      return commands.notes.updateNote(
        actor,
        parsed.data as { tree: string; note: string; text: string },
      )

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

    case 'list_files':
      if (!commands.files) return { ok: false, error: NO_WORKSPACE_MESSAGE }
      return commands.files.listFiles(parsed.data as { workspace?: string; path?: string; limit?: number })

    case 'write_file':
      // The actor is the socket's, never read from the arguments.
      if (!commands.files) return { ok: false, error: NO_WORKSPACE_MESSAGE }
      return commands.files.writeFile(actor, parsed.data as { workspace?: string; path: string; text: string })

    case 'open_file':
      if (!commands.files) return { ok: false, error: NO_WORKSPACE_MESSAGE }
      return commands.files.openFile(parsed.data as { workspace?: string; path: string })

    case 'read_file':
      if (!commands.files) return { ok: false, error: NO_WORKSPACE_MESSAGE }
      return commands.files.readFile(
        parsed.data as { workspace?: string; path: string; offset?: number; limit?: number },
      )

    case 'edit_file':
      // The actor is the socket's, never read from the arguments.
      if (!commands.files) return { ok: false, error: NO_WORKSPACE_MESSAGE }
      return commands.files.editFile(
        actor,
        parsed.data as {
          workspace?: string
          path: string
          old_string: string
          new_string: string
          replace_all?: boolean
        },
      )

    default:
      return { ok: false, error: `Unknown tool: ${tool}` }
  }
}
