#!/bin/bash
# =====================================================================
#  DSC Analyzer - open on http://localhost  (Linux / generic)
#
#  Run:  bash launchers_mac/DSC-localhost.sh   (from the repo root; or chmod +x and ./)
#
#  Why: opening the app as file:// lets the browser evict the IndexedDB
#  cache (your DB / projects). http://localhost is a proper origin, so
#  the data is kept far more reliably.  Requires Python 3.
# =====================================================================
PORT=8754
FILE=webapp/dsc_analyzer_v9.html

cd "$(dirname "$0")/.." || exit 1   # serve the repo root, not launchers_mac/

if curl -s -o /dev/null "http://127.0.0.1:$PORT/$FILE"; then
  echo "Server already running on http://localhost:$PORT"
else
  echo "Starting local server on http://localhost:$PORT ..."
  nohup python3 -m http.server "$PORT" >"/tmp/dsc_http_$PORT.log" 2>&1 &
  disown
  sleep 1
fi

URL="http://localhost:$PORT/$FILE"
echo "Opening $URL"
# xdg-open on most Linux; fall back to a printed URL
xdg-open "$URL" 2>/dev/null || sensible-browser "$URL" 2>/dev/null || echo "Open this URL in your browser: $URL"

echo "You can close this terminal; the server keeps running."
