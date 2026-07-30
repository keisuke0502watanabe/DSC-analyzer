#!/bin/bash
# =====================================================================
#  DSC Analyzer — open on http://localhost  (double-click this file)
#
#  Why: opening the app as file:// lets Chrome evict the IndexedDB cache
#  (your DB / projects) under disk pressure. http://localhost is a proper
#  origin, so the browser keeps the data far more reliably.
# =====================================================================
PORT=8754
FILE=webapp/dsc_analyzer_v9.html

cd "$(dirname "$0")/.." || exit 1   # serve the repo root, not launchers_mac/

# Start a static server for this folder if one isn't already running.
if curl -s -o /dev/null "http://127.0.0.1:$PORT/$FILE"; then
  echo "Server already running on http://localhost:$PORT"
else
  echo "Starting local server on http://localhost:$PORT ..."
  nohup python3 -m http.server "$PORT" >"/tmp/dsc_http_$PORT.log" 2>&1 &
  disown
  sleep 1
fi

echo "Opening http://localhost:$PORT/$FILE"
open "http://localhost:$PORT/$FILE"

echo ""
echo "You can close this Terminal window; the server keeps running."
