# Compared with Grafana Assistant

Grafana Assistant is Grafana Labs' commercial agent. Since April 2026 OSS and Enterprise users can use it too, by connecting their Grafana to a Grafana Cloud stack: the stack provides the backend, limits and billing, and prompts plus query context are processed there. Its self-managed documentation requires Grafana 13.1+ and lists Investigations, investigation and Knowledge Graph memory, Automations and the Slack integration as *not available* ([docs](https://grafana.com/docs/grafana/latest/ai-tools/grafana-assistant/self-managed/), checked November 2026).

| Capability on self-managed Grafana | Grafana Assistant (on-prem) | Augur |
|---|---|---|
| Requires | Grafana 13.1+ and a Grafana Cloud stack | Grafana 12.0+ and a model endpoint (Claude Messages or OpenAI-compatible) |
| Chat, query writing and explanation, navigation | ✓ | ✓ (with Explore/dashboard/alert links) |
| Create dashboards | ✓ | ✓ (queries dry-run before you see the draft) |
| Edit existing dashboards | ✓ | ✓ (change list, version-guarded apply, rollback via version history) |
| Rules and skills | ✓ | ✓ (also provisionable from Git; `/commands`) |
| MCP server integrations | ✓ | ✓ (proxied server-side; approval for non-read-only tools) |
| Investigations | ✗ (Cloud only) | ✓ (sub-agents, hypothesis board, challenge step, saved reports) |
| Infrastructure / knowledge memory | ✗ (Cloud only) | ✓ (scan of metrics/logs/traces + Tempo service graph) |
| Evidence ledger and re-verification | not documented | ✓ every query recorded with its exact range and a data digest; **Verify evidence** re-runs them later and flags findings resting on changed or vanished data |
| Alerting actions | silences and routing (per Grafana Cloud guides) | draft silences (with live match preview) and alert rules |
| Profiles (Pyroscope) | not listed for self-managed | ✓ |
| Automations / scheduled runs, Slack | ✗ (Cloud only) | not yet (roadmap) |
| Where prompts and query context go | Grafana Cloud backend (stack region) ↔ LLM provider | your Grafana ↔ **your** gateway |
| Model / identity | Grafana-managed | your choice; per-user OAuth possible |
| Cost | Grafana Cloud Assistant pricing, per connected stack | open source (MIT) + your model usage |
| Benchmark | Grafana's [o11y-bench](https://o11ybench.ai/) | runs on o11y-bench with its own tools ([how](development.md#benchmark)) |

Grafana Assistant has more polish and integrations inside Grafana Cloud. Augur is for teams that need the assistant to stay inside their own network and identity boundary.

!!! note
    Comparison based on Grafana's public documentation, checked November 2026. Grafana Assistant changes quickly; check the linked docs for the current state.
