#!/usr/bin/env bash
# link-library.sh — Build @bymax-one/nest-auth from a sibling checkout and
# register it as a pnpm global link, then link it into this workspace.
#
# Idempotent: safe to re-run without side effects.
# Prerequisite: ../nest-auth must exist with a valid pnpm project.
set -euo pipefail

# Prevent accidental execution in automated pipelines — CI should consume the
# published npm package, not a local sibling checkout.
if [[ "${CI:-}" == "true" ]]; then
  echo "error: link-library.sh must not run in CI — use the published npm package" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "${HERE}/../nest-auth" 2>/dev/null && pwd || true)"

if [[ -z "${LIB_DIR}" || ! -d "${LIB_DIR}" ]]; then
  echo "error: expected library checkout at ${HERE}/../nest-auth" >&2
  echo "       clone https://github.com/bymaxone/nest-auth next to this repo" >&2
  exit 1
fi

echo "==> Building library at ${LIB_DIR}"
# --frozen-lockfile=false intentional: sibling checkout may not have a committed
# lockfile yet (in-progress development). Never use this flag in CI pipelines.
(cd "${LIB_DIR}" && pnpm install --frozen-lockfile=false && pnpm build)

echo "==> Registering global pnpm link"
(cd "${LIB_DIR}" && pnpm link --global)

echo "==> Linking @bymax-one/nest-auth into $(basename "${HERE}")"
(cd "${HERE}" && pnpm link --global @bymax-one/nest-auth)

echo "==> Resolved path:"
# --input-type=commonjs forces CJS eval context so require.resolve is available
# regardless of the workspace "type":"module" setting.
(cd "${HERE}" && node --input-type=commonjs -e "console.log(require.resolve('@bymax-one/nest-auth'))")
