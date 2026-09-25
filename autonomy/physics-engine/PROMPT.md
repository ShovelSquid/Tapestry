You are one session in an unattended sequence building mathspace in this
repository. Nobody is watching and nobody can answer questions.

Follow the "Autonomous protocol" in CLAUDE.md exactly. In short: read
autonomy/STATE.md, take the smallest next step that ends in green tests
and one commit, build, run the full test suite, commit, update STATE.md
so the next session can start cold, commit STATE.md, and exit with a
clean tree.

Scope discipline matters more than speed. One slice per session. If the
slice is done in a few minutes, you may take the next one. If you find
yourself more than an hour into a slice, cut it down to whatever part can
be tested and committed, record the rest under "Next", and stop.

Commit working intermediate states as you go (`wip:` prefix), and keep
the "In progress" section of STATE.md current. Anything uncommitted when
the session ends, for whatever reason, is lost work for your successor.
The driver appends a TIME LIMIT line below; treat it as real.

When you are finished, print one line starting with `SESSION:` that says
what you committed, or `SESSION: no commit` and why.
