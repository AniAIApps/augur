# Using Augur in your organisation

Augur is open source under the MIT licence. You can run it inside your organisation and let your users rely on it, without a signature or listing from Grafana Labs. This page covers the choices to make before rolling it out.

## 1. Choose how Grafana loads it

| | Allow unsigned | Private signature |
|---|---|---|
| Best for | Trials, a single team, environments with strict artifact controls already | Production Grafana used across the organisation |
| What you do | Add both IDs to `allow_loading_unsigned_plugins` | Sign a copy renamed to your Grafana Cloud account's prefix, in your own pipeline |
| Grafana checks integrity at startup | No (verify downloads instead) | Yes |

Both are described in [Plugin signing](../getting-started/signing.md).

## 2. Control the supply chain

- **Build or mirror from a release tag.** Verify `SHA256SUMS` and the build-provenance attestation, then publish the zips (or your signed build) to your own artifact store (Artifactory, Nexus, S3). Grafana instances install only from there.
- **Pin the version** in your Helm values or image, and upgrade deliberately; read the changelog for each release.
- **Rebuild yourself if your policy requires it.** `make install build` from a tag reproduces the release; GitHub Actions in the repository are pinned to commit SHAs.

## 3. Decide where model traffic goes

- Point the datasource at your **own gateway** (LiteLLM or similar), not straight at a provider, so keys, budgets, logging and guardrails stay central. See [Models and providers](../configure/models.md).
- Forward users' **OAuth tokens** if the gateway should know who is asking (per-user budgets and audit). See [Authentication](../configure/auth.md).
- Set the datasource's [usage limits](../configure/datasource.md#limits) as a backstop.
- Add your internal CA rather than turning off TLS verification. See [TLS and internal CAs](../configure/tls.md).

## 4. Decide who can use it and what it can change

- Augur acts as the signed-in user. Grafana permissions decide what each person can query and change. See [Permissions](permissions.md).
- Restrict the Augur datasource to the teams who should use it.
- Keep MCP servers narrow: allow-list tools, declare read-only ones, keep `writeRole` at Editor or Admin. See [MCP servers](../configure/mcp.md).
- Set a **history retention** period if conversations shouldn't stay in browsers long. See [Rules, skills and memory](../configure/app-settings.md#limits-and-behaviour).

## 5. Prepare the reviews

Security and architecture reviews usually ask for the same things. Point reviewers at:

- [Security model](security.md): trust boundaries, credentials, MCP authorization, prompt-injection handling, data storage, reporting vulnerabilities.
- [How it works](../reference/architecture.md): what runs where and what leaves the network (only calls to your model endpoint and MCP servers).
- The evidence ledger and [evidence verification](../guide/investigations.md#verifying-the-evidence), if conclusions feed incident reviews or audits.

If you contribute to Augur, or adopt it, as an employee, check how your organisation's policies on open-source use and contribution apply. That's easier to settle before the organisation depends on it.

## 6. Letting others use it

You may redistribute Augur under the MIT licence, including builds with your own plugin IDs, as long as the licence notice stays with it. A few practical points:

- **Grafana's catalog** (one-click install) needs a review by Grafana Labs and a community signature. Without it, users install the zips from a release, as described in [Install](../getting-started/install.md).
- **Grafana Cloud** doesn't accept unsigned or privately signed plugins. Augur is built for self-hosted Grafana; Grafana Cloud users have Grafana Assistant.
- **Names and trademarks.** Grafana is a trademark of Raintank, Inc. (Grafana Labs) and Claude is a trademark of Anthropic, PBC. Don't present Augur, or a build of it, as made or endorsed by either. Keep their names and logos out of product names and branding.

This page is general guidance, not legal advice. Check licence and trademark questions with your own legal team.
