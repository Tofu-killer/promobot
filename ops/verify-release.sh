#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[verify-release] %s\n' "$*"
}

fail() {
  printf '[verify-release] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ops/verify-release.sh --input-dir <path> [options]

Runs release verification from either a source checkout or an extracted bundle root.
By default this only runs release verification. It does not start services
or make network requests unless --smoke is explicitly enabled after verification succeeds.

Options:
  --input-dir <path>          Release input directory to verify (required)
  --smoke                     Run a smoke check after release verification succeeds.
                              Requires src/server/cli/deploymentSmoke.ts or
                              dist/server/cli/deploymentSmoke.js when enabled.
  --base-url <url>            Smoke check base URL (default: PROMOBOT_BASE_URL or http://127.0.0.1:<PORT>)
  --admin-password <secret>   Smoke check admin password
  --help, -h                  Show this help

Environment:
  PROMOBOT_BASE_URL            Default base URL when --base-url is not provided
  PROMOBOT_ADMIN_PASSWORD      Overrides the smoke-check password
  ADMIN_PASSWORD               Also accepted for the smoke-check password
  PORT                         Used to build the default local base URL

The script also reads shell/.env and repo-root .env for PORT,
PROMOBOT_ADMIN_PASSWORD, and ADMIN_PASSWORD when present.

Examples:
  bash ops/verify-release.sh --input-dir release/candidate
  bash ops/verify-release.sh --input-dir /tmp/promobot-release --smoke --base-url http://127.0.0.1:3001
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
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
  local input_dir=""
  local run_smoke=0
  local base_url=""
  local admin_password=""
  local script_dir
  local repo_root
  local shell_env_file
  local root_env_file
  local resolved_port
  local use_source_verify=0
  local use_source_smoke=0
  local use_compiled_verify=0
  local use_compiled_smoke=0
  local -a env_candidates=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        if [ "$#" -gt 0 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; } && [ -z "$input_dir" ]; then
          usage
          exit 0
        fi
        if [ -z "$input_dir" ]; then
          continue
        fi
        fail "Unknown argument: --"
        ;;
      --input-dir)
        [ "$#" -ge 2 ] || fail "--input-dir requires a value"
        case "$2" in
          ""|--*) fail "--input-dir requires a value" ;;
        esac
        input_dir="$2"
        shift 2
        ;;
      --input-dir=*)
        input_dir="${1#*=}"
        [ -n "$input_dir" ] || fail "--input-dir requires a value"
        shift
        ;;
      --smoke)
        run_smoke=1
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

  [ -n "$input_dir" ] || fail "--input-dir is required"

  if [ "${run_smoke}" -eq 0 ]; then
    [ -z "$base_url" ] || fail "--base-url requires --smoke"
    [ -z "$admin_password" ] || fail "--admin-password requires --smoke"
  fi

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"
  shell_env_file="${repo_root}/shell/.env"
  root_env_file="${repo_root}/.env"
  env_candidates=("${shell_env_file}" "${root_env_file}")

  cd "${repo_root}"

  [ -f "package.json" ] || fail "package.json not found in ${repo_root}"
  [ -d "${input_dir}" ] || fail "--input-dir directory not found: ${input_dir}"

  if [ -f "src/server/cli/releaseVerify.ts" ]; then
    use_source_verify=1
  elif [ -f "dist/server/cli/releaseVerify.js" ]; then
    use_compiled_verify=1
  else
    fail "Could not find src/server/cli/releaseVerify.ts or dist/server/cli/releaseVerify.js in ${repo_root}"
  fi

  if [ -f "src/server/cli/deploymentSmoke.ts" ]; then
    use_source_smoke=1
  elif [ -f "dist/server/cli/deploymentSmoke.js" ]; then
    use_compiled_smoke=1
  fi

  if [ "${use_source_verify}" -eq 1 ] || [ "${use_source_smoke}" -eq 1 ]; then
    require_command pnpm
  fi

  if [ "${use_compiled_verify}" -eq 1 ] || [ "${use_compiled_smoke}" -eq 1 ]; then
    require_command node
  fi

  if [ "${use_source_verify}" -eq 1 ]; then
    log "Running pnpm release:verify with --input-dir ${input_dir}"
    pnpm release:verify -- --input-dir "${input_dir}"
  else
    log "Running node dist/server/cli/releaseVerify.js with --input-dir ${input_dir}"
    node dist/server/cli/releaseVerify.js --input-dir "${input_dir}"
  fi

  if [ "${run_smoke}" -eq 1 ]; then
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
      fail "Smoke check requires --admin-password, PROMOBOT_ADMIN_PASSWORD, ADMIN_PASSWORD, shell/.env, or repo-root .env"
    fi

    log "Running smoke check against ${base_url}"
    if [ "${use_source_smoke}" -eq 1 ]; then
      PROMOBOT_ADMIN_PASSWORD="${admin_password}" pnpm smoke:server -- --base-url "${base_url}"
    elif [ "${use_compiled_smoke}" -eq 1 ]; then
      PROMOBOT_ADMIN_PASSWORD="${admin_password}" node dist/server/cli/deploymentSmoke.js --base-url "${base_url}"
    else
      fail "--smoke requires src/server/cli/deploymentSmoke.ts or dist/server/cli/deploymentSmoke.js in ${repo_root}"
    fi
  fi
}

main "$@"
