#!/usr/bin/env bash
set -euo pipefail

CHECKSUM_CREATE_CMD=()

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

Runs pnpm build by default, then packages a local release bundle from the repository root.
Also writes a tar.gz archive, .sha256 checksum sidecar, .metadata.json sidecar, and verify-downloaded-release.sh helper next to the bundle output.
Self-verifies the generated archive with the staged helper before exiting.

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

select_checksum_generator() {
  if command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM_CREATE_CMD=(sha256sum)
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    CHECKSUM_CREATE_CMD=(shasum -a 256)
    return 0
  fi

  fail "Missing required command: sha256sum or shasum"
}

write_release_metadata() {
  local metadata_path="$1"
  local repo_root="$2"
  local artifact_name="$3"
  local asset_basename="$4"
  local helper_file="$5"
  local archive_file="$6"
  local checksum_file="$7"
  local bundle_dir_name="$8"
  local generated_at="$9"

  METADATA_PATH="$metadata_path" \
  REPO_ROOT="$repo_root" \
  ARTIFACT_NAME="$artifact_name" \
  ASSET_BASENAME="$asset_basename" \
  HELPER_FILE="$helper_file" \
  ARCHIVE_FILE="$archive_file" \
  CHECKSUM_FILE="$checksum_file" \
  BUNDLE_DIR_NAME="$bundle_dir_name" \
  GENERATED_AT="$generated_at" \
  node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const metadataPath = process.env.METADATA_PATH;
const archiveFile = process.env.ARCHIVE_FILE;
const checksumFile = process.env.CHECKSUM_FILE;
const metadataFile = path.basename(metadataPath);
const metadata = {
  schema_version: 1,
  artifact_name: process.env.ARTIFACT_NAME,
  asset_basename: process.env.ASSET_BASENAME,
  helper_file: process.env.HELPER_FILE,
  event_name: 'local_release',
  ref: null,
  ref_name: path.basename(process.env.REPO_ROOT),
  ref_type: 'local',
  tag: null,
  prerelease: false,
  commit_sha: null,
  test_execution: {
    state: 'not_run',
    mode: 'local_release',
    summary: 'not run by ops/release-promobot.sh',
  },
  archive_file: archiveFile,
  archive_format: 'tar.gz',
  checksum_file: checksumFile,
  checksum_algorithm: 'sha256',
  metadata_file: metadataFile,
  assets: [
    { kind: 'archive', name: archiveFile },
    { kind: 'checksum', name: checksumFile },
    { kind: 'metadata', name: metadataFile },
  ],
  bundle_dir_name: process.env.BUNDLE_DIR_NAME,
  generated_at: process.env.GENERATED_AT,
  run_url: null,
  release_url: null,
};

fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
EOF
}

main() {
  local output_dir="release"
  local skip_build=0
  local bundle_dir=""
  local bundle_dir_name=""
  local artifact_dir=""
  local asset_basename=""
  local artifact_name=""
  local archive_path=""
  local checksum_path=""
  local metadata_path=""
  local helper_path=""
  local generated_at=""
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
  require_command node
  require_command tar
  select_checksum_generator

  if [ "${skip_build}" -eq 0 ]; then
    log "Running pnpm build"
    pnpm build
  else
    log "Skipping pnpm build"
  fi

  [ -f "dist/server/cli/releaseBundle.js" ] || fail "dist/server/cli/releaseBundle.js not found; run pnpm build first"

  log "Running node dist/server/cli/releaseBundle.js --output-dir ${output_dir}"
  node dist/server/cli/releaseBundle.js --output-dir "${output_dir}"

  bundle_dir="$(cd -- "${output_dir}" >/dev/null 2>&1 && pwd)"
  bundle_dir_name="$(basename -- "${bundle_dir}")"
  artifact_dir="$(cd -- "$(dirname -- "${bundle_dir}")" >/dev/null 2>&1 && pwd)"
  asset_basename="${bundle_dir_name}"
  artifact_name="${asset_basename}-artifact"
  archive_path="${artifact_dir}/${asset_basename}.tar.gz"
  checksum_path="${archive_path}.sha256"
  metadata_path="${archive_path}.metadata.json"
  helper_path="${artifact_dir}/verify-downloaded-release.sh"
  generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  rm -f "${archive_path}" "${checksum_path}" "${metadata_path}" "${helper_path}"

  log "Creating release archive ${archive_path}"
  tar -czf "${archive_path}" -C "${artifact_dir}" "${bundle_dir_name}"

  log "Writing release checksum sidecar ${checksum_path}"
  (
    cd -- "${artifact_dir}"
    "${CHECKSUM_CREATE_CMD[@]}" "$(basename -- "${archive_path}")" > "$(basename -- "${checksum_path}")"
  )

  log "Writing release metadata sidecar ${metadata_path}"
  write_release_metadata \
    "${metadata_path}" \
    "${repo_root}" \
    "${artifact_name}" \
    "${asset_basename}" \
    "$(basename -- "${helper_path}")" \
    "$(basename -- "${archive_path}")" \
    "$(basename -- "${checksum_path}")" \
    "${bundle_dir_name}" \
    "${generated_at}"

  log "Staging standalone downloaded release helper ${helper_path}"
  cp "ops/verify-downloaded-release.sh" "${helper_path}"
  chmod +x "${helper_path}"
  bash -n "${helper_path}"

  log "Self-verifying downloaded release archive ${archive_path}"
  bash "${helper_path}" \
    --archive-file "${archive_path}" \
    --checksum-file "${checksum_path}" \
    --metadata-file "${metadata_path}"
}

main "$@"
