#!/usr/bin/env bash
# macOS / Linux equivalent of "Start Speed Reading.cmd"
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org and run this again."
  exit 1
fi

[ -d node_modules ] || { echo "First run - installing dependencies..."; npm install; }

npm run build
echo "Starting. Keep this window open while you train; close it to stop."
npm run preview -- --open
