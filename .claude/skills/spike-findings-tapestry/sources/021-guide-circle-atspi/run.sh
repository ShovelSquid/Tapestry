#!/usr/bin/env bash
# Spike 021: point at a named control with a green highlight.
# Usage: ./run.sh [app-substring] [control name] [seconds]
#   ./run.sh kate "Save As…" 30
set -e
cd "$(dirname "$0")"
# Apps only publish their UI tree while the session's accessibility flag is on.
gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
  --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled '<true>' >/dev/null
env -u QT_ACCESSIBILITY python3 guide.py "${1:-kate}" "${2:-Save As…}" --seconds "${3:-30}" \
  2>&1 | grep -v -e 'qt.accessibility.atspi' -e "Cannot read property 'targets' of null"
