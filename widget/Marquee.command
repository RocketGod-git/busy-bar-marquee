#!/bin/bash
# Double-click to open the Marquee widget on a Mac. Needs Node.js 24 (https://nodejs.org).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Marquee needs Node.js. Install it from nodejs.org, then open Marquee again." buttons {"OK"} default button 1 with title "Marquee"' >/dev/null 2>&1
  open "https://nodejs.org"
  exit 1
fi
node server.mjs --open >/dev/null 2>&1 &
disown
# Close this Terminal window; the widget keeps running until you close its window.
osascript -e 'tell application "Terminal" to close (every window whose name contains "Marquee.command")' >/dev/null 2>&1 &
exit 0
