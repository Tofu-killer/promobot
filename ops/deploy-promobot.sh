#!/usr/bin/env bash
set -euo pipefail

SMOKE_RETRY_ATTEMPTS=10
SMOKE_RETRY_DELAY_SECONDS=3
PNPM_CMD=""

log() {
  printf '[deploy-promobot] %s\n' "$*"
}

fail() {
  printf '[deploy-promobot] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ops/deploy-promobot.sh [options]

Runs install, build, PM2 reload/start, and an optional smoke check from the repo root.

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

The script also reads repo-root .env for PORT, PROMOBOT_ADMIN_PASSWORD, and ADMIN_PASSWORD when present.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

resolve_pnpm_command() {
  if command -v pnpm >/dev/null 2>&1; then
    printf 'pnpm'
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    printf 'corepack pnpm'
    return 0
  fi

  fail "Missing required command: pnpm (or corepack)"
}

generate_admin_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return 0
  fi

  node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))'
}

initialize_env_file_if_missing() {
  local env_file="$1"
  local env_example_file="$2"
  local generated_password

  [ -f "$env_file" ] && return 0
  [ -f "$env_example_file" ] || return 0

  log "Initializing repo-root .env from .env.example"
  cp "$env_example_file" "$env_file"

  if grep -q '^ADMIN_PASSWORD=change-me$' "$env_file"; then
    generated_password="$(generate_admin_password)"
    perl -0pi -e "s/^ADMIN_PASSWORD=change-me\$/ADMIN_PASSWORD=${generated_password}/m" "$env_file"
    log "Generated ADMIN_PASSWORD in ${env_file}"
  fi
}

run_pm2() {
  ${PNPM_CMD} exec pm2 "$@"
}

ensure_pm2_available() {
  if ! ${PNPM_CMD} exec pm2 --version >/dev/null 2>&1; then
    fail "Local pm2 is unavailable; run pnpm install --frozen-lockfile before starting the source checkout"
  fi
}

pm2_process_exists() {
  run_pm2 jlist | grep -q '"name":"promobot"'
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
  local repo_root
  local env_file
  local env_example_file
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
          --*) fail "--base-url requires a value" ;;
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
          --*) fail "--admin-password requires a value" ;;
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
  repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"
  env_file="${repo_root}/.env"
  env_example_file="${repo_root}/.env.example"

  cd "${repo_root}"

  [ -f "package.json" ] || fail "package.json not found in ${repo_root}"
  [ -f "pnpm-lock.yaml" ] || fail "pnpm-lock.yaml not found in ${repo_root}"
  [ -f "pm2.config.js" ] || fail "pm2.config.js not found in ${repo_root}"
  [ -f "src/server/index.ts" ] || fail "src/server/index.ts not found in ${repo_root}"

  if [ -z "$base_url" ]; then
    base_url="${PROMOBOT_BASE_URL:-}"
    if [ -z "$base_url" ]; then
      resolved_port="${PORT:-$(read_env_file_value "$env_file" PORT 2>/dev/null || true)}"
      resolved_port="${resolved_port:-3001}"
      base_url="http://127.0.0.1:${resolved_port}"
    fi
  fi

  if [ -z "$admin_password" ]; then
    admin_password="${PROMOBOT_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
  fi

  if [ -z "$admin_password" ]; then
    admin_password="$(read_env_file_value "$env_file" PROMOBOT_ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  if [ -z "$admin_password" ]; then
    admin_password="$(read_env_file_value "$env_file" ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  require_command node
  PNPM_CMD="$(resolve_pnpm_command)"
  initialize_env_file_if_missing "${env_file}" "${env_example_file}"

  if [ -z "$admin_password" ]; then
    admin_password="$(read_env_file_value "$env_file" PROMOBOT_ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  if [ -z "$admin_password" ]; then
    admin_password="$(read_env_file_value "$env_file" ADMIN_PASSWORD 2>/dev/null || true)"
  fi

  if [ -n "${admin_password}" ] && [ -z "${ADMIN_PASSWORD:-}" ]; then
    export ADMIN_PASSWORD="${admin_password}"
  fi

  if [ "$skip_smoke" -eq 0 ] && [ -z "$admin_password" ]; then
    fail "Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, or repo-root .env ADMIN_PASSWORD; use --skip-smoke to disable it"
  fi

  log "Ensuring logs/ and data/ directories exist"
  mkdir -p logs data

  if [ "$skip_install" -eq 0 ]; then
    log "Running pnpm install --frozen-lockfile"
    ${PNPM_CMD} install --frozen-lockfile
  else
    log "Skipping pnpm install"
  fi

  log "Running pnpm build"
  ${PNPM_CMD} build

  ensure_pm2_available

  if pm2_process_exists; then
    log "Reloading PM2 app from pm2.config.js"
    if ! run_pm2 reload pm2.config.js --update-env; then
      log "PM2 reload failed, trying a fresh start"
      run_pm2 start pm2.config.js --update-env
    fi
  else
    log "Starting PM2 app from pm2.config.js"
    run_pm2 start pm2.config.js --update-env
  fi

  if [ "$skip_smoke" -eq 1 ]; then
    log "Skipping smoke check"
    return 0
  fi

  attempt=1
  while true; do
    log "Running smoke check against ${base_url} (attempt ${attempt}/${SMOKE_RETRY_ATTEMPTS})"
    if PROMOBOT_ADMIN_PASSWORD="${admin_password}" ${PNPM_CMD} smoke:server -- --base-url "${base_url}"; then
      break
    fi

    if [ "${attempt}" -ge "${SMOKE_RETRY_ATTEMPTS}" ]; then
      fail "Smoke check failed after ${SMOKE_RETRY_ATTEMPTS} attempts"
    fi

    attempt=$((attempt + 1))
    log "Smoke check failed; retrying in ${SMOKE_RETRY_DELAY_SECONDS}s"
    sleep "${SMOKE_RETRY_DELAY_SECONDS}"
  done

  log "Deployment completed"
}

main "$@"
