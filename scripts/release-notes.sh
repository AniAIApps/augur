#!/usr/bin/env bash
# Prints the CHANGELOG sections for VERSION from both plugins (empty if none).
set -euo pipefail
VERSION="${1:?usage: release-notes.sh X.Y.Z}"
VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
section() {
  awk -v v="$VERSION" '
    /^## / { if (found) exit; if ($2 == v) { found = 1; next } }
    found { print }
  ' "$1"
}
APP="$(section "$ROOT/augur-app/CHANGELOG.md")"
DS="$(section "$ROOT/augur-datasource/CHANGELOG.md")"
APP_ID=$(node -p "require('$ROOT/augur-app/src/plugin.json').id")
DS_ID=$(node -p "require('$ROOT/augur-datasource/src/plugin.json').id")
if [ -n "$APP" ]; then printf '### Augur app (%s)\n%s\n\n' "$APP_ID" "$APP"; fi
if [ -n "$DS" ]; then printf '### Augur model datasource (%s)\n%s\n\n' "$DS_ID" "$DS"; fi
cat <<MD
### Install
1. Download both zips below and unzip them into your Grafana plugins directory (Grafana 12.0+).
2. Unsigned builds need \`allow_loading_unsigned_plugins = ${APP_ID},${DS_ID}\`.
3. Verify downloads with \`sha256sum -c SHA256SUMS\` and, optionally, \`gh attestation verify <zip> --repo AniAIApps/augur\`.
MD
