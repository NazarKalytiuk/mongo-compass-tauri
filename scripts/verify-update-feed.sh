#!/usr/bin/env bash
# Checks the published update feed exactly as installed apps consume it:
# fetches latest.json from the endpoint in tauri.conf.json, expects <version>, then
# downloads every platform's artifact (with the updater's Accept header) and
# verifies its minisign signature against the embedded public key.
#
# Usage: scripts/verify-update-feed.sh <version>        (requires curl, jq, minisign)
set -euo pipefail

version=${1:?usage: verify-update-feed.sh <version>}
root=$(cd "$(dirname "$0")/.." && pwd)
conf="$root/src-tauri/tauri.conf.json"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

endpoint=$(jq -r '.plugins.updater.endpoints[0]' "$conf")
jq -r '.plugins.updater.pubkey' "$conf" | base64 -d >"$tmp/key.pub"

# The CDN behind releases/latest can lag a little after publishing.
for attempt in 1 2 3 4 5 6 7 8 9; do
  curl -fsSL "$endpoint" -o "$tmp/latest.json"
  [ "$(jq -r .version "$tmp/latest.json")" = "$version" ] && break
  if [ "$attempt" = 9 ]; then
    echo "$endpoint announces $(jq -r .version "$tmp/latest.json"), expected $version" >&2
    exit 1
  fi
  sleep 10
done
echo "feed: $endpoint announces $version"

platforms=$(jq -r '.platforms | keys[]' "$tmp/latest.json")
[ -n "$platforms" ] || { echo "latest.json lists no platforms" >&2; exit 1; }
for platform in $platforms; do
  url=$(jq -r --arg p "$platform" '.platforms[$p].url' "$tmp/latest.json")
  jq -r --arg p "$platform" '.platforms[$p].signature' "$tmp/latest.json" | base64 -d >"$tmp/$platform.minisig"
  curl -fsSL -H "Accept: application/octet-stream" "$url" -o "$tmp/$platform.bin"
  minisign -V -q -p "$tmp/key.pub" -m "$tmp/$platform.bin" -x "$tmp/$platform.minisig"
  echo "$platform: $(wc -c <"$tmp/$platform.bin" | tr -d ' ') bytes, signature ok"
done
