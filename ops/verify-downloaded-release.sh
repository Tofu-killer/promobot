#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[verify-downloaded-release] %s\n' "$*"
}

fail() {
  printf '[verify-downloaded-release] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ops/verify-downloaded-release.sh --archive-file <path> [options]

Verify a downloaded release archive, its checksum sidecar, and metadata sidecar,
then run the existing release directory verification on the extracted bundle.

Options:
  --archive-file <path>       Downloaded .tar.gz archive to verify (required)
  --checksum-file <path>      Checksum sidecar path (default: <archive>.sha256)
  --metadata-file <path>      Metadata sidecar path (default: <archive>.metadata.json)
  --extract-to <path>         Extraction directory root (default: temporary directory)
  --help, -h                  Show this help

Examples:
  bash ops/verify-downloaded-release.sh --archive-file release/promobot-release-bundle.tar.gz
  bash ops/verify-downloaded-release.sh --archive-file /tmp/promobot-release-bundle-v1.2.3.tar.gz --extract-to /tmp/release-check
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

main() {
  local archive_file=""
  local checksum_file=""
  local metadata_file=""
  local extract_to=""
  local script_dir
  local repo_root
  local archive_abs
  local checksum_abs
  local metadata_abs
  local extract_root
  local bundle_dir_name
  local resolved_input_dir
  local expected_archive_file
  local expected_checksum_file
  local expected_metadata_file
  local expected_archive_format
  local expected_checksum_algorithm

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        ;;
      --archive-file)
        [ "$#" -ge 2 ] || fail "--archive-file requires a value"
        case "$2" in
          ""|--*) fail "--archive-file requires a value" ;;
        esac
        archive_file="$2"
        shift 2
        ;;
      --archive-file=*)
        archive_file="${1#*=}"
        [ -n "$archive_file" ] || fail "--archive-file requires a value"
        shift
        ;;
      --checksum-file)
        [ "$#" -ge 2 ] || fail "--checksum-file requires a value"
        case "$2" in
          ""|--*) fail "--checksum-file requires a value" ;;
        esac
        checksum_file="$2"
        shift 2
        ;;
      --checksum-file=*)
        checksum_file="${1#*=}"
        [ -n "$checksum_file" ] || fail "--checksum-file requires a value"
        shift
        ;;
      --metadata-file)
        [ "$#" -ge 2 ] || fail "--metadata-file requires a value"
        case "$2" in
          ""|--*) fail "--metadata-file requires a value" ;;
        esac
        metadata_file="$2"
        shift 2
        ;;
      --metadata-file=*)
        metadata_file="${1#*=}"
        [ -n "$metadata_file" ] || fail "--metadata-file requires a value"
        shift
        ;;
      --extract-to)
        [ "$#" -ge 2 ] || fail "--extract-to requires a value"
        case "$2" in
          ""|--*) fail "--extract-to requires a value" ;;
        esac
        extract_to="$2"
        shift 2
        ;;
      --extract-to=*)
        extract_to="${1#*=}"
        [ -n "$extract_to" ] || fail "--extract-to requires a value"
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

  [ -n "$archive_file" ] || fail "--archive-file is required"

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd)"

  cd "${repo_root}"

  require_command sha256sum
  require_command tar
  require_command node

  [ -f "package.json" ] || fail "package.json not found in ${repo_root}"
  [ -f "dist/server/cli/releaseVerify.js" ] || fail "dist/server/cli/releaseVerify.js not found; run pnpm build first"

  archive_abs="$(cd -- "$(dirname -- "$archive_file")" >/dev/null 2>&1 && pwd)/$(basename -- "$archive_file")"
  [ -f "$archive_abs" ] || fail "--archive-file not found: ${archive_file}"

  checksum_file="${checksum_file:-${archive_abs}.sha256}"
  metadata_file="${metadata_file:-${archive_abs}.metadata.json}"

  checksum_abs="$(cd -- "$(dirname -- "$checksum_file")" >/dev/null 2>&1 && pwd)/$(basename -- "$checksum_file")"
  metadata_abs="$(cd -- "$(dirname -- "$metadata_file")" >/dev/null 2>&1 && pwd)/$(basename -- "$metadata_file")"

  [ -f "$checksum_abs" ] || fail "--checksum-file not found: ${checksum_file}"
  [ -f "$metadata_abs" ] || fail "--metadata-file not found: ${metadata_file}"

  extract_root="${extract_to:-$(mktemp -d /tmp/promobot-release-verify-XXXXXX)}"
  mkdir -p "$extract_root"

  expected_archive_file="$(basename -- "$archive_abs")"
  expected_checksum_file="$(basename -- "$checksum_abs")"
  expected_metadata_file="$(basename -- "$metadata_abs")"

  # Verify the downloaded archive against its sidecar without relying on path-sensitive output.
  local expected_hash actual_hash
  expected_hash="$(awk 'NR==1 {print $1}' "$checksum_abs")"
  [ -n "$expected_hash" ] || fail "Failed to read checksum from ${checksum_abs}"
  actual_hash="$(sha256sum "$archive_abs" | awk '{print $1}')"
  [ "$actual_hash" = "$expected_hash" ] || fail "Checksum mismatch for ${archive_abs}"

  # Read and validate the metadata sidecar before extraction.
  local metadata_values
  metadata_values="$(node - <<'EOF' "$metadata_abs" "$expected_archive_file" "$expected_checksum_file" "$expected_metadata_file"
const fs = require('node:fs');
const path = require('node:path');

const metadataPath = process.argv[2];
const expectedArchive = process.argv[3];
const expectedChecksum = process.argv[4];
const expectedMetadata = process.argv[5];
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

if (metadata.archive_file !== expectedArchive) {
  throw new Error(`Unexpected metadata archive_file: ${metadata.archive_file} !== ${expectedArchive}`);
}

if (metadata.checksum_file !== expectedChecksum) {
  throw new Error(`Unexpected metadata checksum_file: ${metadata.checksum_file} !== ${expectedChecksum}`);
}

if (metadata.metadata_file !== expectedMetadata) {
  throw new Error(`Unexpected metadata metadata_file: ${metadata.metadata_file} !== ${expectedMetadata}`);
}

if (metadata.checksum_algorithm !== 'sha256') {
  throw new Error(`Unexpected metadata checksum_algorithm: ${metadata.checksum_algorithm}`);
}

if (metadata.archive_format !== 'tar.gz') {
  throw new Error(`Unexpected metadata archive_format: ${metadata.archive_format}`);
}

if (!Array.isArray(metadata.assets) || metadata.assets.length === 0) {
  throw new Error('Expected metadata.assets to be a non-empty array');
}

const assetsByKind = Object.fromEntries(metadata.assets.map((asset) => [asset.kind, asset.name]));
for (const [kind, value] of Object.entries({
  archive: expectedArchive,
  checksum: expectedChecksum,
  metadata: expectedMetadata,
})) {
  if (assetsByKind[kind] !== value) {
    throw new Error(`Unexpected metadata.assets ${kind} asset: ${assetsByKind[kind]} !== ${value}`);
  }
}

if (typeof metadata.bundle_dir_name !== 'string' || metadata.bundle_dir_name.length === 0) {
  throw new Error('Expected metadata.bundle_dir_name to be a non-empty string');
}

process.stdout.write(`${metadata.bundle_dir_name}\n${metadata.run_url ?? ''}\n${metadata.release_url ?? ''}\n`);
EOF
)"
  bundle_dir_name="$(printf '%s\n' "$metadata_values" | sed -n '1p')"
  [ -n "$bundle_dir_name" ] || fail "Metadata did not provide bundle_dir_name"

  log "Checksum verified for $(basename -- "$archive_abs")"
  log "Extracting archive into ${extract_root}"
  tar -xzf "$archive_abs" -C "$extract_root"

  resolved_input_dir="${extract_root}/${bundle_dir_name}"
  [ -d "$resolved_input_dir" ] || fail "Expected extracted bundle directory not found: ${resolved_input_dir}"

  log "Running node dist/server/cli/releaseVerify.js --input-dir ${resolved_input_dir}"
  node dist/server/cli/releaseVerify.js --input-dir "$resolved_input_dir"
}

main "$@"
