/**
 * The record shapes a vault tree is written in (D-10, D-14).
 *
 * One rule decides where every key belongs, and it is the rule that makes a
 * vault tree an honest record rather than an interpretation:
 *
 *   **Every key starting `md.` is what the file says, or is derived from it.
 *   Every other key is Tapestry's.**
 *
 * `md.text` is the file's bytes; `position.x` is where Kaelen dragged the card.
 * A reader of the `.tree` file can therefore tell, without Tapestry and without
 * a legend, which half of a note came from the vault and which half Tapestry
 * added — and nothing under `md.` is ever Tapestry's own opinion.
 *
 * No `.tree` format change is involved. Node types are tokens and property
 * keys match `[A-Za-z_][A-Za-z0-9_.:-]*` (FORMAT.md "Keys and tokens"), so
 * every name here is already legal v1.
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

/** One `.md` file (D-30). Holds that file's exact text in `md.text` (D-12). */
export const VAULT_NOTE_TYPE = 'obsidian.vault/note@1'

/** A folder in the vault, drawn as a labeled group (D-26). */
export const VAULT_FOLDER_TYPE = 'obsidian.vault/folder@1'

/**
 * A non-Markdown file, and any `.md` Tapestry could not decode (D-29).
 * The bytes are never copied into the tree — only a readable description.
 */
export const VAULT_FILE_TYPE = 'obsidian.vault/file@1'

/** A `[[link]]` whose file does not exist yet (D-34). */
export const VAULT_PLACEHOLDER_TYPE = 'obsidian.vault/placeholder@1'

// ---------------------------------------------------------------------------
// Mirrored keys — what the file says
// ---------------------------------------------------------------------------

/** Vault-relative path with `/` separators: `Characters/Rune.md`. */
export const MD_PATH = 'md.path'

/** The file's text, byte for byte (D-12). */
export const MD_TEXT = 'md.text'

/** Lowercase hex SHA-256 of the file's bytes — how a change is detected. */
export const MD_SHA256 = 'md.sha256'

/** The literal `#tag` tokens, space-separated, in file order (D-33). */
export const MD_TAGS = 'md.tags'

/** The raw YAML frontmatter block, verbatim, when the file opens with one. */
export const MD_FRONTMATTER = 'md.frontmatter'

/** Prefix for one derived frontmatter key: `md.fm.title` (D-33). */
export const MD_FM_PREFIX = 'md.fm.'

/** A non-Markdown file's extension without the dot: `png`. */
export const MD_EXT = 'md.ext'

/** A non-Markdown file's size in bytes. */
export const MD_BYTES = 'md.bytes'

/** Why a file could not be read as Markdown, in words, never as silence. */
export const MD_UNREADABLE = 'md.unreadable'

/** A placeholder's link text, exactly as written: `create a link`. */
export const MD_LINK = 'md.link'

/** Set on a link whose basename matches several notes (D-34, Plan 08). */
export const MD_AMBIGUOUS = 'md.ambiguous'

/** The whole literal line a `[[link]]` sits in (D-31). */
export const MD_LINE = 'md.line'

/** Index among identical target-and-line pairs, so repeats stay distinct. */
export const MD_OCCURRENCE = 'md.occurrence'

// ---------------------------------------------------------------------------
// Tapestry's own keys
// ---------------------------------------------------------------------------

/**
 * Kaelen's own short label for a connection (D-14).
 *
 * Deliberately not under `md.`: the file says the whole line, and a shorter
 * phrase is Tapestry's addition, never something the vault claimed.
 */
export const TAPESTRY_LABEL = 'tapestry.label'

// ---------------------------------------------------------------------------
// Edge labels
// ---------------------------------------------------------------------------

/**
 * An edge label must be one token (`World.cpp` refuses anything else), so the
 * sentence around a link can never be the label itself — it lives on `md.line`.
 */
export const WIKILINK_LABEL = 'wikilink'

/** `![[map.png]]` — an embed rather than a plain link. */
export const EMBED_LABEL = 'embed'
