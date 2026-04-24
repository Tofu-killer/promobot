#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[release-promobot] %s\n' "$*"
}

fail() {
  printf '[release-promobot] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ops/release-promobot.sh [options]

Runs the release packaging flow from the repository root.

Options:
  --output-dir <path>          Release output directory (default: release)
  --skip-build                 Skip pnpm build
  --help, -h                   Show this help

Examples:
  bash ops/release-promobot.sh
  bash ops/release-promobot.sh --output-dir release/candidate
  bash ops/release-promobot.sh -- --skip-build --output-dir /tmp/promobot-release
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

main() {
  local output_dir="release"
  local skip_build=0
  local script_dir
  local repo_root

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        ;;
      --output-dir)
        [ "$#" -ge 2 ] || fail "--output-dir requires a value"
        case "$2" in
          ""|--*)
            fail "--output-dir requires a value"
            ;;
        esac
        output_dir="$2"
        shift 2
        ;;
      --output-dir=*)
        output_dir="${1#*=}"
        [ -n "$output_dir" ] || fail "--output-dir requires a value"
        shift
        ;;
      --skip-build)
        skip_build=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"

  cd "${repo_root}"

  [ -f "package.json" ] || fail "package.json not found in ${repo_root}"
  require_command pnpm

  if [ "${skip_build}" -eq 0 ]; then
    log "Running pnpm build"
    pnpm build
  else
    log "Skipping pnpm build"
  fi

  [ -f "dist/server/cli/releaseBundle.js" ] || fail "dist/server/cli/releaseBundle.js not found; run pnpm build first"

  log "Running node dist/server/cli/releaseBundle.js --output-dir ${output_dir}"
  node dist/server/cli/releaseBundle.js --output-dir "${output_dir}"
}

main "$@"
