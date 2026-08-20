#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte von https://nodejs.org installieren."
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install
fi
echo "Starte NetPulse auf http://localhost:8080"
npm run dev
