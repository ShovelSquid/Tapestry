---
phase: "2"
slug: "shell"
status: draft
shadcn_initialized: false
preset: none
created: "2026-10-22"
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for the shell swap. Sources: `02-CONTEXT.md` (locked D-01 through D-10), `REQUIREMENTS.md` SHELL-01 through SHELL-06 and VAULT-01, `ROADMAP.md` Phase 2 success criteria, `research/STACK.md`, and the existing `apps/canvas/src/main.rs` theme.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — native Rust/egui UI; no web design system |
| Preset | not applicable |
| Component library | egui 0.36.2 (native widgets and panels) |
| Icon library | none; use text labels and standard keyboard glyphs |
| Font | Existing installed proportional sans and custom `title` serif family; use monospace only for paths and terminal/editor content |

The shell keeps the established warm paper-and-ink appearance. Build with egui `Panel`, `Area`, and `Window` primitives; do not introduce a separate component kit. Explorer is left-docked by default, edge-resizable, closable/reopenable, and draggable to a floating window. The Cmd-K palette is a foreground overlay and remains globally reachable while a terminal is focused. Existing tool views fill the main window; Esc returns to the graph workspace under the shared input router. The graph shown in this phase is a blank, read-only canvas stub. **Primary visual anchor:** the blank graph canvas owns the largest uninterrupted area and draws the eye first; the left explorer is secondary, with the palette appearing only on demand. Within the canvas, the selected note/folder provides the only focal mark when navigation targets an item.

---

## Spacing Scale

Declared values (all multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon and label gaps |
| sm | 8px | Compact row and control spacing |
| md | 16px | Default row padding and section spacing |
| lg | 24px | Explorer and palette group separation |
| xl | 32px | Major overlay/panel insets |
| 2xl | 48px | Large empty-state breathing room |
| 3xl | 64px | Canvas empty-state placement margin |

Exceptions: 44px minimum height for icon-only or primary keyboard-accessible targets; 1px separators and focus strokes are permitted as hairlines.

---

## Typography

Use these four sizes for shell-owned UI (egui point values):

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Compact metadata / path | 12pt | Regular (400) | 1.4 |
| Body / list row | 14pt | Regular (400) | 1.5 |
| Section / overlay title | 20pt | Semibold (600) | 1.2 |
| Workspace heading | 26pt | Semibold (600) | 1.2 |

The custom serif `title` family is used for workspace and overlay headings; proportional sans is used for controls, labels, and explorer rows. Monospace path text may use the 12pt size. Do not add further shell font sizes or weights.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#FAF9F5` PAPER | Main workspace, canvas, app background |
| Secondary (30%) | `#FFFEFB` SHEET with `#E4E1D9` RULE_LINE dividers | Explorer, palette surface, grouped rows, separators |
| Accent (10%) | `#E8492A` DOT | Current palette match/selection marker and explicit active-vault status marker only |
| Destructive | `#B42318` | Only destructive confirmation affordance, if one becomes necessary |

Accent reserved for: the selected palette result marker and the active vault status marker. Ordinary hover, focus, navigation, and selection use ink, muted text, or a quiet paper tint; do not color every interactive element red. Text uses existing `#16191B` INK, `#4B4E4B` MUTED, and `#686A66` FAINT values.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | Open vault |
| Empty state heading | This vault is empty |
| Empty state body | Open a folder with Markdown notes, or add notes to this folder and they will appear here. |
| Palette no-match state | No matches. Try a different search. |
| Loading state | Loading vault… |
| Error state | Couldn’t open this folder. Check that it exists and is readable, then choose another folder. |
| Destructive confirmation | None in Phase 2. Leaving a tool with Esc does not discard or delete data. |

The palette query prompt is `Search tools, notes, folders, and commands…`. The folder picker command is `Open vault…`. Keep explorer labels as names; show full paths in the folder-open field and when needed to distinguish duplicate note names. The folder field starts with the current vault path; with no vault selected it starts empty and shows the folder-selection hint. The blank graph has no decorative text or loading skeleton; a centered, low-emphasis status line appears only while the initial vault scan is pending. Its viewport clips off-canvas content and keeps navigation targets centered; long selected titles appear in a single-line label with ellipsis and a full-title tooltip.

---

## UI Considerations

The compiled UI consideration probe found **25 applicable states** across the explorer, vault picker, command palette, and canvas workspace. The following contract resolves each applicable category. Explicit rows have direct copy/layout criteria above; the canvas populated state remains a visual backstop for the blank read-only graph and camera navigation.

| Surface | Applicable categories | Resolution |
|----------|-----------------------|------------|
| Explorer folder/note collection and navigation | empty, loading, error, populated, partial, overflow, zero-one-many, long-text | **Explicit:** empty uses “This vault is empty”; loading keeps the shell responsive and shows “Loading vault…”; errors preserve usable state and provide the documented next step; partial refresh keeps valid rows; rows scroll, wrap to two lines then ellipsize, and expose full paths in tooltips. Zero, one, and many use the same row treatment, with the empty state for zero. |
| Vault picker form and controls | empty, loading, error, partial, long-text | **Explicit:** the path field is blank with a folder-selection hint when no vault is selected, otherwise prefilled with the current vault path; path text scrolls horizontally at the caret; loading and failure use the copy above and retain the prior usable shell. Partial indexing preserves successful entries while reporting failed paths. |
| Command palette search/results | empty, loading, error, populated, partial, overflow, zero-one-many, long-text | **Explicit:** the query remains editable; zero matches use “No matches. Try a different search.”; results group and fuzzy-rank tools, notes, folders, and commands; tool/command results remain usable during index refresh/failure; result rows scroll, keep selection visible, and expose full labels in tooltips. |
| Canvas workspace and navigation | loading, error, overflow, long-text | **Explicit:** initial scan uses the low-emphasis status line; failures preserve the shell and last valid snapshot; the viewport clips off-canvas content, centers navigation targets, and ellipsizes long selected titles with full-title tooltip. |
| Canvas populated stub | populated | **Backstop:** a valid snapshot shows the blank read-only graph surface; selecting a note or folder in explorer or palette moves the minimal camera to that target. Verify with a shell screenshot or UI-state check. |

Accessibility and input contract: keyboard focus is visibly indicated with an ink outline or underline; palette selection is not color-only and is announced by the selected-row treatment plus keyboard position. `Cmd-K` must open with terminal focus, `Esc` precedence is palette → focused editor/terminal/tool handler → return from hosted tool → canvas-local cancellation, and the terminal exit chord is consumed before PTY input. Simulation shortcuts are active only in the Simulation view. Respect OS text scaling where egui supports it; maintain keyboard operation for explorer, palette, folder selection, close/reopen, and tool navigation.
---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS — primary visual anchor and hierarchy declared
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS — no registries used
- [ ] Dimension 7 Inventory Provenance: PASS — no component inventory; Tool: none

**Approval:** approved; Dimension 2 recommendation addressed; no blocking issues
