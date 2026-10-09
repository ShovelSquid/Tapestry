---
name: tree-rules
description: Translate the plain-language prose in Tapestry rule notes (.tree files in world/rules) into rule lines the canvas runs, and check them. Use when asked to translate, write, fix, or explain a rule note, or when a note "does nothing yet".
---

# Translating rule notes

A rule note is a `.tree` file in `world/rules/`. Its first `#` line is the
title, its prose says what the author means, and its rule lines say it in the
basic rules. Only rule lines do anything. The canvas reloads notes live, so an
edit shows up as soon as the file is saved: no rebuild.

Your job: read the author's prose and write rule lines that make the canvas do
what it says, using only what is built today.

## 1. Learn the current vocabulary from the code

```sh
cargo run -q -p tapestry-canvas --bin tree-check -- --grammar
```

This is generated from the parser, so trust it over anything remembered,
including this file. Never write a material, property or basic rule it
doesn't list.

What each material does on its own (no rule needed):

- **ink**: blots into the paper and dries. Wet ink flows; it dries by itself.
- **water**: falls, pours and pools; resting ink and the canvas edges stop it.
- **tree**: hangs in a swaying frame; doesn't fall.
- **fire**: burns its fuel for a few seconds, giving off flames, then becomes ash.
- **flame**: rises and dies within about a second.
- **ash**: falls and settles into piles.

How materials act on *each other* is never built in. That is what rule notes
are for.

## 2. Read the notes

```sh
cargo run -q -p tapestry-canvas --bin tree-check            # every note
cargo run -q -p tapestry-canvas --bin tree-check -- world/rules/<name>.tree
```

It prints what each note's rule lines mean to the canvas, every line that
didn't read, and which notes have no rule lines yet. Read the existing working
notes as examples of scale: rates and distances that already look right.

## 3. Translate

- Keep the title and prose exactly as the author wrote them. Add or replace
  only rule lines, below the prose, after a blank line.
- Most effects are a pair: a `change` that builds a property up near
  something, and a `convert` that fires when it's high enough. Add a spread
  (`±40%`) to a convert so a crowd doesn't turn all at once.
- Pick numbers in proportion to the existing notes: distances of about 8-20
  for "touching" or "near", rates that reach the threshold in about 0.3-2 s.
- Check the prose doesn't already overlap another note. If it does, say so.
- Lines starting with `//` are comments. New notes come with commented
  examples; remove them once there are real rule lines.

## 4. When the prose asks for something that isn't built

Don't approximate silently. Write what can be expressed, and add a `//`
comment in the note naming the missing piece, for example:

```
// needs: a "remove" rule, or water as a property, to make water disappear
```

Then tell the author what's missing in a sentence: which basic rule,
material or property would make it possible. If nothing useful can be
expressed, leave the note's rule lines empty and only explain.

## 5. Check your work, every time

Run `tree-check` on the note you edited. It exits 1 if any line didn't read.
Fix and re-run until it's clean, then show the author the note's prose next to
the rule lines it now has, with one line on what they'll see on the canvas.
