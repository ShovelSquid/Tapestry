# Phase 2: Plugin Host, SDK & Feasibility Gate - Discussion Log

> Audit trail only. Downstream agents consume 02-CONTEXT.md, not this log.

**Date:** 2026-09-09
**Areas discussed:** persistent spatial editing, hover/selection, passage threads, overlapping highlights, thread-center nodes, deletion/undo, resizing, universal formatting.
**Status:** Saved at user request; plugin discussion has not occurred. Entries below summarize questions and answers in chronological order; quoted phrases retain distinctive user wording, other entries are paraphrases.

## Questions, alternatives, and user selections

1. **Start planning or discuss first?**
   User: definitely discuss first; invoked discuss-phase 2.

2. **Which phase-2 areas to discuss?**
   User supplied Tapestry_Base_UI_Brief.docx instead of choosing an area; read the entire document and used it to ground UI discussion.

3. **Require the five-note reopen experience in phase 2?**
   User asked what this meant, then clarified: create a file, add as many notes/connections as desired, and recreate correctly. Five is an example, not a limit.

4. **Autosave or explicit Save/Cmd+S?**
   User prefers automatic saving.

5. **Restore last file on launch?**
   Yes.

6. **Double-click to type; Enter newline; Escape/outside ends editing?**
   Yes, with explicit correction: nothing destructive; added text stays and must not depend on Enter to save.

7. **Drag a connection handle?**
   User thinks so; wants many bubbly edge buttons with different functions/colors.

8. **Only selected note reveals controls?**
   Yes, refined to hover as well as click focus.

9. **Hover another note reveals controls without stealing the editing caret?**
   Exactly. Clicking moves the caret; hovering reveals controls and lets selected text connect using another note’s controls.

10. **Remember the selected passage?**
   Yes, highlight both connections/endpoints on hover/click of the link.

11. **Follow edits; mark deleted source missing?**
   User refined this: persistent brackets [], inserted text inside remains linked, deleting text leaves empty anchor; deleting the bracket structure deletes the link. Missing-source substitute was not selected.

12. **Brackets on hover/selection with subtle linked-text highlight otherwise?**
   Yes exactly.

13. **Passage-to-passage as well as passage-to-note?**
   Absolutely.

14. **Hold source with connect bubble, select destination passage, finish with its bubble; Escape cancels only pending link?**
   Absolutely fits.

15. **Multiple threads per passage?**
   Yes, and passages inside passages with different links.

16. **Partial overlap, e.g. “the quick brown” and “brown fox”?**
   They should be allowed.

17. **Chooser for overlapping passages/threads?**
   Yes; all passages overlapping cursor region highlight, pointer motion changes foreground emphasis based on closeness, a gradient of focus.

18. **Smallest passage strongest, enclosing ones softer?**
   Absolutely; small passages must remain readable.

19. **Include passage interaction in phase 2?**
   User first refined emphasis: smallest strongest; progressively larger enclosing passages each weaker; outermost still above unselected text. Then explicitly confirmed phase 2 and added text-bearing nodes at thread centers.

20. **Thread center behaves like editable/connectable ordinary note?**
   Yes.

21. **Automatically between endpoints until dragged, then preserve manual position?**
   Yes.

22. **Empty center visible only on hover/selection; stays visible after adding text?**
   Yes.

23. **Deleting center removes thread but preserves endpoints?**
   Yes; same as brackets: content deletion preserves structure, deleting structure cuts thread.

24. **Delete shared bracket cuts all attached threads?**
   Yes.

25. **Other bubble actions?**
   User proposed red delete and asked whether notes should share content-vs-structure semantics.

26. **Clear note text preserves anchors/threads; delete note cuts connections; undo restores all?**
   Yes. Other endpoint notes remain intact; deleting a thread-center also cuts its represented thread.

27. **Backspace/Delete edits text with caret; whole-note deletion via note selection or red bubble?**
   Yes, selecting the note itself and the red bubble.

28. **Border selects note; text click places caret?**
   Yes; user added drag-to-resize borders and formatting buttons.

29. **Formatting: bold, italic, headings, lists, text color, or broader?**
   Those, plus alignment and font.

30. **Floating toolbar near selected text, available while typing too?**
   Yes; usually small, hover expands options, hovering options expands further options.

31. **Keep menus open across toolbar/submenu traversal; short exit delay?**
   Definitely.

32. **Same formatting on thread-center text?**
   Yes, universal.

33. **Anything more about editing before plugins?**
   No; user asked to record everything because usage is running out. Pause and preserve, do not start more discussion or planning.

## Superseded interpretations

- Five notes is not a quota or feature limit.
- Missing-source warning after text deletion was replaced by an explicitly retained empty bracket anchor.
- Selected-note-only controls were refined to hover plus click, with hover never stealing editing selection.
- One strongest passage plus uniformly faint ancestors was replaced by a full graded hierarchy across enclosing passages.
- Passage UI is explicitly in Phase 2, despite the older roadmap placing broad notebook work later.

## the agent's Discretion

No general “you decide” authorization was given for unresolved product choices. Exact technical architecture and interaction constants were not discussed. No toolkit was selected.

## Pending / Deferred

Next discussion: plugin authoring/local loading, permissions/failure behavior, and compatibility/version handling. No need to repeat captured editing questions. Planning must reconcile the expanded Phase 2 UI with the old roadmap and requirements. Full history navigation/branching and the brief's AI/Mimic ambitions remain later work.
