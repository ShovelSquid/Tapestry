#!/bin/bash
# Wave 8: retake every state from waves 2-7 against the current build, into
# $1 (default /tmp/wave8). Run from anywhere after `npm --prefix app run build:js`.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="${1:-/tmp/wave8}"; mkdir -p "$out"
shot() { # name setup pose [env...]
  local name="$1" setup="$2" pose="$3"; shift 3
  ( cd "$root/app" && env SHOT_SCRIPT="$(cat "$here/$setup")" SHOT_AFTER_RELOAD="$pose" "$@" \
      npx electron "$here/app-shot.cjs" "$out/$name.png" ) > "$out/$name.log" 2>&1
  echo "$name: $? $(tail -c 300 "$out/$name.log" | tr '\n' ' ')"
}
p() { cat "$here/$1"; }
shot 01-note-rest-hover-selected wave2-setup.js "$(p wave2-pose.js)"
shot 02-note-midgrow-delete-hover wave2-setup.js "$(p wave2-pose-mid.js)" SHOT_SETTLE_MS=150
shot 03-format-pill wave3-setup.js "$(p wave3-pose.js)"
shot 04-note-settings wave3-setup.js "window.__POSE__='settings';$(p wave3-pose.js)"
shot 05-connection-drag wave4-setup.js "window.__POSE__='drag';$(p wave4-pose.js)"
shot 06-connection-land wave4-setup.js "window.__POSE__='land';$(p wave4-pose.js)" SHOT_SETTLE_MS=60
shot 07-connection-rest wave4-setup.js "window.__POSE__='rest';$(p wave4-pose.js)"
shot 08-collapse-circles wave5-setup.js "$(p wave5-pose.js)" SHOT_TIMEOUT_MS=120000
shot 09-motion-panel wave2-setup.js "$(p wave6-pose.js)" SHOT_SETTLE_MS=60 SHOT_TIMEOUT_MS=120000
shot 10-entered-note wave5-setup.js "window.__MODE__='in';$(p wave7-pose.js)" SHOT_TIMEOUT_MS=120000
