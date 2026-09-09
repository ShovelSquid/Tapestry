# The `.tree` file, version 1

A `.tree` file is the whole history of one Tapestry world, written so that a
person can read it without Tapestry. This guide is for that person. It walks
through `example.tree` (the file next to this one) record by record, then
states every rule the writer follows and every check the reader makes, so
you can read any v1 file cold and know exactly what you are looking at.

## What a .tree file is

A `.tree` file is an append-only journal. Every change to the world is one
record, added at the end of the file. Nothing already in the file is ever
rewritten: a correction is a new record that says what changed, and the old
value stays where it was, in the record that first recorded it.

The file is plain UTF-8 text with LF line endings. There is no compression,
no encryption, no binary section and no index. Open it in any text editor.
Everything the world means — the content of every node, the relationships
between nodes, who changed what and when, and how each record follows the
one before it — is on lines you can read.

Records come in two kinds:

- the **header record** (`@tree` … `@end`), once, at the very start of the
  file: the world's name and when it was created;
- **commit records** (`@commit` … `@end`), one per change, in the order they
  were made.

Each record is sealed with a SHA-256 digest of its own bytes, and each commit
names the digest of the record before it. That chain lets the reader tell a
complete, untouched file from one that was cut short or altered — see
[When a file is damaged](#when-a-file-is-damaged).

## Reading example.tree

This is `example.tree` in full: a world named `example` with six commits. It
was written by the Tapestry kernel under a fixed clock and is frozen in the
repository byte for byte; the `readability` test suite regenerates it and
fails if a single byte differs.

```text
@tree 1 43
world example
created 2026-09-08T21:15:07Z
@end sha256:d8a34e5a4217fb3d4a8d968e7003df018b80bfb71ff2f748a968113455554c90
@commit 1 347
parent sha256:d8a34e5a4217fb3d4a8d968e7003df018b80bfb71ff2f748a968113455554c90
branch main
recorded 2026-09-08T21:16:07Z
tick 0
actor human kaelen
message "first note"
create-node n1 tapestry.notes/note@1
set n1 body text <<TEXT
Met Sam at dinner.
Loves architecture and weird bird memes.
TEXT
set n1 event time 2026-09-07
set n1 title text "Sam"
@end sha256:8d5f947f7b4c3beedc59a6a7d61e18cea52ba7e71e564f328bf75cd2b4d31341
@commit 2 303
parent sha256:8d5f947f7b4c3beedc59a6a7d61e18cea52ba7e71e564f328bf75cd2b4d31341
branch main
recorded 2026-09-08T21:17:07Z
tick 0
actor human kaelen
message "who Sam is"
create-node n2 example.people/person@2
set n2 anger int 3
set n2 name text "Sam"
set n2 position.x real 12.5
set n2 position.y real -3
@end sha256:c1be9108cbbcb96ac7b8fcbbb73a1e2cf7be779bd009ffddb68caf2feb52427c
@commit 3 249
parent sha256:c1be9108cbbcb96ac7b8fcbbb73a1e2cf7be779bd009ffddb68caf2feb52427c
branch main
recorded 2026-09-08T21:18:07Z
tick 0
actor plugin example.people
message "link note to person"
create-edge e1 n1 n2 mentions
set e1 note text "first meeting"
@end sha256:f125ae1531576f1c91823a9546fa6f4cf33cf52a22b4afb7782428dc46a2d3cb
@commit 4 208
parent sha256:f125ae1531576f1c91823a9546fa6f4cf33cf52a22b4afb7782428dc46a2d3cb
branch main
recorded 2026-09-08T21:19:07Z
tick 0
actor human kaelen
message "corrected dinner date"
set n1 event time 2026-09-06
@end sha256:5e7124de89e141504c81c96d7af3a24371a4fc322f263852fefdd675e172084b
@commit 5 189
parent sha256:5e7124de89e141504c81c96d7af3a24371a4fc322f263852fefdd675e172084b
branch main
recorded 2026-09-08T21:20:07Z
tick 0
actor system tapestry
message "advance simulation"
advance 3
@end sha256:1e3c6313f82aa00fc5a82e6b732a3b6919e96d0c9f40eeef5c2de0a3d8035605
@commit 6 166
parent sha256:1e3c6313f82aa00fc5a82e6b732a3b6919e96d0c9f40eeef5c2de0a3d8035605
branch main
recorded 2026-09-08T21:21:07Z
tick 3
actor human kaelen
set n2 anger int 4
@end sha256:8083c729577231f07251d7e8f5d036e13107a020e48be395d15e8eace5ced9a4
```

What each record says:

**The header, `@tree 1 43` … `@end`.** Version 1 of the format. The world is
called `example` and was created at `2026-09-08T21:15:07Z`. The `43` is the
byte count of the two lines between the head line and `@end` — `world example`
(14 bytes with its line feed) plus `created 2026-09-08T21:15:07Z` (29 bytes).
The `@end sha256:d8a34e…` line is the SHA-256 of the record; commit 1's
`parent` line names that same digest, which is how the chain starts.

**Commit 1 — the first note.** Six header lines, then the change:

- `parent sha256:d8a34e…` — this commit follows the header record.
- `branch main` — the branch this history is on (v1 has only `main`).
- `recorded 2026-09-08T21:16:07Z` — when this commit was written down.
- `tick 0` — the simulation tick the commit applies at.
- `actor human kaelen` — who made it: a person, named kaelen.
- `message "first note"` — why, in the actor's words.
- `create-node n1 tapestry.notes/note@1` — a new node, `n1`, whose type is a
  namespaced string a plugin owns. The kernel does not need to understand the
  type to store it.
- `set n1 body text <<TEXT` — the note's body. Because it spans two lines, it
  is written as a block: the lines up to the one reading exactly `TEXT` are
  the text, verbatim — `Met Sam at dinner.` and
  `Loves architecture and weird bird memes.` — with no escape sequences.
- `set n1 event time 2026-09-07` — when the dinner happened. This is a
  property of the note, a value of type `time`, chosen by the person.
- `set n1 title text "Sam"` — short text goes inline, in double quotes.

So the note's **content** is on the `set n1 …` lines, its **authorship** on
the `actor` line, and when it was **recorded** on the `recorded` line.

**Commit 2 — who Sam is.** A second node, `n2`, of type
`example.people/person@2` — a type the kernel has never seen — with a text
`name`, an integer `anger` of `3` and two real-valued properties,
`position.x` `12.5` and `position.y` `-3`. Property keys may contain dots;
`position.x` is simply a key. Initial properties of a node are written in
key order.

**Commit 3 — the relationship.** The actor is `plugin example.people`: this
change came from a plugin, not a person. `create-edge e1 n1 n2 mentions`
creates edge `e1` from `n1` to `n2` with the label `mentions`, and
`set e1 note text "first meeting"` gives the edge its own property.
**Relationships** are `create-edge` lines; the edge's id, both endpoints and
its label are on that one line.

**Commit 4 — the correction.** `message "corrected dinner date"` and
`set n1 event time 2026-09-06`: the dinner was the day before. Commit 1 still
says `2026-09-07` under its own `recorded` stamp; commit 4 says `2026-09-06`
under a later one. The latest `set` wins for the current value, and the
history of the value is the sequence of `set` lines. That is what a
**change** looks like in this file.

**Commit 5 — the advance.** `actor system tapestry` — the kernel itself, on
behalf of the simulation. `advance 3` moves the world's tick from 0 to 3.
Notice this commit's own header still says `tick 0`: a commit applies at the
tick the world was at when it was made, and the advance takes effect after
it.

**Commit 6 — an edit at tick 3.** `tick 3` in the header, no `message` line
(it is optional), and `set n2 anger int 4`: Sam is angrier now. The
`recorded` stamp is a minute after commit 5's, as every commit here is a
minute after the one before.

**Branch ancestry** is the `branch` line together with the `parent` lines:
every commit is on `main`, and each `parent` is the `@end` digest of the
record just above it — you can follow the chain from the last commit back to
the header with a text search.

## Record grammar

Tokens on a line are separated by single spaces. Keys and verbs are lowercase
ASCII. Lines end with a line feed (`\n`, byte 0x0A); there is no byte order
mark and no carriage return in structural lines.

### Envelope

```text
@tree 1 <bytes>                        the header record, first bytes of the file
…body lines…
@end sha256:<64 lowercase hex>

@commit <seq> <bytes>                  one per change; seq = 1, 2, 3 …
…body lines…
@end sha256:<64 lowercase hex>
```

- **Byte count.** `<bytes>` is the exact number of bytes of the body: every
  byte after the head line's line feed up to, but not including, the `@end`
  line. It is written as a plain decimal with no leading zero. Because the
  body is counted, a line inside it that happens to read `@end …` or
  `@commit …` (inside a text block, say) is just text.
- **Digest.** The `@end` digest is SHA-256 over the head line (including its
  line feed) plus the body, exactly as written — the counted bytes and
  nothing else. The `@end` line is not part of what is hashed.
- **Sequence.** `<seq>` counts commits from 1 with no gaps. It is the short
  handle a person uses to name a commit; the digest is the long one.

### Header body

```text
world <token>                          the world's name, chosen by a person; not an id
created <YYYY-MM-DDTHH:MM:SSZ>         when the file was created, UTC
x-…                                    optional extension lines, kept verbatim
```

### Commit body

The first five lines are fixed, in this order, then an optional message, then
the operations, then any extension lines:

```text
parent sha256:<64 hex>                 digest of the previous record (the header record for seq 1)
branch main                            the branch; always main in v1
recorded <YYYY-MM-DDTHH:MM:SSZ>        wall clock at commit, UTC, whole seconds
tick <n>                               the world tick this commit applies at
actor <human|plugin|system> <id>       who: a kind and a one-token id
message "<inline text>"                optional; absent when there is nothing to say
<op lines>
x-…                                    optional extension lines, kept verbatim
```

### Operations

One verb per line. Ids are `n<k>` for nodes and `e<k>` for edges.

| Line | Meaning |
|------|---------|
| `create-node n<k> <type>` | A new node. `<type>` is one token, a namespaced string owned by a plugin (`tapestry.notes/note@1`). Followed by one `set n<k> …` line per initial property, in key order. |
| `set <n<k>\|e<k>> <key> <type> <value>` | Writes one typed property on an existing node or edge, replacing any earlier value. |
| `unset <n<k>\|e<k>> <key>` | Removes a property that exists. Removing one that is not there is refused, so every `unset` line changed something. |
| `create-edge e<k> n<a> n<b> <label>` | A new directed edge from `n<a>` to `n<b>`; both must be live nodes and the label is one token. Followed by `set e<k> …` lines for initial properties, in key order. |
| `delete-node n<k>` | Removes a live node and every edge touching it. The id is never reused. |
| `delete-edge e<k>` | Removes a live edge. The id is never reused. |
| `advance <n>` | Moves the world tick forward by `n` (at least 1). The commit carrying it still applies at the tick before the move; the next commit's `tick` line shows the new value. |

Everything about the world's meaning is expressed with these seven verbs and
the six value types below; plugins compose their data from them and never
add a verb of their own.

### Extension lines

A line whose first two characters are `x-` is an extension line. The kernel
keeps it exactly as written, in its position among the other lines, and never
interprets it. In the header they follow `created`; in a commit the kernel
writes them after the operation lines, and the reader accepts them anywhere
after the fixed header lines. They are for plugins and future versions of
Tapestry to leave readable notes that this version does not need to
understand.

### Keys and tokens

- A **token** is non-empty and contains no space, tab, line break or other
  control byte. Anything else is allowed, including non-ASCII UTF-8, so a
  type such as `example.widgets/gizmo@7` or a name in any script is one
  token.
- A **property key** matches `[A-Za-z_][A-Za-z0-9_.:-]*`: it starts with a
  letter or underscore and may contain letters, digits, `_`, `.`, `:` and
  `-`. Keys are deliberately plainer than tokens so a `set` line can be read
  at a glance whatever its value holds.
- The **actor kind** is exactly `human`, `plugin` or `system`; the actor id
  is one token.

## Value types

Every `set` line carries one of six types, named in lowercase on the line
itself. There is no seventh; a plugin's richer structures are built from
these.

| Type | Written as | Example | Notes |
|------|-----------|---------|-------|
| `text` | inline: `"…"` with JSON-style escapes; or a `<<DELIM` block | `"Sam"`, `<<TEXT` | See below for when each form is used. |
| `int` | decimal 64-bit integer, optional leading `-` | `3`, `-42` | No `+`, no fraction, nothing outside the int64 range. |
| `real` | shortest decimal that reads back to the same double | `12.5`, `-3`, `0.30000000000000004`, `1e+300`, `-0` | Written with `std::to_chars`, independent of any locale. `nan` and `inf` are rejected; so are a decimal comma, a leading `+` and hex forms. |
| `bool` | `true` or `false` | `true` | |
| `ref` | a node or edge id | `n2`, `e1` | Must name a live node or edge when the commit is made. |
| `time` | an unquoted date or date-time, EDTF Level 0/1 or RFC 3339 | `2026-09-07`, `2004-06~`, `2026-09-08T21:15:07Z` | The full table is under [Three kinds of time](#three-kinds-of-time). |

**Inline text** is double-quoted. Inside the quotes, `"` and `\` are written
`\"` and `\\`; a line feed, tab and carriage return are `\n`, `\t` and
`\r`; any other byte below 0x20 is `\u00XX`. Every other byte — including
all non-ASCII UTF-8 — is written raw, so `"café ☕"` is exactly that.

**Block text** is used whenever the text contains a line feed or is longer
than 80 bytes. The value on the `set` line is `<<` followed by a delimiter;
the text is the following lines, verbatim, up to the first line that equals
the delimiter. The line feed before the delimiter line is not part of the
value. The writer picks the delimiter `TEXT`, and if any line of the text is
itself `TEXT` it tries `TEXT1`, `TEXT2`, … until it finds one that no line of
the text equals, so the end of a block is never ambiguous. A block is only
valid for `text`, and all of it lies inside the record's counted bytes.

There is exactly one way to write each value: a decoded record re-encodes to
the bytes it came from.

## Three kinds of time

A `.tree` file keeps three different times apart by giving them three names
in three places. You never need a legend to tell them apart.

| Name | Where it lives | Format | Who sets it | What it means |
|------|----------------|--------|-------------|---------------|
| `recorded` | a commit's header line | RFC 3339 UTC, whole seconds, `Z` suffix: `2026-09-08T21:16:07Z` | the kernel's clock, at commit | when this change was written down |
| `tick` | a commit's header line | unsigned integer | the kernel; changes only through an `advance` op | the simulation step this change applies at |
| `event` (or any `time`-typed property) | a `set … time …` line — a property of a node or edge | EDTF Level 0/1 or RFC 3339, see the table below | a person or plugin, through an op | when the thing happened, possibly partial or uncertain |

`recorded` is audit information only. Ordering comes from `seq` and `parent`,
never from the clock: clocks tie, get corrected and go backwards, and a
commit whose `recorded` stamp is earlier than its predecessor's is still the
next commit in the chain. Two commits may carry the same stamp; that is fine.

`tick` is monotone and kernel-controlled. Two edits in a row without an
`advance` between them carry the same tick. An `advance` commit applies at
the old tick and raises it for the commits that follow.

The **event time** is a value like any other, so it is never guessed: if a
person does not know when something happened, the property is simply not set,
and the kernel never substitutes the wall clock for it.

**A correction in the file.** In `example.tree`, commit 1 records
`set n1 event time 2026-09-07` at `recorded 2026-09-08T21:16:07Z`, and commit 4
records `set n1 event time 2026-09-06` at `recorded 2026-09-08T21:19:07Z` with
`message "corrected dinner date"`. The current value is the later one; the
earlier one is still in the file, in the earlier record, under the stamp it
was written at. Nothing was erased.

### Accepted `time` values

The whitelist the kernel checks a `time` value against. Month and day ranges
are calendar-checked wherever every digit is known.

| Shape | Example | EDTF level | Notes |
|-------|---------|-----------|-------|
| `YYYY` | `2026` | 0 | |
| `YYYY-MM` | `2026-09` | 0 | MM 01..12 |
| `YYYY-MM-DD` | `2026-09-07` | 0 | day checked against month and leap year |
| `YYYY-MM-DDTHH:MM:SSZ` | `2026-09-08T21:15:07Z` | 0 | UTC |
| `YYYY-MM-DDTHH:MM:SS+HH:MM` | `2026-09-08T21:15:07+02:00` | 0 | `+`/`-` offset, HH 00..23, MM 00..59 |
| `date/date` | `2004-06/2006-08` | 0 | interval; each side a date shape, no time |
| `date?`, `date~`, `date%` | `1984?`, `2004-06~`, `2004-06-11%` | 1 | uncertain / approximate / both; suffix only, dates not date-times |
| `YYYX`, `YYXX`, `YXXX` | `199X` | 1 | unspecified trailing year digits |
| `YYYY-XX`, `YYYY-MM-XX`, `YYYY-XX-XX` | `1999-XX`, `1999-03-XX` | 1 | unspecified month and/or day (whole component) |
| `YYYY-SS` (SS 21..24) | `2001-21` | 1 | season: 21 spring, 22 summer, 23 autumn, 24 winter |
| `-YYYY` | `-0999` | 1 | negative year (before year 0000) |
| `Y[-]DDDDD…` | `Y17000`, `Y-17000` | 1 | five or more digit year |
| `../date`, `date/..` | `../1985`, `1985/..` | 1 | open interval end |
| `/date`, `date/` | `/1985`, `1985/` | 1 | unknown interval end |

Everything else is rejected: natural language (`yesterday`), US ordering
(`09/07/2026`), a space instead of `T`, a time without a zone, out-of-range
fields, and the empty string.

## Identifiers

- Nodes are `n<k>` and edges are `e<k>`, with `k` a decimal from 1 upward
  and no leading zero. They are two separate sequences: `n1` and `e1` are
  unrelated.
- The **kernel** assigns them, at commit time, in creation order per world,
  and writes them into the committed line (`create-node n2 …`). A reader
  therefore never has to work an id out; it is on the line that created it.
- On reopening, the next id is restored from the highest id seen in the
  file.
- An id is **never reused** after a delete. A deleted node or edge is
  tombstoned: later lines cannot address it, and a new node gets the next
  number above every id that ever existed. So `n7` means the same thing on
  every line of the file, for the life of the world.
- `seq` and `tick` are plain integers, counted and compared, never prefixed.
- **Phase 3 rule, documented now, not yet implemented.** When branching
  arrives, ids allocated after a fork carry the branch's tag — `b2.n12` is
  node 12 allocated on branch 2 — so two branches can never hand out the same
  id. Ids on `main` stay unprefixed, exactly as in this file.

## Branches and ancestry

Every commit carries `branch main` and a `parent sha256:…` line. In v1 there
is one branch, `main`, and the parent of commit `n` is always the digest of
commit `n-1` (or of the header record, for commit 1). Ancestry is therefore
a single chain you can follow backwards by searching for each `parent`
digest as an `@end` line.

Phase 3 adds forks: the first commit of a new branch will carry a `fork-of`
line naming the digest it branched from, and the branch-tagged ids above.
Files written by v1 stay valid — a reader of a later version sees a single
`main` branch with no forks.

## What the reader checks

The reader is strict. Every record either verifies completely or the load
stops at it with a reason and a byte offset; nothing is skipped and nothing
is guessed. For each record, in order:

1. The head line is `@tree 1 <bytes>` (first record only) or
   `@commit <seq> <bytes>`, with a canonical decimal count.
2. At least `<bytes>` bytes follow, then a line reading
   `@end sha256:<64 lowercase hex>`.
3. The SHA-256 of the head line plus the counted bytes equals that digest.
4. `parent` equals the digest of the previous record (the header's, for
   commit 1).
5. `seq` is the previous commit's `seq` plus one.
6. `tick` equals the tick the replayed world is at: 0, raised by every
   `advance` in the commits before this one.
7. The body is valid UTF-8 with no NUL byte, every line ends with a line
   feed, and every line fits the grammar above — including every value
   parsing for its declared type and every id, key, type, label and actor
   being well formed.
8. Replaying the record's operations against the world succeeds: every id
   a creation line names is exactly the next one, every target and `ref`
   resolves to a live node or edge, every `unset` removes something.

Two rules decide what happens to lines the reader was not written for:

- An **unknown `x-` line** is kept, verbatim and in order. It is data.
- An **unknown verb** — a first token that is not one of the seven
  operations and does not start with `x-` — stops the load at that commit,
  naming the verb and the `seq`. It is never skipped: a newer Tapestry wrote
  something this one cannot apply, and applying the rest would diverge from
  the history.

An **unknown node type** is not a problem at all: types are strings, and a
node of a type no plugin claims loads with all of its typed properties
readable.

## When a file is damaged

Opening a file classifies it:

- **Ok** — every record verified. The world is loaded and new commits may be
  appended.
- **TornTail** — the last record could not be completed before the end of
  the file: its head line, body or `@end` line is cut short. That is what an
  interrupted write looks like (a crash or power loss after the bytes started
  landing and before the write was acknowledged). Every complete record
  before it is loaded.
- **Corrupt** — a record whose bytes are all present does not verify: the
  digest is wrong, the chain or sequence is broken, the tick disagrees with
  the replayed world, a line does not parse, or the world refuses to apply
  it. The records before it are loaded.

In both damaged cases the valid prefix is always loaded, so nothing already
committed is lost, and **appends are refused** until the damage is dealt
with. The kernel never repairs anything silently.

**Repair** is explicit and applies only to a TornTail on a file opened for
writing. It moves the unverified tail, verbatim, into a sidecar file named
`<file>.torn-<timestamp>` — the timestamp is the kernel clock as RFC 3339
with each `:` replaced by `-`, for example
`example.tree.torn-2026-09-08T21-15-07Z` — syncs the sidecar, then truncates
the journal to its verified prefix. If a sidecar with that name already
exists the repair is refused rather than overwriting it. A Corrupt file is
never repaired by the kernel: bytes that are all present and do not verify
are history a person should look at, not something to cut off.

**Save-as** copies exactly the verified prefix into a new file, byte for
byte, whatever the kernel did or did not understand in it. It never touches
the source and refuses to overwrite an existing file.

**Hand edits look like corruption in v1.** Changing any byte of a record
changes its SHA-256, so an edited file reports Corrupt at that record's
offset — even if what you typed is perfectly good grammar. This is by
design: the digest chain is how the reader knows the history is what the
kernel wrote. Editing a `.tree` file by hand and having Tapestry adopt the
result is a Phase 3 feature (import as a branch); until then, make changes
through Tapestry so they become new records.

Two more outcomes are not damage but are worth naming: a file that does not
begin with `@tree 1 <bytes>` (or whose header record cannot be verified) is
**not a .tree file** and is left untouched; and only one process may hold a
`.tree` file open for writing at a time — a second writer is refused, while
read-only opens never take the lock.

## Limits

- A record body is at most 64 MiB (67,108,864 bytes); a line is at most
  1 MiB (1,048,576 bytes). Both are checked before any memory is allocated
  for the record, so a damaged or crafted byte count cannot exhaust memory.
- The file is UTF-8 as RFC 3629 defines it: no overlong sequences, no
  surrogates, nothing above U+10FFFF. A NUL byte is never valid anywhere.
- Lines end with a single line feed. A carriage return is not a line ending;
  inside inline text it is escaped as `\r`, inside a block it is a raw byte
  of the value. There is no byte order mark.
- Inline text is at most 80 bytes and never contains a line feed; anything
  longer or multi-line is a block.

## Integrity, not authenticity

The SHA-256 digests and the parent chain let the reader detect accidental
damage — a torn write, a flipped bit, a truncated copy — and casual edits.
They are **integrity** checks. They do not prove *who* wrote a record: there
is no signature and no keyed hash in v1, so anyone who can write the file can
also recompute every digest after a change. Do not read a verified chain as
proof of authorship; read the `actor` line as what the writing process
claimed.

The file is plaintext by design. Readability without Tapestry is the point;
if a world must be kept private, protect the file the way you would protect
any other document.

## Not in v1

- A `real2` or vector value type: a position is two `real` properties
  (`position.x`, `position.y`), as in `example.tree`.
- Snapshots or any cached state: the journal is the only copy of the
  world's meaning, and every reopen replays it.
- Forks and branches other than `main`, the `fork-of` line, and
  branch-tagged ids (`b2.n12`): documented above, arriving in Phase 3.
- Compression, encryption, signatures or keyed hashes.
- Migration of the prototype's `.tapestry` files: that format is a reference
  for this one, not an input to it.
- Embedded binary data of any kind. An attachment may be *referenced* from a
  readable property, never stored as bytes in the file.
