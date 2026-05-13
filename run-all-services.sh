#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

start_service() {
  local name="$1"
  local dir="$2"
  shift 2

  echo "▶ Starting ${name}..."
  (
    cd "$dir"
    "$@"
  ) &
  PIDS+=("$!")
}

cleanup() {
  echo
  echo "⏹ Stopping services..."
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

start_service "ai-be" "$ROOT_DIR/ai-be" corepack pnpm run dev
start_service "infa-be" "$ROOT_DIR/infa-be" corepack pnpm run dev

if [[ -f "$ROOT_DIR/fe/package.json" ]] && grep -q '"dev"' "$ROOT_DIR/fe/package.json"; then
  start_service "fe" "$ROOT_DIR/fe" corepack pnpm run dev
else
  echo "⚠ Skipping fe: no package.json with a dev script found."
fi

echo "✅ Services are running. Press Ctrl+C to stop."
wait
