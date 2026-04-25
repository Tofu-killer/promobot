#!/usr/bin/env bash
set -euo pipefail

SMOKE_RETRY_ATTEMPTS=10
SMOKE_RETRY_DELAY_SECONDS=3

log() {
  printf '[deploy-release] %s\n' "$*"
}

fail() {
  printf '[deploy-release] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ops/deploy-release.sh [options]

Deploy directly from a release bundle directory.

Options:
  --skip-install               Skip pnpm install --frozen-lockfile
  --skip-smoke                 Skip the smoke check
  --base-url <url>             Smoke check base URL (default: PROMOBOT_BASE_URL or http://127.0.0.1:<PORT>)
  --admin-password <secret>    Smoke check admin password
  --help, -h                   Show this help

Environment:
  PROMOBOT_BASE_URL            Default base URL when --base-url is not provided
  PROMOBOT_ADMIN_PASSWORD      Overrides the smoke-check password
  ADMIN_PASSWORD               Also accepted for the smoke-check password
  PORT                         Used to build the default local base URL

The script also reads bundle-root .env for PORT, PROMOBOT_ADMIN_PASSWORD,
and ADMIN_PASSWORD when present.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

pm2_process_exists() {
  pm2 jlist | grep -q '"name":"promobot"'
}

read_env_file_value() {
  local env_file="$1"
  local key="$2"
  local line value

  [ -f "$env_file" ] || return 1

  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    [ -n "$line" ] || continue
    case "$line" in
      \#*) continue ;;
      export\ *) line="${line#export }" ;;
    esac

    case "$line" in
      "${key}"=*)
        value="${line#*=}"
        value="${value%"${value##*[![:space:]]}"}"
        if [ "${#value}" -ge 2 ]; then
          case "${value}" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
          esac
        fi
        printf '%s' "$value"
        return 0
        ;;
    esac
  done <"$env_file"

  return 1
}

main() {
  local skip_install=0
  local skip_smoke=0
  local base_url=""
  local admin_password=""
  local script_dir
  local bundle_root
  local env_file
  local resolved_port
  local attempt

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        ;;
      --skip-install)
        skip_install=1
        shift
        ;;
      --skip-smoke)
        skip_smoke=1
        shift
        ;;
      --base-url)
        [ "$#" -ge 2 ] || fail "--base-url requires a value"
        case "$2" in
          ""|--*) fail "--base-url requires a value" ;;
        esac
        base_url="$2"
        shift 2
        ;;
      --base-url=*)
        base_url="${1#*=}"
        [ -n "$base_url" ] || fail "--base-url requires a value"
        shift
        ;;
      --admin-password)
        [ "$#" -ge 2 ] || fail "--admin-password requires a value"
        case "$2" in
          ""|--*) fail "--admin-password requires a value" ;;
        esac
        admin_password="$2"
        shift 2
        ;;
      --admin-password=*)
        admin_password="${1#*=}"
        [ -n "$admin_password" ] || fail "--admin-password requires a value"
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
  bundle_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"
  env_file="${bundle_root}/.env"

  cd "${bundle_root}"

  [ -f "package.json" ] || fail "package.json not found in ${bundle_root}"
  [ -f "pnpm-lock.yaml" ] || fail "pnpm-lock.yaml not found in ${bundle_root}"
  [ -f "pm2.config.js" ] || fail "pm2.config.js not found in ${bundle_root}"
  [ -f "dist/server/index.js" ] || fail "dist/server/index.js not found in ${bundle_root}"
  [ -f "dist/client/index.html" ] || fail "dist/client/index.html not found in ${bundle_root}"
  [ -f "dist/server/cli/deploymentSmoke.js" ] || fail "dist/server/cli/deploymentSmoke.js not found in ${bundle_root}"
  [ -f "dist/server/cli/releaseVerify.js" ] || fail "dist/server/cli/releaseVerify.js not found in ${bundle_root}"

  require_command pnpm
  require_command pm2
  require_command node

  log "Verifying release bundle integrity"
  node dist/server/cli/releaseVerify.js --input-dir "${bundle_root}"

  if [ "${skip_install}" -eq 0 ]; then
    log "Running pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile
  else
    log "Skipping pnpm install"
  fi

  if [ -z "${admin_password}" ]; then
    admin_password="${PROMOBOT_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
  fi

  if [ -z "${admin_password}" ]; then
    admin_password="$(read_env_file_value "${env_file}" PROMOBOT_ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  if [ -z "${admin_password}" ]; then
    admin_password="$(read_env_file_value "${env_file}" ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  if [ -n "${admin_password}" ] && [ -z "${ADMIN_PASSWORD:-}" ]; then
    export ADMIN_PASSWORD="${admin_password}"
  fi

  if pm2_process_exists; then
    log "Reloading PM2 app from pm2.config.js"
    if ! pm2 reload pm2.config.js --update-env; then
      log "PM2 reload failed, trying a fresh start"
      pm2 start pm2.config.js --update-env
    fi
  else
    log "Starting PM2 app from pm2.config.js"
    pm2 start pm2.config.js --update-env
  fi

  if [ "${skip_smoke}" -eq 1 ]; then
    log "Skipping smoke check"
    return 0
  fi

  if [ -z "${base_url}" ]; then
    base_url="${PROMOBOT_BASE_URL:-}"
    if [ -z "${base_url}" ]; then
      resolved_port="${PORT:-$(read_env_file_value "${env_file}" PORT 2>/dev/null || true)}"
      resolved_port="${resolved_port:-3001}"
      base_url="http://127.0.0.1:${resolved_port}"
    fi
  fi

  if [ -z "${admin_password}" ]; then
    fail "Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, or bundle-root .env"
  fi

  attempt=1
  while true; do
    log "Running smoke check against ${base_url} (attempt ${attempt}/${SMOKE_RETRY_ATTEMPTS})"
    if PROMOBOT_ADMIN_PASSWORD="${admin_password}" node dist/server/cli/deploymentSmoke.js --base-url "${base_url}"; then
      break
    fi

    if [ "${attempt}" -ge "${SMOKE_RETRY_ATTEMPTS}" ]; then
      fail "Smoke check failed after ${SMOKE_RETRY_ATTEMPTS} attempts"
    fi

    attempt=$((attempt + 1))
    log "Smoke check failed; retrying in ${SMOKE_RETRY_DELAY_SECONDS}s"
    sleep "${SMOKE_RETRY_DELAY_SECONDS}"
  done

  log "Release deployment completed"
}

main "$@"
