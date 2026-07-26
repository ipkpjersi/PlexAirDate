#!/usr/bin/env bash
# Packages the Chrome and Firefox extensions into dist/ zips, mirroring the layout the browser
# stores expect: manifest.json and src/ sit at the ARCHIVE ROOT, not inside a wrapper folder.
# The version in each zip name is read from that browser's own manifest.json, so bumping the
# manifest is the only version edit needed.
#
# Usage: scripts/build.sh [chrome|firefox]   (no argument builds both)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

build() {
  local browser="$1"
  local src_dir="${repo_root}/PlexAirDate-${browser}"
  local manifest="${src_dir}/manifest.json"

  if [[ ! -f "${manifest}" ]]; then
    echo "error: ${manifest} not found" >&2
    return 1
  fi

  # Read "version": "x.y.z" from the manifest without needing jq installed.
  local version
  version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${manifest}" | head -n 1)"
  if [[ -z "${version}" ]]; then
    echo "error: could not read version from ${manifest}" >&2
    return 1
  fi

  local dist_dir="${src_dir}/dist"
  local zip_path="${dist_dir}/plex-air-date-${browser}-${version}.zip"

  mkdir -p "${dist_dir}"
  rm -f "${zip_path}"

  # Zip from inside the extension folder so the paths in the archive are relative to it. Only the
  # files the extension actually loads are included; dist/ itself is excluded so rebuilding never
  # nests an older zip inside a newer one.
  (cd "${src_dir}" && zip -r -X "${zip_path}" manifest.json src -x '*/.*' '.*')

  echo "built ${zip_path}"
}

case "${1:-all}" in
  chrome) build chrome ;;
  firefox) build firefox ;;
  all)
    build chrome
    build firefox
    ;;
  *)
    echo "usage: $(basename "$0") [chrome|firefox]" >&2
    exit 1
    ;;
esac
