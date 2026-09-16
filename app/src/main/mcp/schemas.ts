/**
 * MCP tool argument schemas.
 *
 * This module is the contract between the shim and the main process, and it is
 * deliberately tiny: it imports only zod. The shim bundle must not pull in
 * electron, the kernel bridge or the native addon, so nothing here may reach
 * for them, directly or transitively.
 *
 * **No schema has an actor field, and every schema is `.strict()`.** Together
 * those two facts are what make D-06 hold at the protocol edge: a model cannot
 * name who it is, and it cannot smuggle an `actor` key past validation either.
 * The agent id is derived in main from the token on the socket (T-02.2-11).
 */

import * as z from 'zod'

/**
 * MCP tool annotations. Hints for the client, never enforcement — the host
 * enforces in NoteCommands regardless of what a tool advertises here.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly schema: z.ZodType
  readonly annotations: ToolAnnotations
}

// ---------------------------------------------------------------------------
// Argument schemas
// ---------------------------------------------------------------------------

/**
 * create_note (D-04). `grewFrom` is required and has no default: a note an
 * agent creates is always grown from a note that already exists.
 */
export const CreateNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    grewFrom: z.string().min(1).max(1024),
    title: z.string().min(1).max(200),
    text: z.string().max(1000000),
  })
  .strict()

/** list_trees takes no arguments — and `.strict()` means it accepts none. */
export const ListTreesArgs = z.object({}).strict()

/** read_note (D-05): agents may read any note. */
export const ReadNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
  })
  .strict()

// ---------------------------------------------------------------------------
// Tool table
// ---------------------------------------------------------------------------

/**
 * Every tool the bridge exposes. The shim advertises these and main
 * re-validates against the same schemas, so the shim is never trusted.
 */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.freeze([
  {
    name: 'create_note',
    title: 'Create a note grown from an existing note',
    description:
      'Creates a note connected to grewFrom. Every new note must grow from an existing note; loose notes are refused.',
    schema: CreateNoteArgs,
    annotations: {},
  },
  {
    name: 'list_trees',
    title: 'List the trees open in Tapestry',
    description: 'Lists the trees currently open in Tapestry, with the name to pass as `tree`.',
    schema: ListTreesArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_note',
    title: 'Read a note with its author and connections',
    description:
      'Reads a note: its title, text, the actor that created it, and the notes it connects to.',
    schema: ReadNoteArgs,
    annotations: { readOnlyHint: true },
  },
])
