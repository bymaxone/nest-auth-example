#!/usr/bin/env bash
# unlink-library.sh — Reverse the global pnpm link created by link-library.sh.
# Use this when switching back to the published npm version of @bymax-one/nest-auth.
#
# Idempotent: safe to run even if the link was never established (uses || true).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "${HERE}/../nest-auth" 2>/dev/null && pwd || true)"

echo "==> Removing link to @bymax-one/nest-auth in $(basename "${HERE}")"
(cd "${HERE}" && pnpm unlink --global @bymax-one/nest-auth) || true

if [[ -n "${LIB_DIR}" && -d "${LIB_DIR}" ]]; then
  echo "==> Removing global registration from ${LIB_DIR}"
  (cd "${LIB_DIR}" && pnpm unlink --global) || true
fi

echo "==> Reminder: run 'pnpm install' to restore the published dependency."
