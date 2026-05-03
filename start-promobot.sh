#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
bundle_root="${script_dir}"
release_deploy_script="${bundle_root}/ops/deploy-release.sh"
source_deploy_script="${bundle_root}/ops/deploy-promobot.sh"

if [ -f "${bundle_root}/src/server/index.ts" ]; then
  if [ ! -f "${source_deploy_script}" ]; then
    printf '[start-promobot] ERROR: ops/deploy-promobot.sh not found in %s\n' "${bundle_root}" >&2
    exit 1
  fi

  printf '[start-promobot] Delegating to ops/deploy-promobot.sh\n'
  exec bash "${source_deploy_script}" "$@"
fi

if [ -f "${bundle_root}/dist/server/index.js" ] && [ -f "${bundle_root}/dist/client/index.html" ]; then
  if [ ! -f "${release_deploy_script}" ]; then
    printf '[start-promobot] ERROR: ops/deploy-release.sh not found in %s\n' "${bundle_root}" >&2
    exit 1
  fi

  printf '[start-promobot] Delegating to ops/deploy-release.sh\n'
  exec bash "${release_deploy_script}" "$@"
fi

printf '[start-promobot] ERROR: could not detect a source checkout or release bundle in %s\n' "${bundle_root}" >&2
printf '[start-promobot] Expected either dist/server/index.js + dist/client/index.html or src/server/index.ts\n' >&2
exit 1
