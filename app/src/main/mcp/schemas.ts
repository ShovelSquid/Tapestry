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

// Placement arguments (02.5 D-09, D-10, D-11)
//
// Where a note goes, named by ids only: near one note, or beyond one note as
// seen from another. The host works out the exact spot; an agent never sends
// or receives a coordinate (D-14). The space form and the orientation form
// belong to later phases (D-11, Decision Register #12), so they fail both
// members below, as does a lone `beyond` or a mix of the two shapes.
// create_note reuses WhereArgs (Plan 05), so it stays above CreateNoteArgs.

/** Near one note. */
const NearArgs = z
  .object({
    near: z.string().min(1).max(1024),
  })
  .strict()

/** Beyond one note, as seen from another. */
const BeyondArgs = z
  .object({
    beyond: z.string().min(1).max(1024),
    from: z.string().min(1).max(1024),
  })
  .strict()

/** A placement: `{ near }` or `{ beyond, from }`, ids only. */
export const WhereArgs = z.union([NearArgs, BeyondArgs])

/**
 * place: moves a note relative to other notes in the same tree. Refused when
 * the note's `layout` aspect is locked against the calling agent (02.4, 02.5
 * D-15). See commands/locks.ts.
 */
export const PlaceArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
    where: WhereArgs,
  })
  .strict()

/**
 * create_note (D-04). `grewFrom` is required and has no default: a note an
 * agent creates is always grown from a note that already exists.
 *
 * `where` (02.5 SC2) is optional and is the same relation `place` takes; the
 * host resolves it to a spot. Without it, the note goes to the right of
 * `grewFrom` as before.
 */
export const CreateNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    grewFrom: z.string().min(1).max(1024),
    title: z.string().min(1).max(200),
    text: z.string().max(1000000),
    where: WhereArgs.optional(),
  })
  .strict()

/** list_trees takes no arguments — and `.strict()` means it accepts none. */
export const ListTreesArgs = z.object({}).strict()

/** read_note: agents may read any note; reading stays unrestricted (02.4 D-01). */
export const ReadNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
  })
  .strict()

/**
 * look (SC1, D-14): the notes around a note, as relations only. `limit` has
 * no upper bound; the work is one pass over the tree's own notes.
 */
export const LookArgs = z
  .object({
    tree: z.string().min(1).max(200),
    from: z.string().min(1).max(1024),
    toward: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).optional(),
  })
  .strict()

/** search_notes: reading stays unrestricted (02.4 D-01), so this searches every tree. */
export const SearchNotesArgs = z
  .object({
    tree: z.string().min(1).max(200).optional(),
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()

/**
 * update_note: refused when the note's `text` aspect is locked against the
 * calling agent (02.4 D-01, D-03, D-08). See commands/locks.ts.
 */
export const UpdateNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
    text: z.string().max(1000000),
  })
  .strict()

/**
 * rename_note: a title is part of the note's text, so this is refused when the
 * `text` aspect is locked against the calling agent (02.4 D-01, D-03, D-08).
 */
export const RenameNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
    title: z.string().min(1).max(200),
  })
  .strict()

/**
 * delete_note: refused when the note's `delete` aspect is locked against the
 * calling agent (02.4 D-02). See commands/locks.ts.
 */
export const DeleteNoteArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
  })
  .strict()

/**
 * One end of a connection, named by tree and note.
 *
 * Endpoints are tree-qualified even though both must currently be in the same
 * tree, so Plan 15 can allow cross-tree links (D-16) without changing the
 * shape an agent has already learned.
 */
const ConnectionEndpointArgs = z
  .object({
    tree: z.string().min(1).max(200),
    note: z.string().min(1).max(1024),
  })
  .strict()

/** connect_notes: connecting stays unrestricted (02.4 D-01); any notes may be joined. */
export const ConnectNotesArgs = z
  .object({
    from: ConnectionEndpointArgs,
    to: ConnectionEndpointArgs,
    label: z.string().min(1).max(80).optional(),
  })
  .strict()

// Workspace file tools (02.7 D-07, D-08)
const WorkspaceRef = z.string().min(1).max(200)
const WorkspacePath = z.string().min(1).max(4096)

export const ReadFileArgs = z
  .object({
    workspace: WorkspaceRef.optional(),
    path: WorkspacePath,
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
  })
  .strict()

export const EditFileArgs = z
  .object({
    workspace: WorkspaceRef.optional(),
    path: WorkspacePath,
    old_string: z.string().min(1).max(4194304),
    new_string: z.string().max(4194304),
    replace_all: z.boolean().optional(),
  })
  .strict()

export const ListFilesArgs = z
  .object({
    workspace: WorkspaceRef.optional(),
    path: z.string().min(0).max(4096).optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .strict()

export const WriteFileArgs = z
  .object({
    workspace: WorkspaceRef.optional(),
    path: WorkspacePath,
    text: z.string().max(4194304),
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
    name: 'list_trees',
    title: 'List the trees open in Tapestry',
    description: 'Lists the trees currently open in Tapestry, with the name to pass as `tree`.',
    schema: ListTreesArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_notes',
    title: 'Search notes by title and text',
    description:
      'Searches note titles and text for a case-insensitive substring, across every open tree or one named tree. You may search any note, including notes you did not create.',
    schema: SearchNotesArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_note',
    title: 'Read a note with its author and connections',
    description:
      'Reads a note: its title, text, the actor that created it, and the notes it connects to. You may read any note, including notes you did not create.',
    schema: ReadNoteArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'look',
    title: 'Look at the notes around a note',
    description:
      'Lists the notes around a note in the same tree, nearest first, as relations: near, beyond, overlapping, contains or contained-by. Pass toward to keep only the notes that lie toward another note. It never returns coordinates. Relations use each note\'s saved size, or a default size when none is saved, so a card whose text made it taller than that can overlap on screen while look reports it clear.',
    schema: LookArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'place',
    title: 'Move a note next to another note',
    description:
      'Moves a note near another note, or beyond one note as seen from another; the host works out the exact spot. Placing a note near the note it grew from makes it follow that note until a person moves it; every other placement stays where it is put. A note whose layout is locked is refused, the refusal names who holds the lock, and nothing is written. Placement uses saved note sizes, or a default when none is saved, so a card whose text made it taller can overlap on screen.',
    schema: PlaceArgs,
    annotations: {},
  },
  {
    name: 'create_note',
    title: 'Create a note grown from an existing note',
    description:
      'Creates a note connected to grewFrom. Every new note must grow from an existing note; loose notes are refused. Pass where to choose the spot: near a note, or beyond one note as seen from another. A note placed near the note it grew from follows that note until a person moves it. Without where, the note goes to the right of grewFrom.',
    schema: CreateNoteArgs,
    annotations: {},
  },
  {
    name: 'update_note',
    title: 'Replace the text of a note',
    description:
      'Replaces a note\'s text. Refused, and nothing is written, when the note\'s text is locked against you; the error names the lock\'s owner. Notes created by the user, by the Obsidian bridge or by another plugin start with their text locked.',
    schema: UpdateNoteArgs,
    annotations: { destructiveHint: false },
  },
  {
    name: 'rename_note',
    title: 'Retitle a note',
    description:
      'Changes a note\'s title. A title is part of the note\'s text, so renaming is refused, and nothing is written, when the note\'s text is locked against you; the error names the lock\'s owner.',
    schema: RenameNoteArgs,
    annotations: {},
  },
  {
    name: 'delete_note',
    title: 'Delete a note',
    description:
      'Deletes a note and its connections. Refused, and nothing is written, when the note\'s deletion is locked against you; the error names the lock\'s owner. The note stays in the tree\'s history either way.',
    schema: DeleteNoteArgs,
    annotations: { destructiveHint: true },
  },
  {
    name: 'connect_notes',
    title: 'Connect two notes',
    description:
      'Connects two notes in the same tree, optionally with a short label. Connections may join any notes, including notes you did not create.',
    schema: ConnectNotesArgs,
    annotations: {},
  },
  {
    name: 'list_files',
    title: 'List the files in a workspace',
    description:
      "Lists the files a workspace folder open in Tapestry shows in its window (git's view of the folder), optionally only those under one folder `path`. Each file comes with its size in bytes, whether it is text, and the note that shows it. It never lists .git or files ignored by git. `limit` caps the list (default 1000); `truncated` says whether more files exist.",
    schema: ListFilesArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_file',
    title: 'Read a file in a workspace',
    description:
      'Reads a text file in a workspace folder open in Tapestry. `path` is relative to the workspace root, or an absolute path inside it; `workspace` may be left out when one workspace is open or the path is absolute. Returns the exact text, the line count and the note that shows the file. Use `offset` (first line, from 1) and `limit` (lines) to page long files. Paths that leave the workspace, pass through a symbolic link, point into .git or are ignored by git are refused.',
    schema: ReadFileArgs,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'edit_file',
    title: 'Replace an exact string in a workspace file',
    description:
      "Replaces `old_string` with `new_string` in a text file in a workspace folder open in Tapestry. The file is saved to disk at once and the workspace's tree records the change as yours. `old_string` must match exactly, including whitespace and line endings, and must occur once unless `replace_all` is true. Paths follow the same rules as read_file. A refusal writes nothing.",
    schema: EditFileArgs,
    annotations: { destructiveHint: false },
  },
  {
    name: 'write_file',
    title: 'Create or replace a text file in a workspace',
    description:
      "Creates a text file (and any missing folders) in a workspace folder open in Tapestry, or replaces a text file's whole text. The file is saved to disk at once and the workspace's tree records the change as yours. Paths follow the same rules as read_file. It is refused, with nothing written, for paths outside the workspace, symbolic links, .git, paths ignored by git and non-text files. Writing the text a file already has changes nothing.",
    schema: WriteFileArgs,
    annotations: { destructiveHint: true },
  },
])
