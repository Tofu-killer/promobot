#!/usr/bin/env bash
set -euo pipefail

SMOKE_RETRY_ATTEMPTS=10
SMOKE_RETRY_DELAY_SECONDS=3

log() {
  printf '[rollback-promobot] %s\n' "$*"
}

fail() {
  printf '[rollback-promobot] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ops/rollback-promobot.sh --backup-dir <path> [options]

Restore runtime data from an existing backup directory, reload/start PM2,
and run an optional smoke check from the repo root.

Options:
  --backup-dir <path>          Existing runtime backup directory to restore from
  --skip-smoke                 Skip the smoke check
  --skip-env                   Forward --skip-env to runtime:restore
  --base-url <url>             Smoke check base URL (default: PROMOBOT_BASE_URL or http://127.0.0.1:<PORT>)
  --admin-password <secret>    Smoke check admin password
  --help, -h                   Show this help

Environment:
  PROMOBOT_BASE_URL            Default base URL when --base-url is not provided
  PROMOBOT_ADMIN_PASSWORD      Overrides the smoke-check password
  ADMIN_PASSWORD               Also accepted for the smoke-check password
  PORT                         Used to build the default local base URL

The script also reads shell/.env and repo-root .env for PORT,
PROMOBOT_ADMIN_PASSWORD, and ADMIN_PASSWORD when present.
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

read_first_env_file_value() {
  local key="$1"
  shift

  local env_file value
  for env_file in "$@"; do
    [ -n "$env_file" ] || continue
    value="$(read_env_file_value "$env_file" "$key" 2>/dev/null || true)"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return 0
    fi
  done

  return 1
}

main() {
  local backup_dir=""
  local skip_smoke=0
  local skip_env=0
  local base_url=""
  local admin_password=""
  local script_dir
  local repo_root
  local shell_env_file
  local root_env_file
  local resolved_port
  local attempt
  local use_source_restore=0
  local use_source_smoke=0
  local use_compiled_restore=0
  local use_compiled_smoke=0
  local env_candidates=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        ;;
      --backup-dir)
        [ "$#" -ge 2 ] || fail "--backup-dir requires a value"
        case "$2" in
          --*) fail "--backup-dir requires a value" ;;
        esac
        backup_dir="$2"
        shift 2
        ;;
      --backup-dir=*)
        backup_dir="${1#*=}"
        [ -n "$backup_dir" ] || fail "--backup-dir requires a value"
        shift
        ;;
      --skip-smoke)
        skip_smoke=1
        shift
        ;;
      --skip-env)
        skip_env=1
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

  [ -n "$backup_dir" ] || fail "--backup-dir is required"
  [ -d "$backup_dir" ] || fail "Backup directory not found: $backup_dir"

  backup_dir="$(cd -- "$backup_dir" >/dev/null 2>&1 && pwd)" \
    || fail "Unable to resolve backup directory: $backup_dir"

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"
  shell_env_file="${repo_root}/shell/.env"
  root_env_file="${repo_root}/.env"
  env_candidates=("${shell_env_file}" "${root_env_file}")

  cd "${repo_root}"

  [ -f "package.json" ] || fail "package.json not found in ${repo_root}"
  [ -f "pm2.config.js" ] || fail "pm2.config.js not found in ${repo_root}"

  if [ -f "src/server/cli/runtimeRestore.ts" ]; then
    use_source_restore=1
  elif [ -f "dist/server/cli/runtimeRestore.js" ]; then
    use_compiled_restore=1
  else
    fail "Could not find src/server/cli/runtimeRestore.ts or dist/server/cli/runtimeRestore.js in ${repo_root}"
  fi

  if [ -f "src/server/cli/deploymentSmoke.ts" ]; then
    use_source_smoke=1
  elif [ -f "dist/server/cli/deploymentSmoke.js" ]; then
    use_compiled_smoke=1
  fi

  if [ "${use_source_restore}" -eq 1 ] || [ "${use_source_smoke}" -eq 1 ]; then
    require_command pnpm
  fi

  if [ "${use_compiled_restore}" -eq 1 ] || [ "${use_compiled_smoke}" -eq 1 ]; then
    require_command node
  fi

  require_command pm2

  if [ ! -f "${backup_dir}/manifest.json" ]; then
    log "Backup manifest not found at ${backup_dir}/manifest.json; continuing because runtime:restore performs authoritative validation"
  fi

  if pm2_process_exists; then
    log "Stopping PM2 app before restore"
    pm2 stop promobot >/dev/null
  fi

  log "Restoring runtime data from ${backup_dir}"
  if [ "${use_source_restore}" -eq 1 ]; then
    if [ "$skip_env" -eq 1 ]; then
      pnpm runtime:restore -- --input-dir "${backup_dir}" --skip-env
    else
      pnpm runtime:restore -- --input-dir "${backup_dir}"
    fi
  else
    if [ "$skip_env" -eq 1 ]; then
      node dist/server/cli/runtimeRestore.js --input-dir "${backup_dir}" --skip-env
    else
      node dist/server/cli/runtimeRestore.js --input-dir "${backup_dir}"
    fi
  fi

  if [ "$skip_smoke" -eq 1 ]; then
    if pm2_process_exists; then
      log "Restarting PM2 app from existing process definition"
      pm2 restart promobot --update-env || pm2 start pm2.config.js --update-env
    else
      log "Starting PM2 app from pm2.config.js"
      pm2 start pm2.config.js --update-env
    fi
    log "Skipping smoke check"
    return 0
  fi

  if [ -z "$base_url" ]; then
    base_url="${PROMOBOT_BASE_URL:-}"
    if [ -z "$base_url" ]; then
      resolved_port="${PORT:-}"
      if [ -z "$resolved_port" ]; then
        resolved_port="$(read_first_env_file_value PORT "${env_candidates[@]}" 2>/dev/null || true)"
      fi
      resolved_port="${resolved_port:-3001}"
      base_url="http://127.0.0.1:${resolved_port}"
    fi
  fi

  if [ -z "$admin_password" ]; then
    admin_password="${PROMOBOT_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
  fi

  if [ -z "$admin_password" ]; then
    admin_password="$(read_first_env_file_value PROMOBOT_ADMIN_PASSWORD "${env_candidates[@]}" 2>/dev/null || true)"
  fi

  if [ -z "$admin_password" ]; then
    admin_password="$(read_first_env_file_value ADMIN_PASSWORD "${env_candidates[@]}" 2>/dev/null || true)"
  fi

  if [ -z "$admin_password" ]; then
    fail "Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, shell/.env, or repo-root .env; use --skip-smoke to disable it"
  fi

  if pm2_process_exists; then
    log "Restarting PM2 app from existing process definition"
    pm2 restart promobot --update-env || pm2 start pm2.config.js --update-env
  else
    log "Starting PM2 app from pm2.config.js"
    pm2 start pm2.config.js --update-env
  fi

  attempt=1
  while true; do
    log "Running smoke check against ${base_url} (attempt ${attempt}/${SMOKE_RETRY_ATTEMPTS})"
    if [ "${use_source_smoke}" -eq 1 ]; then
      if PROMOBOT_ADMIN_PASSWORD="${admin_password}" pnpm smoke:server -- --base-url "${base_url}"; then
        break
      fi
    elif [ "${use_compiled_smoke}" -eq 1 ]; then
      if PROMOBOT_ADMIN_PASSWORD="${admin_password}" node dist/server/cli/deploymentSmoke.js --base-url "${base_url}"; then
        break
      fi
    else
      fail "Could not find src/server/cli/deploymentSmoke.ts or dist/server/cli/deploymentSmoke.js in ${repo_root}"
    fi

    if [ "${attempt}" -ge "${SMOKE_RETRY_ATTEMPTS}" ]; then
      fail "Smoke check failed after ${SMOKE_RETRY_ATTEMPTS} attempts"
    fi

    attempt=$((attempt + 1))
    log "Smoke check failed; retrying in ${SMOKE_RETRY_DELAY_SECONDS}s"
    sleep "${SMOKE_RETRY_DELAY_SECONDS}"
  done

  log "Rollback completed"
}

main "$@"
