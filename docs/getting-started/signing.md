# Plugin signing

Grafana refuses to load unsigned plugins unless they are explicitly allowed. A signature from Grafana is **not** needed to run Augur: it only matters for listing in Grafana's plugin catalog. You have two options.

| | Allow unsigned | Private signature |
|---|---|---|
| Effort | One line in `grafana.ini` | A Grafana Cloud account and a signing step in your build |
| Review by Grafana Labs | No | No |
| Plugin IDs | Unchanged | Renamed to your account's prefix (see below) |
| Works on | Any self-hosted Grafana | Only the Grafana URLs you sign for |
| Tamper protection | From verifying the download (checksums, attestations) | Grafana checks the signature on every start |

## Option 1: allow the unsigned plugins

```ini
[plugins]
allow_loading_unsigned_plugins = augur-assistant-app,augur-claude-datasource
```

Grafana loads them and shows them as **unsigned** in the plugin list. Pair this with the integrity checks on the download:

```bash
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify augur-claude-datasource-<version>.zip --repo AniAIApps/augur
```

Mirror the verified zips in your own artifact store and install from there, so every Grafana installs exactly what you checked.

## Option 2: sign them privately for your organisation

A **private** signature needs no review by Grafana Labs and is free. It is valid only for the Grafana `root_url`s you sign for, and is meant for use within your organisation.

!!! warning "The plugin ID must start with your account's slug"
    Grafana signs a plugin only for the Grafana Cloud account whose **slug is the first part of the plugin ID**. Augur's IDs start with `augur-`, so to sign it yourself you build a copy renamed to your slug: `acme-augur-app` and `acme-augur-datasource` for an account `acme`. The repository has a script for this.

### Steps

1. Create a [Grafana Cloud](https://grafana.com/) account for your organisation (free; no Grafana Cloud stack is used). Its slug, such as `acme`, becomes the prefix.
2. Create an **Access Policy token** with the `plugins:write` scope.
3. Rename, build, sign and package from a clean checkout of a release tag:

    ```bash
    git clone --branch v1.9.0 https://github.com/AniAIApps/augur && cd augur
    scripts/set-plugin-ids.sh acme          # → acme-augur-app, acme-augur-datasource
    make install build

    export GRAFANA_ACCESS_POLICY_TOKEN=glc_...
    ROOTS=https://grafana.acme.com,https://grafana-staging.acme.com
    (cd augur-app && npx @grafana/sign-plugin@latest --distDir dist --rootUrls "$ROOTS")
    (cd augur-datasource && npx @grafana/sign-plugin@latest --distDir dist --rootUrls "$ROOTS")
    make zip                                 # → release/acme-augur-app-<version>.zip, ...
    ```

    The root URLs must match Grafana's `root_url` exactly, including scheme and path.

4. Install the zips as usual, and use the new IDs everywhere Augur is referenced:

    ```ini
    [navigation.app_sections]
    acme-augur-app = root -3450
    ```

    ```yaml
    # provisioning
    apps:
      - type: acme-augur-app
    datasources:
      - type: acme-augur-datasource
    ```

    `allow_loading_unsigned_plugins` is no longer needed.

!!! note "Switching an existing installation"
    Renamed plugins are a separate installation as far as Grafana is concerned: re-create the Augur datasource (or update its `type` in provisioning) and re-enable the app. App settings (rules, skills, memory) are stored per plugin ID, so export or provision them first. Users' browser-stored conversations don't carry over. Saved investigations and dashboards are unaffected.

### Signing in the release workflow

The release workflow can do all of this. Set on your fork:

| Kind | Name | Value |
|---|---|---|
| Variable | `GRAFANA_PLUGIN_ID_PREFIX` | your account slug, e.g. `acme` (renames the plugins before building) |
| Secret | `GRAFANA_ACCESS_POLICY_TOKEN` | the access policy token |
| Variable | `GRAFANA_SIGN_ROOT_URLS` | comma-separated root URLs |

Without the token, unsigned builds are published.

## Community signature

A community signature (installable from Grafana's catalog by anyone) needs a review by Grafana Labs and publication in the catalog. Augur isn't listed there, and you don't need it: for use inside an organisation, a private signature gives the same tamper protection.
