#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte von https://nodejs.org installieren."
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm install
fi

echo "Starte NetPulse auf http://localhost:8080"
echo "Beenden: Ctrl+C"

vite="./node_modules/.bin/vite"
if [[ ! -x $vite ]]; then
  echo "Vite fehlt. Bitte npm install ausführen."
  exit 1
fi

kill_tree() {
  local pid=$1 child
  for child in $(ps -o pid= --ppid "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM
  echo
  echo "NetPulse beendet."
  if [[ -n "${child:-}" ]]; then
    kill_tree "$child"
    sleep 0.3
    kill -KILL "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup INT TERM

# Direkt Vite, nicht npm — sonst frisst der npm-Wrapper oft das erste Ctrl+C.
"$vite" dev --host 0.0.0.0 --port 8080 &
child=$!
wait "$child" || true
cleanup
