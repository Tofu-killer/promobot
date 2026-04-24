#!/usr/bin/env bash
set -euo pipefail

CHECKSUM_VERIFY_CMD=()

log() {
  printf '[verify-downloaded-release] %s\n' "$*"
}

fail() {
  printf '[verify-downloaded-release] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ops/verify-downloaded-release.sh --archive <path> [options]

Verify a downloaded release archive together with its .sha256 and .metadata.json
sidecars, extract the bundle into a temporary directory, then hand the extracted
bundle directory to the bundled releaseVerify CLI.

Options:
  --archive <path>            Downloaded release archive to verify (required)
  --archive-file <path>       Alias for --archive
  --checksum-file <path>      Checksum sidecar path (default: <archive>.sha256)
  --metadata-file <path>      Metadata sidecar path (default: <archive>.metadata.json)
  --extract-root <path>       Parent directory for temporary extraction
                              (default: $TMPDIR or /tmp)
  --extract-to <path>         Alias for --extract-root
  --keep-extracted            Keep the extracted directory instead of cleaning it up
  --help, -h                  Show this help

The script never downloads files or performs network verification. It only
checks local files and then reuses the extracted bundle's releaseVerify CLI
for directory validation.

Examples:
  bash ops/verify-downloaded-release.sh --archive /tmp/promobot-v1.2.3.tar.gz
  bash ops/verify-downloaded-release.sh --archive /tmp/promobot-preview.demo.tar.gz --keep-extracted
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

resolve_existing_path() {
  local input_path="$1"
  local parent_dir

  parent_dir="$(cd -- "$(dirname -- "$input_path")" >/dev/null 2>&1 && pwd -P)" || return 1
  printf '%s/%s' "$parent_dir" "$(basename -- "$input_path")"
}

select_checksum_verifier() {
  if command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM_VERIFY_CMD=(sha256sum -c)
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    CHECKSUM_VERIFY_CMD=(shasum -a 256 -c)
    return 0
  fi

  fail "Missing required command: sha256sum or shasum"
}

validate_metadata_and_print_bundle_dir() {
  local archive_basename="$1"
  local checksum_basename="$2"
  local metadata_basename="$3"
  local metadata_path="$4"

  ARCHIVE_BASENAME="$archive_basename" \
  CHECKSUM_BASENAME="$checksum_basename" \
  METADATA_BASENAME="$metadata_basename" \
  METADATA_PATH="$metadata_path" \
  node <<'EOF'
const fs = require('node:fs');

const expectedSchemaVersion = 1;
const expectedArchiveFormat = 'tar.gz';
const expectedChecksumAlgorithm = 'sha256';
const metadata = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, 'utf8'));

if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
  throw new Error('metadata sidecar must be a JSON object');
}

if (metadata.schema_version !== expectedSchemaVersion) {
  throw new Error(
    `unsupported metadata schema_version: ${metadata.schema_version} !== ${expectedSchemaVersion}`,
  );
}

if (metadata.archive_format !== expectedArchiveFormat) {
  throw new Error(
    `unsupported archive_format: ${metadata.archive_format} !== ${expectedArchiveFormat}`,
  );
}

if (metadata.checksum_algorithm !== expectedChecksumAlgorithm) {
  throw new Error(
    `unsupported checksum_algorithm: ${metadata.checksum_algorithm} !== ${expectedChecksumAlgorithm}`,
  );
}

if (metadata.archive_file !== process.env.ARCHIVE_BASENAME) {
  throw new Error(
    `metadata archive_file mismatch: ${metadata.archive_file} !== ${process.env.ARCHIVE_BASENAME}`,
  );
}

if (metadata.checksum_file !== process.env.CHECKSUM_BASENAME) {
  throw new Error(
    `metadata checksum_file mismatch: ${metadata.checksum_file} !== ${process.env.CHECKSUM_BASENAME}`,
  );
}

if (metadata.metadata_file !== process.env.METADATA_BASENAME) {
  throw new Error(
    `metadata metadata_file mismatch: ${metadata.metadata_file} !== ${process.env.METADATA_BASENAME}`,
  );
}

if (typeof metadata.bundle_dir_name !== 'string' || metadata.bundle_dir_name.trim() === '') {
  throw new Error('metadata bundle_dir_name must be a non-empty string');
}

if (
  metadata.bundle_dir_name === '.' ||
  metadata.bundle_dir_name === '..' ||
  metadata.bundle_dir_name.includes('/')
) {
  throw new Error(`unsafe metadata bundle_dir_name: ${metadata.bundle_dir_name}`);
}

if (!Array.isArray(metadata.assets) || metadata.assets.length !== 3) {
  throw new Error('metadata.assets must be the ordered archive/checksum/metadata list');
}

const expectedAssets = [
  { kind: 'archive', name: process.env.ARCHIVE_BASENAME },
  { kind: 'checksum', name: process.env.CHECKSUM_BASENAME },
  { kind: 'metadata', name: process.env.METADATA_BASENAME },
];

for (const [index, expectedAsset] of expectedAssets.entries()) {
  const actualAsset = metadata.assets[index];
  if (!actualAsset || typeof actualAsset !== 'object' || Array.isArray(actualAsset)) {
    throw new Error(`metadata.assets[${index}] must be an object`);
  }
  if (actualAsset.kind !== expectedAsset.kind) {
    throw new Error(
      `metadata.assets[${index}].kind mismatch: ${actualAsset.kind} !== ${expectedAsset.kind}`,
    );
  }
  if (actualAsset.name !== expectedAsset.name) {
    throw new Error(
      `metadata.assets[${index}].name mismatch: ${actualAsset.name} !== ${expectedAsset.name}`,
    );
  }
}

process.stdout.write(`${metadata.bundle_dir_name}\n`);
EOF
}

cleanup() {
  local exit_code="$1"

  if [ -n "${CHECKSUM_WORKSPACE:-}" ] && [ -d "${CHECKSUM_WORKSPACE}" ]; then
    rm -rf "${CHECKSUM_WORKSPACE}"
  fi

  if [ -n "${EXTRACTED_ROOT:-}" ] && [ -d "${EXTRACTED_ROOT}" ] && [ "${KEEP_EXTRACTED:-0}" -eq 0 ]; then
    rm -rf "${EXTRACTED_ROOT}"
  fi

  return "$exit_code"
}

main() {
  local archive_path=""
  local checksum_path=""
  local metadata_path=""
  local extract_root=""
  local metadata_output=""
  local bundle_dir_name=""
  local extracted_bundle_dir=""
  local archive_listing=""
  local archive_entry=""
  KEEP_EXTRACTED=0
  CHECKSUM_WORKSPACE=""
  EXTRACTED_ROOT=""

  trap 'cleanup $?' EXIT

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        ;;
      --archive|--archive-file)
        [ "$#" -ge 2 ] || fail "$1 requires a value"
        case "$2" in
          ""|--*) fail "$1 requires a value" ;;
        esac
        archive_path="$2"
        shift 2
        ;;
      --archive=*|--archive-file=*)
        archive_path="${1#*=}"
        [ -n "$archive_path" ] || fail "${1%%=*} requires a value"
        shift
        ;;
      --checksum-file)
        [ "$#" -ge 2 ] || fail "--checksum-file requires a value"
        case "$2" in
          ""|--*) fail "--checksum-file requires a value" ;;
        esac
        checksum_path="$2"
        shift 2
        ;;
      --checksum-file=*)
        checksum_path="${1#*=}"
        [ -n "$checksum_path" ] || fail "--checksum-file requires a value"
        shift
        ;;
      --metadata-file)
        [ "$#" -ge 2 ] || fail "--metadata-file requires a value"
        case "$2" in
          ""|--*) fail "--metadata-file requires a value" ;;
        esac
        metadata_path="$2"
        shift 2
        ;;
      --metadata-file=*)
        metadata_path="${1#*=}"
        [ -n "$metadata_path" ] || fail "--metadata-file requires a value"
        shift
        ;;
      --extract-root|--extract-to)
        [ "$#" -ge 2 ] || fail "$1 requires a value"
        case "$2" in
          ""|--*) fail "$1 requires a value" ;;
        esac
        extract_root="$2"
        shift 2
        ;;
      --extract-root=*|--extract-to=*)
        extract_root="${1#*=}"
        [ -n "$extract_root" ] || fail "${1%%=*} requires a value"
        shift
        ;;
      --keep-extracted)
        KEEP_EXTRACTED=1
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

  [ -n "$archive_path" ] || fail "--archive is required"

  if [ -z "$checksum_path" ]; then
    checksum_path="${archive_path}.sha256"
  fi
  if [ -z "$metadata_path" ]; then
    metadata_path="${archive_path}.metadata.json"
  fi
  if [ -z "$extract_root" ]; then
    extract_root="${TMPDIR:-/tmp}"
  fi

  [ -f "$archive_path" ] || fail "--archive file not found: $archive_path"
  [ -f "$checksum_path" ] || fail "--checksum-file not found: $checksum_path"
  [ -f "$metadata_path" ] || fail "--metadata-file not found: $metadata_path"

  archive_path="$(resolve_existing_path "$archive_path")" || fail "Could not resolve archive path: $archive_path"
  checksum_path="$(resolve_existing_path "$checksum_path")" || fail "Could not resolve checksum path: $checksum_path"
  metadata_path="$(resolve_existing_path "$metadata_path")" || fail "Could not resolve metadata path: $metadata_path"

  mkdir -p "$extract_root"
  extract_root="$(resolve_existing_path "$extract_root")" || fail "Could not resolve extract root: $extract_root"

  require_command node
  require_command tar
  require_command mktemp
  select_checksum_verifier

  metadata_output="$(
    validate_metadata_and_print_bundle_dir \
      "$(basename -- "$archive_path")" \
      "$(basename -- "$checksum_path")" \
      "$(basename -- "$metadata_path")" \
      "$metadata_path" 2>&1
  )" || fail "Metadata validation failed: ${metadata_output}"
  bundle_dir_name="${metadata_output%$'\n'}"
  [ -n "$bundle_dir_name" ] || fail "Metadata validation did not return bundle_dir_name"

  log "Verifying archive checksum"
  CHECKSUM_WORKSPACE="$(mktemp -d "${TMPDIR:-/tmp}/promobot-release-checksum.XXXXXX")"
  ln -s "$archive_path" "${CHECKSUM_WORKSPACE}/$(basename -- "$archive_path")"
  cp "$checksum_path" "${CHECKSUM_WORKSPACE}/$(basename -- "$checksum_path")"
  (
    cd "$CHECKSUM_WORKSPACE"
    "${CHECKSUM_VERIFY_CMD[@]}" "$(basename -- "$checksum_path")"
  ) >/dev/null || fail "Archive checksum verification failed for ${archive_path}"

  if ! archive_listing="$(tar -tzf "$archive_path")"; then
    fail "Archive could not be listed: $archive_path"
  fi
  [ -n "$archive_listing" ] || fail "Archive is empty: $archive_path"

  while IFS= read -r archive_entry; do
    [ -n "$archive_entry" ] || continue

    case "$archive_entry" in
      "$bundle_dir_name"|"$bundle_dir_name"/*) ;;
      *)
        fail "Archive entry escaped metadata bundle_dir_name (${bundle_dir_name}): ${archive_entry}"
        ;;
    esac

    case "$archive_entry" in
      /*|../*|*/../*|..)
        fail "Archive entry contains an unsafe path: ${archive_entry}"
        ;;
    esac
  done <<<"$archive_listing"

  EXTRACTED_ROOT="$(mktemp -d "${extract_root%/}/promobot-release-extract.XXXXXX")"
  log "Extracting archive into ${EXTRACTED_ROOT}"
  tar -xzf "$archive_path" -C "$EXTRACTED_ROOT"

  extracted_bundle_dir="${EXTRACTED_ROOT}/${bundle_dir_name}"
  [ -d "$extracted_bundle_dir" ] || fail "Expected extracted bundle directory not found: ${extracted_bundle_dir}"
  [ -f "${extracted_bundle_dir}/dist/server/cli/releaseVerify.js" ] || fail "Extracted bundle is missing dist/server/cli/releaseVerify.js"

  log "Running extracted bundle release verifier"
  node "${extracted_bundle_dir}/dist/server/cli/releaseVerify.js" --input-dir "$extracted_bundle_dir"

  if [ "$KEEP_EXTRACTED" -eq 1 ]; then
    log "Verification succeeded; kept extracted bundle at ${extracted_bundle_dir}"
  else
    log "Verification succeeded; extracted bundle will be cleaned up"
  fi
}

main "$@"
