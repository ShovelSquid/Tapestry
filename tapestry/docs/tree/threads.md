# `thread.log`: the readable grammar inside a time thread

A **thread** is a node whose `thread.log` property carries the whole typed
history of one growing document (D-01, D-06): every letter typed and deleted,
each with the moment it happened, readable in a text editor with no help from
Tapestry. This guide is for that reader. It assumes you have already read
[FORMAT.md](FORMAT.md) — a `thread.log` value is an ordinary `set … text`
line like any other; this file only explains what is written *inside* the
block.

This is the same file `example.tree`'s commits 7-10 use. Read
[FORMAT.md § Plugin data with its own readable grammar](FORMAT.md#plugin-data-with-its-own-readable-grammar)
for those commits walked through line by line; this file is the complete
grammar reference for every verb a `thread.log` block can contain.

## The two rules a reader most needs

Before anything else, two rules that are easy to get backwards:

1. **The author of every line in a block is the enclosing commit's `actor`
   line.** There is no author field anywhere inside `thread.log` — not on the
   header, not on a record line. A block never mixes authors: when a second
   author's steps arrive, the thread writer commits whatever the first author
   left pending before joining the second author's steps into a new block.
   So "who wrote this letter" is answered the same way "who wrote this note"
   is answered anywhere else in a `.tree` file: read the `actor` line of the
   commit the `set … thread.log …` line appears in.

2. **Replay order is commit order, then line order within a commit. Position
   on a line is recorded time, and nothing more.** A reader rebuilds the
   document by reading `thread.log` values in the order their commits appear
   in the file, and within one block, top to bottom. This is *not* the same
   as sorting every record ever written by its `+<offset>` time. After a
   rebase, a person's steps can land in a commit that comes after another
   author's commit while still carrying earlier offsets than that commit's
   own records — because the person typed them before the rebase, but they
   were only written down afterward. Replaying in commit order (not time
   order) is what makes the document reconstruct correctly in that case; if
   you see two commits whose records' clock-times overlap or run backwards
   across the commit boundary, that is expected, not damage.

## What a thread record block is

A thread's document is not stored as its own text (except at checkpoints,
below). It is stored as a sequence of **batches**: each batch is one
`set <node> thread.log text <<TEXT` line, and the value is a small,
versioned, line-oriented grammar that says exactly what was typed, pasted,
undone, deleted, formatted or linked, and precisely when, in milliseconds
since the batch began.

A batch looks like this (this is commit 8 of `example.tree`, verbatim):

```text
thread 1 v0
at 2026-09-08T21:23:07.000Z
+0.000 in 1
+0.000 ins 1 "H"
+0.182 ins 2 "i"
+0.950 paste ins 3 " Sam!"
+2.300 undo del 3 8 " Sam!"
```

### The two header lines

Every batch starts with exactly two lines, in this order:

```text
thread <grammar-version> v<version-before>
at <RFC 3339 UTC, exactly 3 fraction digits, Z suffix>
```

- `<grammar-version>` is the version of *this* grammar the batch was written
  in — `1` for everything this file documents. A reader that does not
  recognize the grammar version stops rather than guessing at a shape it does
  not know; a thread whose `thread.log` cannot be parsed becomes read-only
  (its last checkpoint stays on screen) rather than silently misread.
- `<version-before>` is a plain integer: how many recorded steps (every
  record below except `in` and `out`) had already happened to this document
  before this batch's first record. It lets a reader check that no batch is
  missing between two commits — if the running total of steps does not equal
  the next batch's `<version-before>`, a batch was lost or reordered, and
  that is corruption, not something to paper over.
- `at <timestamp>` is the wall-clock instant every `+<offset>` line in *this*
  batch is measured from. Every batch has its own anchor; offsets never carry
  across batches.

### The offset form

Every record line after the header starts with `+<seconds>.<3-digit-millis>`,
a space, then the record. For example `+2.300` is 2300 ms after the batch's
`at` timestamp. This is always an **integer number of milliseconds**,
written as a fixed 3-digit fraction — never a float, and never negative: a
wall clock that runs backwards (system clock adjustment, sleep/wake) clamps
to `+0.000` rather than writing a negative offset.

A record's absolute time is `at + offset`. Two lines in the same batch can
share an offset; nothing requires them to differ.

## Every verb

One record is one line (an oversized record instead spans a `cont`-continued
run of lines — see below). An optional **cause token** may appear between
the offset and the verb; no cause token means the record is ordinary typing.

| Cause token | Meaning |
|---|---|
| `paste` | Landed as a paste (D-05): a tight cluster at one moment, never spread out to look typed |
| `drop` | A drag-and-drop insertion |
| `cut` | Text removed by Cut |
| `undo` | An ordinary undo (D-04): looks like a ordinary deletion on the line, but tagged so a reader knows why the letters faded |
| `redo` | An ordinary redo |
| `ime` | Composed input-method text, recorded as one cluster at the moment composition ended |
| `format` | A formatting-toolbar action, not a text change |
| `link` | A passage-link action |
| `enter` | A paragraph break |
| `observed` | Text that arrived outside Tapestry's own typer (for example, an edit made directly to a vault file) and is being recorded after the fact |

### `in <session#>` — a session begins

```text
+0.000 in 1
```

The start of session number `<session#>` (D-07). A session runs from this
`in` to the next `out` (or to the end of the file, if the thread was never
closed cleanly). Session numbers count up from 1 for the life of the thread
and are never reused. `in` never carries a cause token.

### `out` — a session ends

```text
+154.000 out
```

The session that began with the batch's most recent `in` has timed out
(D-10) or the typer was closed. `out` is written only when a time-out or
close was actually observed — never guessed at afterward — so its absence at
the end of a file (for instance, after a crash) means exactly that: the
session's end was never recorded, and a reader treats the thread as having
been interrupted mid-session rather than inferring a time it cannot know.
`out` never carries a cause token.

### `ins <pos> "<text>" [mark…]` — an insertion

```text
+0.000 ins 1 "H"
+0.182 format ins 6 "strong text" strong
```

Inserts `<text>` at document position `<pos>`. This form is used only when
the underlying edit is a single flat run of plain text with no more than the
listed attribute-less marks (`strong`, `em`, and similar toggle marks with no
attributes of their own) — anything richer (a structural change, an
attributed mark like a link or a text colour) is written as `step` instead
(below), never forced into this shorter form. `<text>` uses the escape set
below; each grapheme cluster in it becomes one addressable letter on the line
in insertion order, for D-03's fading and D-21's per-letter authorship.

### `del <from> <to> "<deleted text>"` — a deletion

```text
+2.300 undo del 3 8 " Sam!"
```

Removes the document range `[<from>, <to>)`, and always quotes exactly what
was there before the removal, taken from the document immediately
before the step — never re-derived afterward, so what you read on this line
is what disappeared, verbatim. Nothing is ever erased from the *line*: a
`del` record marks its letters as gone at this moment, but they stay on the
recorded history forever (D-03), which is why the deleted text is spelled
out rather than left to be inferred.

### `mark+ <mark> <from> <to>` / `mark- <mark> <from> <to>` — a toggle mark

```text
+0.400 format mark+ strong 4 9
```

Adds (`mark+`) or removes (`mark-`) an attribute-less mark (`strong`, `em`,
and similar) over `[<from>, <to>)`, without changing the text itself. A mark
with attributes (a link's target, a text colour) is not expressible here and
is written as `step`.

### `step <exact Step JSON> "<readable text>"` — everything else

```text
+4.000 enter step {"stepType":"replace","from":26,"to":26,"slice":{"content":[{"type":"paragraph"},{"type":"paragraph"}],"openStart":1,"openEnd":1},"structure":true} ""
```

The escape hatch for anything `ins`/`del`/`mark+`/`mark-` cannot say exactly:
structural changes (splitting or joining paragraphs), an attributed mark
(a link, a text colour), or a replace that both inserts and deletes at once.
`<exact Step JSON>` is a compact JSON object with no embedded raw line break,
sufficient to replay the edit exactly; `<readable text>` is always present
too — the plain text the step touched (inserted, or deleted, whichever
applies) — so a human reading the file is never left staring at bare JSON
with no idea what it did to the words.

### `marker <ref>` — a link marker

```text
+3.100 link marker e12
```

Drops a marker onto the line at this moment, pointing at edge `<ref>` (D-02):
the moment a passage link was made from inside the thread's document. This
is metadata about the line, not a text change.

### `cont "<chunk>"` — a continuation line

```text
+0.000 ins 15 "the first 100,000 code points of a very large paste…"
cont "…the rest of that same paste, continued verbatim…"
```

Not a record of its own kind: a `cont` line extends the quoted text field of
the record directly above it (only `ins`, `del` and `step` carry one). A
single insertion, deletion or step whose encoded line would exceed the
kernel's 1 MiB line limit is split into a first line plus one or more `cont`
lines, each carrying the next chunk of the same text; trailing fields that
belong to the whole record (an `ins` record's marks) appear once, after the
very last chunk. A reader folds every `cont` line back onto the record it
continues before treating it as one record; `cont` is never a record on its
own and is never continued itself except by more `cont` lines for the same
original record.

## String escaping

Every quoted string inside a `thread.log` block — `ins`'s inserted text,
`del`'s deleted text, `step`'s readable text and `cont`'s chunk — uses
exactly FORMAT.md's inline text escapes: `"` and `\` become `\"` and `\\`; a
line feed, tab and carriage return become `\n`, `\t` and `\r`; any other byte
below `0x20` becomes `\u00XX`. Every other byte, including all non-ASCII
UTF-8, is written raw. This is what makes it impossible for pasted text to
forge a new record line, a new `@commit`, or the block's own `TEXT`
delimiter: a raw line feed can never appear inside a quoted field, so
whatever a person pastes into a thread can never be read back as anything
other than the text it was.

## What a reader who only has FORMAT.md would see

A reader who has never seen this file still sees a valid, well-formed
`.tree` file: `thread.log` is an ordinary `set <node> thread.log text <<TEXT`
line like any other block-valued property (FORMAT.md § Value types), owned
by a plugin the kernel has never heard of, exactly the way `example.tree`'s
commit 2 introduces `example.people/person@2` without the kernel
understanding it. Nothing about `thread.log`'s *outer* shape depends on this
file — only the meaning of what is written *inside* the block does, which is
this document's job to explain. A thread's `body` property (below) stays
readable as plain text with no grammar at all, precisely so a reader without
this file can still read the document itself, even if the keystroke history
inside `thread.log` means nothing to them.

## The `body` checkpoint

Alongside `thread.log`, a thread periodically writes a plain `set <node>
body text …` line: the document's full text, exactly as `tapestry.notes/
note@1` (an ordinary note) would store it, with no grammar and no escaping
beyond FORMAT.md's own inline-text rules. This is the checkpoint: a plugin
that does not understand `thread.log` at all — or a person who has disabled
the plugin — can still open the node and read its current document, verbatim
(PLUG-04). The document at any past moment is the last `body` checkpoint at
or before that moment, plus every record after it replayed up to that time
(D-08); reading a checkpoint alone tells you the document as of the most
recent one, without needing to replay anything.

## Why not an `x-` extension line

FORMAT.md is explicit that a line starting `x-` is "kept exactly as written…
and never interpreted… for plugins and future versions of Tapestry to leave
readable notes that this version does not need to understand." A thread's
history is the opposite of a note this version does not need to understand
— it is the whole point of the feature, and every version of Tapestry that
knows about threads needs to replay it exactly. `thread.log` is therefore an
ordinary `set` line with a `text` value, composed entirely from the seven
verbs and six value types every plugin shares, never a verb or extension
line of its own — see
[FORMAT.md § Plugin data with its own readable grammar](FORMAT.md#plugin-data-with-its-own-readable-grammar)
for the fuller version of this argument.

## Grammar summary

```text
<block>      ::= <header> <record-line>*
<header>     ::= "thread " <version> " v" <version-before> "\n"
                 "at " <rfc3339-3-fraction-digits> "\n"
<record-line>::= <offset> " " (<cause> " ")? <record> | "cont " <quoted>
<offset>     ::= "+" <digits> "." <digit><digit><digit>
<cause>      ::= "paste" | "drop" | "cut" | "undo" | "redo"
               | "ime" | "format" | "link" | "enter" | "observed"
<record>     ::= "in " <int>
               | "out"
               | "ins " <int> " " <quoted> (" " <mark>)*
               | "del " <int> " " <int> " " <quoted>
               | ("mark+" | "mark-") " " <mark> " " <int> " " <int>
               | "step " <json> " " <quoted>
               | "marker " <ref>
<quoted>     ::= FORMAT.md inline-text escaping, always double-quoted
```

This is a one-way door (D-06): the shape documented here is what every saved
thread keeps forever. `app/src/shared/threads/grammar.ts` is the pure
TypeScript implementation this document describes (`formatBlock` writes it,
`parseBlock` reads it), and `example.tree`'s commits 7-10 are its golden,
byte-frozen example.
