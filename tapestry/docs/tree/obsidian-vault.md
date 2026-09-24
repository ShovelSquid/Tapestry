# An Obsidian vault as a tree

A reader's guide to what Tapestry writes when it mirrors an Obsidian vault.

This describes **records**, not a format. Everything here is ordinary `.tree`
v1: the node types are namespaced tokens, the property keys match the key
grammar, and the verbs are the same `create-node`, `set`, `create-edge` and
`delete-node` any other tree uses. [FORMAT.md](FORMAT.md) and `example.tree`
are unchanged by the vault bridge, and nothing in this document asks you to
learn a new syntax.

## Where the tree lives

```
~/House Party/                  the vault folder
├── House Party.tree            its history (D-13)
├── House Party.signin.log      which agent signed in when (D-09)
├── Welcome.md
└── Characters/
    └── Rune.md
```

The tree sits **inside** the vault folder, so the vault and its history travel
together: copy the folder to another machine and the record comes with it.

The tree is named after the folder. The header's `world` line needs a single
token and a token holds no space, so `House Party` is written
`world House_Party` while the frame keeps the folder's real name. The token is
an identifier; the name is what a person reads.

## The one rule

One rule decides where every key belongs: every key starting `md.` is the
file's, and everything else is Tapestry's.

> **Every key starting `md.` is what the source file says, or is derived from
> it. Every other key is Tapestry's.**

`md.text` is the file's bytes. `position.x` is where you dragged the card.
That is the whole legend. Reading a `.tree` file, you can always tell which
half of a note came from the vault and which half Tapestry added — and nothing
under `md.` is ever Tapestry's opinion.

This is why a connection's short label is `tapestry.label` and not `md.label`:
the file said a whole sentence, and a shorter phrase is yours, not the file's.

## The four node types

### `obsidian.vault/note@1` — one `.md` file

| Key | Meaning |
|-----|---------|
| `md.path` | Vault-relative path with `/` separators, e.g. `Characters/Rune.md` |
| `md.text` | The file's text, byte for byte (D-12) |
| `md.sha256` | Hash of those bytes — how a change is noticed |
| `md.tags` | The literal `#tag` tokens, space-separated, in file order (D-33) |
| `md.frontmatter` | The raw YAML block, verbatim, when the file opens with one |
| `md.fm.<key>` | One derived key per frontmatter key (D-33) |
| `position.x`, `position.y`, `width` | Tapestry's |

```
create-node n4 obsidian.vault/note@1
set n4 md.path text "Welcome.md"
set n4 md.sha256 text "9f2c…"
set n4 md.tags text "#sample"
set n4 md.frontmatter text <<TEXT
title: Welcome
written by: the sample
TEXT
set n4 md.fm.title text "Welcome"
set n4 md.text text <<TEXT
---
title: Welcome
written by: the sample
---
Best friends with [[Rune]]
TEXT
set n4 position.x real 0
set n4 position.y real 0
```

Two details worth knowing:

- **`md.fm.written by` does not exist.** A property key may not contain a
  space, and renaming the key to `written_by` would record something the file
  never said. Keys that are not already legal keep their value in
  `md.frontmatter` only.
- **`md.text` is the file, including its CR bytes and its missing final
  newline.** The block form does not add one.

### `obsidian.vault/folder@1` — a folder, drawn as a group

Carries `md.path` (`Characters`) and Tapestry's group position. Folders become
labeled groups inside the vault's frame (D-26).

### `obsidian.vault/file@1` — everything that is not readable Markdown

Images, PDFs, `.canvas` files — and any `.md` Tapestry could not read (D-29).

| Key | Meaning |
|-----|---------|
| `md.path`, `md.ext`, `md.bytes` | Where it is, its extension without the dot, its size |
| `md.sha256` | Hash of its bytes, when it was small enough to read |
| `md.unreadable` | Why it is a file note rather than a note, in words |

```
create-node n9 obsidian.vault/file@1
set n9 md.path text "map.png"
set n9 md.ext text "png"
set n9 md.bytes int 8
set n9 md.sha256 text "6b7f…"
```

**The bytes are never copied into the tree.** A file note is a description and
a pointer, so a vault full of images does not turn its history into a binary
blob.

#### Unreadable files

A `.md` file becomes a file note, carrying `md.unreadable`, when it is not
valid UTF-8, contains a NUL byte, has a line longer than 1 MiB, or is larger
than 16 MiB. A symlink is recorded as `symbolic link not followed` and is
never opened.

```
set n11 md.unreadable text "is not valid UTF-8"
```

Every one of those refusals mirrors a limit the kernel itself enforces, so a
file that decodes is a file that will commit. Nothing is ever transcoded to
fit: bytes repaired to fit would then be recorded as what the file "says", and
they are not.

### `obsidian.vault/placeholder@1` — a link to a note that does not exist yet

```
create-node n12 obsidian.vault/placeholder@1
set n12 md.link text "create a link"
```

| Key | Meaning |
|-----|---------|
| `md.link` | The link text, exactly as written |
| `md.ambiguous` | `true` when the link matches several notes |

Two different situations produce one of these:

- **Nothing matches.** `[[create a link]]` in `Welcome.md` has no file, so it
  shows as a faint placeholder joined to the note that links to it. Typing in
  it creates the `.md` file, and the note then appears in the placeholder's
  position rather than jumping somewhere else (D-34).
- **Several match.** Two notes named `dup.md` in different folders make
  `[[dup]]` ambiguous. Obsidian's own tie-break is undocumented, so Tapestry
  refuses to choose: the placeholder says so, and **it is connected to
  neither candidate**. Write the folder path in the link
  (`[[Concepts/dup]]`) to resolve it.

## Connections

A `[[link]]` becomes an edge, and its label is the **whole literal line the
link sits in** (D-31):

```
create-edge e1 n4 n7 wikilink
set e1 md.line text "Best friends with [[Rune]]"
set e1 md.occurrence int 0
```

`md.line` is the sentence because that is what the file contains. House Party
writes its relationships as sentences, and extracting "best friends" from one
would be Tapestry inventing a claim. If you want a shorter phrase, Tapestry
stores yours separately:

```
set e1 tapestry.label text "best friends"
```

`md.occurrence` tells apart two links to the same note on the same line.

Note that the edge **label** is one token — `create-edge` refuses anything
else — which is precisely why the sentence lives on `md.line` and could never
have been the label itself.

| Label | Meaning |
|-------|---------|
| `wikilink` | `[[Rune]]` |
| `embed` | `![[map.png]]` — points at the file note (D-29) |
| `grew-from` | A note grown from another by an agent (D-04) or copied between trees (D-17). Tapestry's own, not the vault's |

An edge keeps its identity across catch-ups as long as its source, label,
target, line and occurrence still match — which is what lets a `tapestry.label`
you set survive every later reading of the vault.

## Who wrote each change

Every commit carries one actor line, and the vault tree uses three:

| Actor | Means |
|-------|-------|
| `plugin obsidian.bridge` | Tapestry observed this change in the files. **The author is genuinely unknown** — it could be you in Obsidian, an agent editing files directly, or a sync from another device. The record says what it saw, and does not guess (D-21) |
| `human user.<name>` | You, editing in Tapestry |
| `plugin agent.<name>` | A connected agent, through the Tapestry bridge (D-09) |

A commit reading `observed change to Characters/Rune.md` under
`actor plugin obsidian.bridge` means exactly that: the file is different now,
and Tapestry is recording the difference rather than claiming authorship.

The sign-in log beside the tree (`<vault name>.signin.log`) records which
agent connected and when; its format is documented in the section Plan 12 adds
to this guide.

## If you use Obsidian Sync

Exclude `*.tree` and `*.signin.log` in Sync settings.

The tree is an append-only chain, and two devices appending to the same chain
fork it. Tapestry warns about this when you add a vault whose
`.obsidian/core-plugins.json` has Sync enabled, and it refuses to open a vault
tree whose journal is not intact rather than trying to repair it — an
automatic repair of a forked history is a guess about which half was real.

## What the bridge never touches

Reading a vault changes nothing in it. Beyond that, these paths are ignored
entirely: every dot-path (`.obsidian`, `.trash`, dotfiles), the tree file and
the sign-in log themselves, and the temporary files an atomic write leaves
behind. Mirroring Tapestry's own record would be recording the record.

## See also

- [FORMAT.md](FORMAT.md) — the `.tree` format itself, unchanged by any of this.
