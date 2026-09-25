#!/usr/bin/env bash
# autonomy/run.sh — unattended driver for ws/ui: executes the Design plans in ~/Tree/Design.
#
# Copied from ws/windows. Each iteration starts a FRESH claude session
# (fresh context), hands it autonomy/PROMPT.md plus a time-limit line, and
# lets it execute the next ready Design plan per autonomy/PROTOCOL.md. Memory between
# sessions is the plan files' status lines, autonomy/STATE.md
# and git history, so context size never becomes a problem.
#
# A session is killed only if it produces no output for IDLE_LIMIT seconds
# (hung) or runs past SESSION_TIMEOUT (runaway). Output is streamed as
# JSON events, so every tool call and text chunk counts as progress.
#
# To stop gently, `touch autonomy/STOP`: the running session finishes and
# commits, then the loop exits (and removes STOP) instead of starting the
# next one. Ctrl-C also works but kills the session mid-task.
#
# Stops when autonomy/DONE exists (no ready Design plan is left), when
# MAX_SESSIONS is reached, on autonomy/STOP, or on Ctrl-C. Human checkpoints
# never stop it: sessions queue them in autonomy/REVIEW.md and keep going. STALL_LIMIT sessions in a row with no new commit switches to a
# long backoff instead of stopping, so a transient failure does not burn
# the night.
#
# Watch it live from another terminal:  autonomy/watch.py
#
# Usage:
#   autonomy/run.sh                 # run until DONE
#   MAX_SESSIONS=1 autonomy/run.sh  # one plan, then stop
#   PUSH=0 autonomy/run.sh          # do not push after each session
#
# Knobs (all optional, seconds unless noted):
#   MODEL            claude model alias                 (default: opus)
#   MAX_SESSIONS     hard cap on iterations, 0 = none   (default: 0)
#   SESSION_TIMEOUT  hard cap per session, 0 = none     (default: 7200)
#   IDLE_LIMIT       kill after this long with no output (default: 900)
#   SESSION_SLEEP    pause between sessions             (default: 20)
#   STALL_LIMIT      no-commit sessions before backoff  (default: 3)
#   STALL_SLEEP      backoff pause                      (default: 900)
#   PUSH             1 = git push after a committing session (default: 1)
#   MAX_BUDGET_USD   per-session API budget in dollars, passed through if set

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

MODEL="${MODEL:-opus}"
MAX_SESSIONS="${MAX_SESSIONS:-0}"
SESSION_TIMEOUT="${SESSION_TIMEOUT:-7200}"
IDLE_LIMIT="${IDLE_LIMIT:-900}"
SESSION_SLEEP="${SESSION_SLEEP:-20}"
STALL_LIMIT="${STALL_LIMIT:-3}"
STALL_SLEEP="${STALL_SLEEP:-900}"
PUSH="${PUSH:-1}"
LOG_DIR="$ROOT/autonomy/logs"
mkdir -p "$LOG_DIR"

if ! command -v claude >/dev/null 2>&1; then
    echo "run.sh: claude CLI not on PATH" >&2
    exit 1
fi

# Keep the Mac awake while the loop runs. caffeinate exits when we do.
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
    caffeinate -i -w $$ &
    CAFFEINATE_PID=$!
fi

CHILD_PID=""
WATCHDOG_PID=""
cleanup() {
    [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null
    [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
    [ -n "$CHILD_PID" ] && kill "$CHILD_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

time_limit_line() {
    local hard="none" idle="$((IDLE_LIMIT / 60)) minutes with no output"
    if [ "$SESSION_TIMEOUT" -gt 0 ]; then
        hard="$((SESSION_TIMEOUT / 60)) minutes from $(date +%H:%M)"
    fi
    echo
    echo "TIME LIMIT: hard cap $hard; killed after $idle. Do not run a single silent command longer than that. Commit wip states often; uncommitted work is lost when the session ends."
}

session=0
stall=0

while :; do
    if [ -f "$ROOT/autonomy/DONE" ]; then
        echo "run.sh: autonomy/DONE present, stopping."
        break
    fi
    if [ -f "$ROOT/autonomy/STOP" ]; then
        echo "run.sh: autonomy/STOP present, stopping after the last session (removing STOP so the next run starts normally)."
        rm -f "$ROOT/autonomy/STOP"
        break
    fi
    if [ -f "$ROOT/autonomy/WAITING" ]; then
        # Older sessions stopped here. Now the next session moves WAITING
        # into autonomy/REVIEW.md and carries on, so only report it.
        echo "run.sh: autonomy/WAITING present; the next session queues it in autonomy/REVIEW.md."
    fi
    if [ "$MAX_SESSIONS" -gt 0 ] && [ "$session" -ge "$MAX_SESSIONS" ]; then
        echo "run.sh: MAX_SESSIONS=$MAX_SESSIONS reached, stopping."
        break
    fi

    session=$((session + 1))
    stamp="$(date +%Y%m%d-%H%M%S)"
    log="$LOG_DIR/$stamp.log"
    before="$(git rev-parse HEAD)"
    echo "run.sh: session $session starting at $stamp (head ${before:0:8}), log $log"

    budget_args=()
    if [ -n "${MAX_BUDGET_USD:-}" ]; then
        budget_args=(--max-budget-usd "$MAX_BUDGET_USD")
    fi

    claude -p \
        --model "$MODEL" \
        --dangerously-skip-permissions \
        --no-session-persistence \
        --output-format stream-json \
        --verbose \
        ${budget_args[@]+"${budget_args[@]}"} \
        "$(cat "$ROOT/autonomy/PROMPT.md"; time_limit_line)" \
        >"$log" 2>&1 &
    CHILD_PID=$!
    # Watchdog: kill on no output for IDLE_LIMIT, or on the hard cap.
    (
        start=$(date +%s)
        idle_since=$start
        last_size=$(stat -f %z "$log" 2>/dev/null || echo 0)
        while kill -0 "$CHILD_PID" 2>/dev/null; do
            sleep 30
            now=$(date +%s)
            size=$(stat -f %z "$log" 2>/dev/null || echo 0)
            if [ "$size" != "$last_size" ]; then
                last_size=$size
                idle_since=$now
            fi
            if [ $((now - idle_since)) -ge "$IDLE_LIMIT" ]; then
                echo "run.sh: no output for ${IDLE_LIMIT}s, killing session" | tee -a "$log"
                kill "$CHILD_PID" 2>/dev/null
                break
            fi
            if [ "$SESSION_TIMEOUT" -gt 0 ] && [ $((now - start)) -ge "$SESSION_TIMEOUT" ]; then
                echo "run.sh: hard cap ${SESSION_TIMEOUT}s reached, killing session" | tee -a "$log"
                kill "$CHILD_PID" 2>/dev/null
                break
            fi
        done
    ) &
    WATCHDOG_PID=$!

    wait "$CHILD_PID"
    status=$?
    kill "$WATCHDOG_PID" 2>/dev/null
    CHILD_PID=""
    WATCHDOG_PID=""

    after="$(git rev-parse HEAD)"
    summary="$(grep -o 'SESSION:[^"\\]*' "$log" | tail -1 || true)"
    echo "run.sh: session $session exit $status; ${summary:-SESSION: (no summary line)}"

    if [ "$after" != "$before" ]; then
        stall=0
        if [ "$PUSH" = "1" ]; then
            git push -q origin HEAD 2>>"$log" || echo "run.sh: push failed (see log)"
        fi
    else
        stall=$((stall + 1))
        echo "run.sh: no new commit ($stall in a row)"
    fi

    if [ "$stall" -ge "$STALL_LIMIT" ]; then
        echo "run.sh: stalled $stall sessions; sleeping ${STALL_SLEEP}s before retrying"
        sleep "$STALL_SLEEP"
    else
        sleep "$SESSION_SLEEP"
    fi
done
