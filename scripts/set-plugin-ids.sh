#!/usr/bin/env bash
# Rename both plugins for an organisation's own private signature.
#
# Grafana only signs a plugin for the Grafana Cloud account whose slug is the first part of the
# plugin ID. To sign Augur privately for your organisation (account slug "acme"), rename the
# plugins to acme-augur-app and acme-augur-datasource before building:
#
#   scripts/set-plugin-ids.sh acme
#   make install build
#   (cd augur-app && npx @grafana/sign-plugin@latest --distDir dist --rootUrls https://grafana.acme.com)
#   (cd augur-datasource && npx @grafana/sign-plugin@latest --distDir dist --rootUrls https://grafana.acme.com)
#   make zip
#
# Run it on a clean checkout: it rewrites source files in place (use git to undo). Renamed plugins
# are a separate installation: conversations in users' browsers, provisioning files and
# navigation settings refer to the new IDs.
set -euo pipefail

slug="${1:-}"
if ! [[ "$slug" =~ ^[a-z][a-z0-9]{0,29}$ ]]; then
  echo "usage: $0 <grafana-cloud-account-slug>   (lowercase letters and digits, starting with a letter)" >&2
  exit 2
fi
cd "$(dirname "$0")/.."

OLD_APP=augur-assistant-app
OLD_DS=augur-claude-datasource
NEW_APP="${slug}-augur-app"
NEW_DS="${slug}-augur-datasource"

current=$(node -p "require('./augur-app/src/plugin.json').id")
if [ "$current" != "$OLD_APP" ]; then
  echo "plugin IDs were already changed (app is $current); start from a clean checkout" >&2
  exit 1
fi

# Source (including tests, so they keep passing), manifests, package names and the Go entry point.
mapfile -t files < <(
  grep -rlE "$OLD_APP|$OLD_DS" \
    augur-app/src augur-app/package.json augur-app/package-lock.json \
    augur-datasource/src augur-datasource/pkg augur-datasource/package.json augur-datasource/package-lock.json \
    2>/dev/null || true
)
for f in "${files[@]}"; do
  sed -i.bak -e "s/$OLD_APP/$NEW_APP/g" -e "s/$OLD_DS/$NEW_DS/g" "$f" && rm -f "$f.bak"
done

app=$(node -p "require('./augur-app/src/plugin.json').id")
ds=$(node -p "require('./augur-datasource/src/plugin.json').id")
dep=$(node -p "require('./augur-app/src/plugin.json').dependencies.plugins.map(p => p.id).join(',')")
[ "$app" = "$NEW_APP" ] && [ "$ds" = "$NEW_DS" ] && [ "$dep" = "$NEW_DS" ] || {
  echo "rename incomplete: app=$app datasource=$ds dependency=$dep" >&2
  exit 1
}
# Webpack's persistent cache would otherwise serve the old plugin.json into the build.
rm -rf augur-app/node_modules/.cache augur-datasource/node_modules/.cache augur-app/dist augur-datasource/dist
echo "Plugin IDs: $NEW_APP, $NEW_DS (${#files[@]} files updated)"
