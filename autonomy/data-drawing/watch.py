#!/usr/bin/env python3
"""autonomy/watch.py — one line per event from the driver's stream-json logs.

    autonomy/watch.py            follow the newest log, switch as new sessions start
    autonomy/watch.py FILE       print one file and exit
    autonomy/watch.py --all      print every log in order and exit

Line shapes:
    11:02:15 >> session 4c003589 started            (a new session)
    11:02:16 ai  I'll start by checking the tree…   (model text, trimmed)
    11:02:16 Bash  Show git status, recent log      (tool call: name + description or path)
    11:02:17 ok  3 lines                            (tool result, or `ERR` with the first line)
    11:09:40 == SESSION: committed 3cd79d9 …        (the session's summary line)
"""
import glob
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "logs")
WIDTH = 110
LIVE = False  # set by follow(); replayed files carry no timestamps


def trim(s, n=WIDTH):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def tool_line(block):
    name = block.get("name", "?")
    inp = block.get("input", {}) or {}
    detail = (
        inp.get("description")
        or inp.get("file_path")
        or inp.get("pattern")
        or inp.get("command")
        or inp.get("prompt")
        or inp.get("skill")
        or ""
    )
    return f"{name:<6} {trim(detail, WIDTH - 8)}"


def result_line(block):
    content = block.get("content", "")
    if isinstance(content, list):
        content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    text = str(content)
    is_err = block.get("is_error", False)
    if is_err:
        first = text.strip().splitlines()[0] if text.strip() else "(no output)"
        return f"ERR    {trim(first, WIDTH - 8)}"
    lines = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
    return f"ok     {lines} lines"


def render(event):
    """Yield zero or more display strings for one JSON event."""
    t = event.get("type")
    stamp = time.strftime("%H:%M:%S") if LIVE else "        "
    if t == "system":
        sub = event.get("subtype")
        if sub == "init":
            yield f"{stamp} >> session {event.get('session_id', '?')[:8]} started"
        elif sub == "task_notification":
            yield f"{stamp} bg     {event.get('status', '?')}: {trim(event.get('summary', ''), WIDTH - 12)}"
        return
    if t == "assistant":
        for block in event.get("message", {}).get("content", []):
            bt = block.get("type")
            if bt == "text" and block.get("text", "").strip():
                text = block["text"].strip()
                if text.startswith("SESSION:"):
                    yield f"{stamp} == {trim(text)}"
                else:
                    yield f"{stamp} ai     {trim(text, WIDTH - 8)}"
            elif bt == "tool_use":
                yield f"{stamp} {tool_line(block)}"
        return
    if t == "user":
        for block in event.get("message", {}).get("content", []):
            if isinstance(block, dict) and block.get("type") == "tool_result":
                yield f"{stamp} {result_line(block)}"
        return
    if t == "result":
        yield f"{stamp} << session ended ({event.get('subtype', '?')}, {event.get('num_turns', '?')} turns)"


def emit_line(raw):
    raw = raw.strip()
    if not raw.startswith("{"):
        if raw.startswith("run.sh:"):
            stamp = time.strftime("%H:%M:%S") if LIVE else "        "
            print(f"{stamp} !! {trim(raw)}", flush=True)
        return
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        return
    for line in render(event):
        print(line, flush=True)


def print_file(path):
    with open(path, errors="replace") as f:
        for raw in f:
            emit_line(raw)


def newest_log():
    logs = sorted(glob.glob(os.path.join(LOG_DIR, "*.log")))
    return logs[-1] if logs else None


def follow():
    global LIVE
    LIVE = True
    current = None
    handle = None
    while True:
        latest = newest_log()
        if latest and latest != current:
            if handle:
                for raw in handle:
                    emit_line(raw)
                handle.close()
            current = latest
            handle = open(current, errors="replace")
            print(f"{time.strftime('%H:%M:%S')} ## following {os.path.basename(current)}", flush=True)
        if handle:
            for raw in handle:
                emit_line(raw)
        time.sleep(1)


def main(argv):
    if len(argv) > 1 and argv[1] == "--all":
        for path in sorted(glob.glob(os.path.join(LOG_DIR, "*.log"))):
            print(f"## {os.path.basename(path)}")
            print_file(path)
        return
    if len(argv) > 1:
        print_file(argv[1])
        return
    try:
        follow()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv)
