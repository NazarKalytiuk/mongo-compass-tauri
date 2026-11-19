#!/usr/bin/env bash
# Verifies a built macOS bundle directory (…/release/bundle):
#   - the .app is code signed, links only system libraries, contains the expected architectures;
#   - with --updater: the .app.tar.gz updater archive carries a minisign signature that
#     verifies against the public key embedded in tauri.conf.json (requires `minisign`).
#
# Usage: scripts/verify-bundle.sh <bundle-dir> [--archs "x86_64 arm64"] [--updater]
set -euo pipefail

bundle=${1:?usage: verify-bundle.sh <bundle-dir> [--archs "..."] [--updater]}
shift
archs=$(uname -m)
updater=false
while [ $# -gt 0 ]; do
  case $1 in
    --archs) archs=$2; shift 2 ;;
    --updater) updater=true; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

root=$(cd "$(dirname "$0")/.." && pwd)
app="$bundle/macos/mongo-compass-tauri.app"
bin="$app/Contents/MacOS/mongo-compass-tauri"

test -x "$bin" || { echo "missing executable $bin" >&2; exit 1; }
codesign --verify --deep --strict "$app"
echo "codesign: ok ($(codesign -dv "$app" 2>&1 | grep -E '^Signature=' || echo 'Signature=Developer ID'))"

have=$(lipo -archs "$bin")
for arch in $archs; do
  [[ " $have " == *" $arch "* ]] || { echo "architecture $arch missing (have: $have)" >&2; exit 1; }
done
echo "architectures: $have"

# Only system frameworks may be linked: the app ships as a single binary.
for arch in $have; do
  if otool -arch "$arch" -L "$bin" | tail -n +2 | grep -v -E '^\s*(/System/|/usr/lib/)'; then
    echo "$arch: non-system libraries are linked" >&2
    exit 1
  fi
done
echo "linked libraries: system only"

version=$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")
cargo_version=$(sed -n '/^\[package\]/,/^\[/s/^version *= *"\(.*\)"/\1/p' "$root/src-tauri/Cargo.toml")
[ "$version" = "$cargo_version" ] || { echo "bundle version $version != Cargo.toml $cargo_version" >&2; exit 1; }
echo "version: $version"

if $updater; then
  archive="$bundle/macos/mongo-compass-tauri.app.tar.gz"
  if [ ! -s "$archive" ] || [ ! -s "$archive.sig" ]; then
    echo "missing $archive or its .sig" >&2
    exit 1
  fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  # tauri.conf.json and the .sig file hold base64-encoded minisign files.
  plutil -extract plugins.updater.pubkey raw "$root/src-tauri/tauri.conf.json" | base64 -d >"$tmp/key.pub"
  base64 -d <"$archive.sig" >"$tmp/archive.minisig"
  minisign -V -q -p "$tmp/key.pub" -m "$archive" -x "$tmp/archive.minisig"
  echo "updater signature: ok"
fi
