"""Watch a folder of question files (one thread per file) for finished Kaelen answers.

A file's answer is finished when its last block is a non-empty {Kaelen: ...} with no
Claude reply after it, and Kaelen has since changed an answer in a *different* file.
The file currently being written in is never reported. Only saved content is seen,
and only after the folder has been stable for SETTLE seconds.

Usage: python3 watch_questions.py [folder]   (defaults to the folder this script is in)
Each finished answer prints one line, e.g.
    finished answers: 3-intentions.md | still writing in: 5-spans.md
Claude Code runs it under its Monitor tool so each line wakes the session to reply.
"""
import glob
import os
import re
import sys
import time

DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SETTLE = 4.0
POLL = 1.0

BLOCK = re.compile(r"\{(.*?)\}|\[Claude:.*?\]", re.S)


def open_answer(text):
    """Body of the file's last block if it is a non-empty Kaelen answer, else None."""
    blocks = list(BLOCK.finditer(text))
    if not blocks or blocks[-1].group(1) is None:
        return None
    body = re.sub(r"^\s*Kaelen:\s*", "", blocks[-1].group(1)).strip()
    return body or None


def snapshot():
    out, newest = {}, 0.0
    for path in sorted(glob.glob(os.path.join(DIR, "*.md"))):
        newest = max(newest, os.path.getmtime(path))
        with open(path) as f:
            body = open_answer(f.read())
        if body:
            out[os.path.basename(path)] = body
    return out, newest


prev = None          # open answers as of the last check
touched = {}         # file -> tick when Kaelen last changed its open answer
reported = set()     # (file, body) already announced
tick = 0
last_newest = None

while True:
    try:
        cur, newest = snapshot()
        if time.time() - newest >= SETTLE and newest != last_newest:
            last_newest = newest
            tick += 1
            for name, body in cur.items():
                if prev is None or prev.get(name) != body:
                    touched[name] = tick
            for name in list(touched):
                if name not in cur:
                    del touched[name]  # replied to (or cleared)
            prev = cur

            latest = max(touched.values(), default=0)
            ready = sorted(
                n for n in cur
                if any(o != n and t > touched[n] for o, t in touched.items())
            )
            fresh = [n for n in ready if (n, cur[n]) not in reported]
            if fresh:
                writing = [n for n, t in touched.items() if t == latest]
                for n in fresh:
                    reported.add((n, cur[n]))
                print("finished answers: " + " ".join(fresh)
                      + " | still writing in: " + " ".join(writing), flush=True)
    except Exception as e:  # keep watching through hiccups (e.g. a file mid-rename)
        print(f"watcher error: {e}", flush=True)
        time.sleep(5)
    time.sleep(POLL)
