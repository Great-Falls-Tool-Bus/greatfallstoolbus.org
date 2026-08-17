# DNS apply: pointer stub (apply plane = great-falls-tool-bus-infra)

**TIN-2360 rows (b)/(c, as amended)/(g).** The apply steps that used to
live in this file (as `dns-apply-blahaj.md`) are superseded. Per packet
0001 Amendment 1 and the substrate-boundary memo
([`0002-blahaj-substrate-boundary.md`](../decisions/0002-blahaj-substrate-boundary.md)),
the GFTB apply plane is the org overlay, not blahaj:

- **Canonical apply runbook:**
  [`great-falls-tool-bus-infra/docs/edge-apply-runbook.md`](https://github.com/Great-Falls-Tool-Bus/great-falls-tool-bus-infra/blob/main/docs/edge-apply-runbook.md):
  the Cloudflare API + DreamHost steps (credentials by name only;
  DreamHost API is read-only capture; the NS flip is a panel step).
- **Apply stack:**
  `great-falls-tool-bus-infra/tofu/stacks/edge` — the TIN-2385
  zone-scoped-token stack that actually applies every live record
  declared in `tofu/dns-intent/intent.yaml` (zones are added
  console-side; this stack only looks them up by name). Its sibling
  `great-falls-tool-bus-infra/tofu/stacks/edge-dns` predates TIN-2385 and
  stays permanently toggle-gated / fail-closed (both `manage_*` toggles
  default off; the default plan is empty) — it does not apply anything
  today.
- **Edge authority:** resolved by TIN-2385, a zone-scoped Cloudflare
  token held by the infra overlay; overlays never hold account-wide
  Cloudflare credentials.
- **DNS cutover chain:** TIN-2378 → TIN-2379 → TIN-2380, executed from
  `great-falls-tool-bus-infra` sessions.

Nothing in this repo applies DNS. The declare-only record set stays in
[`tofu/dns-intent/intent.yaml`](../../tofu/dns-intent/intent.yaml); the
operator verification surface stays
[`dns-mail-checklist.md`](./dns-mail-checklist.md).
