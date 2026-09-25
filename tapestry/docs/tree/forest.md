# The Tapestry tree and the forest

A reader's guide to what Tapestry writes when it arranges your trees.

This describes **records**, not a format. Every line in both files is ordinary
`.tree` format version 1: the node types and edge labels are tokens, the
property keys match the key grammar, and the verbs are the same
`create-node`, `set`, `create-edge` and `delete-node` any other tree uses.
[FORMAT.md](FORMAT.md) is unchanged by the forest, and nothing here asks you
to learn a new syntax. For the grammar of names see
[Keys and tokens](FORMAT.md#keys-and-tokens); for `text` and `real` see
[Value types](FORMAT.md#value-types); for `n1` and `e1` see
[Identifiers](FORMAT.md#identifiers).

Two files do two jobs:

- **`Forest.tree`** records which trees are in your space and where each
  one's frame sits.
- **`Tapestry.tree`** is the tree Tapestry always opens first. In this
  version its only job is to say which forest is yours.

## 1. Where the files live

```
~/Documents/Tapestry/          the space folder
├── Tapestry.tree              world Tapestry: names the forest
└── Forest.tree                world Forest: your trees and their frames

~/Library/Application Support/@tapestry/app/
└── settings.json              "tapestry": { "path": ".../Tapestry.tree" }
```

Both files sit beside each other in your Documents folder, so you can open
them in any text editor. Neither is hidden with the app's settings.

`settings.json` holds one pointer, under the key `tapestry`, with the
absolute path of `Tapestry.tree` and nothing else. That pointer is the only
thing Tapestry needs to find your space. Section 7 says what else happened to
`settings.json`.

Each file's header names its world with a single token: `world Tapestry` and
`world Forest`. A token holds no space, so these names are plain words.

## 2. The Tapestry tree

`Tapestry.tree` holds three things, created in one commit:

| Record | Name | What it carries |
|---|---|---|
| Root node | `tapestry.home/tapestry@1` | `title` (`text`), `"Tapestry"` |
| Forest reference node | `tapestry.home/forest@1` | `digest` (`text`): the forest's identity. `path.hint` (`text`): where the forest was last seen. `title` (`text`), `"Forest"` |
| Edge from root to reference | label `forest` | nothing |

```
create-node n1 tapestry.home/tapestry@1
set n1 title text "Tapestry"
create-node n2 tapestry.home/forest@1
set n2 digest text "sha256:541d..."
set n2 path.hint text "/Users/you/Documents/Tapestry/Forest.tree"
set n2 title text "Forest"
create-edge e1 n1 n2 forest
```

**The root node is the one stable place for settings that apply to the whole
space.** A later phase hangs lock settings on it. If a file somehow holds
more than one root node, the one with the lowest id counts.

**Why the reference is text and not a `ref`.** A `ref` value must name a
node or edge in the same file (see [Value types](FORMAT.md#value-types)), and
the forest is a different file. So the Tapestry tree names the forest the way
a person would: by its identity (`digest`) and by where it was last seen
(`path.hint`). The reference is one-sided. The forest does not name its
Tapestry tree back.

## 3. The forest

`Forest.tree` holds one **space node**, one **stand-in** per tree in the
space, and one **`placement` edge** per frame, from the space node to the
stand-in.

### The space node: `tapestry.spaces/space@1`

| Key | Type | Value |
|---|---|---|
| `kind` | `text` | `"canvas"`: a hint to the renderer, nothing more |
| `title` | `text` | `"Forest"` |

The type is deliberately generic. A space is something things are placed in,
and later boards can reuse it.

### A stand-in: `tapestry.forest/member@1`

One per tree in the space. It stands in for the tree without copying any of
it.

| Key | Type | Meaning |
|---|---|---|
| `kind` | `text` | `"native"` for a Tapestry world, `"vault"` for the mirror of an Obsidian vault |
| `path.hint` | `text` | The absolute path where the tree's `.tree` file was last seen |
| `vault.root.hint` | `text` | Vault members only: the vault folder it mirrors |
| `digest` | `text` | The tree's identity, `sha256:` of its header record. Written the first time the tree opens (section 4) |

Paths are written in full, exactly as the file system gave them.

### A frame: the `placement` edge

A frame is not a node. It is a `placement` edge from the space node to a
stand-in, and it carries where the frame's top-left corner sits:

| Key | Type | Meaning |
|---|---|---|
| `origin.x` | `real` | Distance east (screen right) |
| `origin.y` | `real` | Distance south (screen down) |

Both are always `real`, even when the number is whole: `set e3 origin.x real 800`.

**Keys that are not written, and what they mean when absent.** A placement
can in principle say more, and a later phase will write these when frames
leave the flat canvas. Until then they are simply missing, and a reader
should take their defaults:

| Key | Default | Meaning of the default |
|---|---|---|
| `origin.z` | `0` | On the ground plane. z is up, toward a viewer looking down |
| `direction.x`, `direction.y`, `direction.z` | `0 0 -1` | Facing straight down into the page, square-on |
| `roll` | `0` | Not turned |

Together these defaults are the identity placement: x east, y south, and
nothing tilted, which is exactly how today's canvas is drawn.

**A frame's size is not written.** A frame's width and height are computed
from the notes inside it every time it is drawn, so `size.w` and `size.h`
never appear on a frame's placement. Only where the frame sits is yours to
record.

## 4. A tree is its digest

A stand-in is identified by its `digest`, not by its path. The digest is the
tree's identity; the path is only a hint about where to look.

- **A moved file keeps its frame.** If you rename or move a tree's file,
  Tapestry lists it as can't-be-found at its old path. When you add it again
  from its new place, Tapestry sees the same digest and rewrites that
  stand-in's `path.hint` rather than creating a new one. The frame stays
  where it was.
- **A copy of an open world is refused.** A copy has the same digest as its
  original, so it cannot join the space while the original is there.
- **A different world at a member's path is not adopted.** If some other
  world now sits where a member used to be, it is listed as can't-be-found,
  and nothing is written.
- **The app's temporary name for a tree is never written.** Until a tree has
  been read once, the app knows it by its path. That name lives only in
  memory. On disk a member is always its `path.hint`, plus its `digest` once
  it is known, and the digest is recorded in its own system commit the first
  time the tree opens.
- **Tapestry's own files cannot be added as trees.** Choosing `Forest.tree`
  or `Tapestry.tree`, or a copy of either, is refused with "Forest.tree is
  Tapestry's own arrangement file and can't be added as a tree."

## 5. Who signs what

Every change to the forest and the Tapestry tree is a commit with an actor,
like any other edit. The person signs what the person did. The system signs
what Tapestry did on its own, so no-one appears to have made a change they
did not make.

| What happened | Actor | Message |
|---|---|---|
| First launch copied the arrangement from `settings.json` | `system tapestry` | `import 3 trees and their frames from settings.json` (plus `; skipped 1 unreadable entries` when some entries could not be read) |
| The Tapestry tree was created | `system tapestry` | `create Tapestry tree referencing Forest.tree` |
| You added or created a tree, or added one again from its new path | `human user.<you>` | `add tree "alpha"` |
| You closed a tree | `human user.<you>` | `remove tree "alpha" from the forest` |
| You dragged a frame | `human user.<you>` | `move frame "alpha"`, or `move frame "alpha" and push 2 aside` when it pushed neighbours |
| You undid or redid a drag | `human user.<you>` | `undo move frame "alpha"`, `redo move frame "alpha"` |
| A new frame was nudged clear of its neighbours when first drawn | `system tapestry` | `fit frame "alpha" beside its neighbours` |
| A tree's identity was recorded the first time it opened | `system tapestry` | `record identity of "alpha"` |
| Two stand-ins turned out to be the same world, and one was folded away | `system tapestry` | `forget "alpha" at alpha-copy.tree: it is the same world as "alpha"` |

Closing a tree deletes its stand-in, and with it its `placement` edge. The
file itself and its history are untouched, and the frame's last position
stays in the forest's history.

## 6. Undo

Ctrl+Z after a frame drag puts the frames back. It does this with a **new
commit** that writes the old `origin.x` and `origin.y` again, signed by you,
with the message `undo move frame "..."`. Nothing is rewound, and nothing is
removed from the forest's history: the drag and its undo are both there, in
order. Redo is another new commit.

## 7. What happened to settings.json

Before this version, `settings.json` held a `trees` list: each open tree's
path, kind and frame. On the first launch of this version:

1. The folder `~/Documents/Tapestry/` is created.
2. `Forest.tree` is created in one system commit: the space node, and one
   stand-in and placement per readable `trees` entry, vault entries
   included, at exactly the position stored. If `trees` was empty and an
   older `last-opened.json` named a world that still exists, that world
   becomes the one member, at (0, 0).
3. `Tapestry.tree` is created in one system commit, naming the forest.
4. Only then is the pointer written to `settings.json`, and its `version`
   becomes 2.

If anything fails before step 4, `settings.json` is left exactly as it was,
and the next launch tries again.

**The `trees` list is left exactly as it was, and is never written again.**
It stays in the file as the readable backup the forest was copied from.
Entries that could not be read are left in place too; the import message
counts them.

**An older build** still reads `trees` and shows your trees where they were
at the moment of the upgrade. Moves made since are only in the forest. If an
older build rewrites `settings.json`, it may drop the pointer; the next launch
of this version handles that (case B below).

**What each launch does:**

| Case | What Tapestry finds | What it does |
|---|---|---|
| A | No pointer, no `Tapestry.tree` | The first-launch import above |
| B | No pointer, but a `Tapestry.tree` in the space folder | If it is a Tapestry tree and its forest checks out, the pointer is written again and nothing is imported again. If it is not a Tapestry file, it is left alone and the space stays closed |
| C | No pointer, only a `Forest.tree` | If it is a forest, it is reused as it is, a new `Tapestry.tree` naming it is created, and the pointer is written. Nothing is imported. If it is not a forest, it is left alone and the space stays closed |
| D | A pointer, and both files healthy | Open the Tapestry tree, follow its reference to the forest, check the forest's digest, and put every frame back |
| E | A pointer, but `Tapestry.tree` is missing | Nothing is written or created. The space stays empty until the file is back |
| F | A pointer, but `Tapestry.tree` is damaged | As E, and the window gives the kernel's reason. The file is never repaired |
| G | Either file is held by another Tapestry window | This window leaves the space closed and writes nothing |
| H | The forest at the hinted path has a different digest | Treated as missing. That file is left alone |
| I | `settings.json` has a `version` above 2 | What this build understands is read, everything else is kept on write, and the version is never lowered |
| J | A `trees` entry that cannot be read | Skipped in the import, left in the file, counted in the import message |

Whenever the space does not open, the window says why in a banner that stays
until you dismiss it, and nothing is written.

## 8. What this is not

- **Note positions have not moved.** Where a note sits inside its tree is
  still a property on the note's node, in that tree's own file. Moving notes
  onto `placement` edges is phase 2.7. The forest only places trees.
- **This `placement` is not 2.5's note placement.** When 2.5 speaks of a
  note's placement, it means properties on the note node. The forest's
  `placement` is an edge from a space to a stand-in. The two share a word and
  nothing else.
- **There is one forest.** This version keeps exactly one. Switching between
  several forests is a later phase.
- **Member trees do not record their forest.** Nothing is written into your
  trees' own files to say which forest holds them.

## Example

A forest copied from a real file after a first-launch import, the first open
of two trees, and one drag. Paths have been shortened to `/Users/you/...` and
digests to `sha256:1d26...`, so the byte counts and digests shown no longer
match the text: this is for reading, not for replay. The original paths were
longer than 80 bytes, which is why the path hints use the `<<TEXT` block form
(see [Value types](FORMAT.md#value-types)).

```
@tree 1 42
world Forest
created 2026-09-24T23:15:33Z
@end sha256:541d...
@commit 1 1334
parent sha256:541d...
branch main
recorded 2026-09-24T23:15:33Z
tick 0
actor system tapestry
message "import 3 trees and their frames from settings.json; skipped 1 unreadable entries"
create-node n1 tapestry.spaces/space@1
set n1 kind text "canvas"
set n1 title text "Forest"
create-node n2 tapestry.forest/member@1
set n2 kind text "native"
set n2 path.hint text <<TEXT
/Users/you/Worlds/alpha.tree
TEXT
create-node n3 tapestry.forest/member@1
set n3 kind text "vault"
set n3 path.hint text <<TEXT
/Users/you/Worlds/Vault/Vault.tree
TEXT
set n3 vault.root.hint text <<TEXT
/Users/you/Worlds/Vault
TEXT
create-node n4 tapestry.forest/member@1
set n4 kind text "native"
set n4 path.hint text <<TEXT
/Users/you/Worlds/beta.tree
TEXT
create-edge e1 n1 n2 placement
set e1 origin.x real -245.01090741236075
set e1 origin.y real -65.50898866060388
create-edge e2 n1 n3 placement
set e2 origin.x real 1378.6410165714733
set e2 origin.y real -123.50898866060388
create-edge e3 n1 n4 placement
set e3 origin.x real 800
set e3 origin.y real 12.5
@end sha256:3a1d...
@commit 2 282
parent sha256:3a1d...
branch main
recorded 2026-09-24T23:15:33Z
tick 0
actor system tapestry
message "record identity of \"alpha\""
set n2 digest text "sha256:1d26..."
@end sha256:f394...
@commit 3 281
parent sha256:f394...
branch main
recorded 2026-09-24T23:15:33Z
tick 0
actor system tapestry
message "record identity of \"beta\""
set n4 digest text "sha256:16c8..."
@end sha256:9f6c...
@commit 4 300
parent sha256:9f6c...
branch main
recorded 2026-09-24T23:15:33Z
tick 0
actor human user.kaelen
message "move frame \"alpha\" and push 1 aside"
set e1 origin.x real 40
set e1 origin.y real 12.5
set e3 origin.x real 900
set e3 origin.y real -30
@end sha256:2dd1...
```

Reading it: `n2` and `n4` are two Tapestry worlds and `n3` is a vault. The
vault has no `digest` yet because it has not been opened in this space. Edges
`e1` to `e3` are their frames. The import was the system's; so were the two
identity records, made when each world opened. The drag was Kaelen's: `alpha`
went to (40, 12.5), and `beta`, which it pushed aside, to (900, -30), in one
commit.
