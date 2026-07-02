# `tofu/dns-intent/` — declare-only Cloudflare DNS intent

**This directory is intent documentation consumed by the org
apply-plane overlay (`great-falls-tool-bus-infra`).
Nothing here is applied from this repo. No endpoints, no state, no
credentials — ever.**

Same contract as [`../mail-intent/`](../mail-intent/README.md) (TIN-2360
row c as amended by packet 0001 Amendment 1): declare-only tofu/intent in
this public repo; runtime apply — including every Cloudflare zone, record,
and redirect rule — in `great-falls-tool-bus-infra` (`tofu/stacks/edge-dns`,
zone-scoped CF token per TIN-2385); runner tenancy also in
`great-falls-tool-bus-infra` per TIN-2299. This
subdirectory declares no resources, no providers, no backend, and is never
referenced by any `.tf` file; `just tofu-plan` neither reads nor needs it.

## What is declared (see `intent.yaml`)

| Zone | Intent |
| --- | --- |
| `greatfallstoolbus.org` | Cloudflare zone on the house account; apex `A` + `www` CNAME to GitHub Pages (grey-cloud until the Pages cert issues); org domain-verification TXT; **no mail records** (row a) |
| `latoolb.us` | Cloudflare zone on the house account; proxied redirect anchors + single 301 Redirect Rule to `https://greatfallstoolbus.org/`; MX `10 relay.tinyland.dev` (DNS-only); SPF `v=spf1 mx ~all`; DKIM public TXT (key minted in the infra overlay's sops lane); DMARC `p=none` with a real `rua` mailbox; MTA-STS deferred |

## Registrar (DreamHost) — data, not mutation

Both domains are registered at DreamHost, which becomes **registrar-only**
after the NS cutover. State captured 2026-07-02: NS still
`ns*.dreamhost.com`, zero records on both zones, no Cloudflare zone exists
yet for either domain. The DreamHost API is used **read-only** for
capture/verification (`domain-list_domains`, `dns-list_records`); it has no
registration-nameserver mutation, so the NS flip itself is a DreamHost
panel step. Nothing in this repo — and no agent session — mutates DreamHost
or Cloudflare directly; every change is a GitOps declaration applied by the
infra overlay.

## Naming note

`great-falls-tool-bus.org` (hyphenated) is **not registered** (NXDOMAIN,
verified 2026-07-02). The hyphenated name exists only as the GitHub org and
Pages host (`great-falls-tool-bus.github.io`). The registered, canonical
web domain is `greatfallstoolbus.org`; `latoolb.us` 301s to it.

## Optional hardening (proposed, not decided)

`greatfallstoolbus.org` sends no mail; publishing a null-mail posture
(RFC 7505 null MX `0 .`, `v=spf1 -all`, DMARC reject) would prevent
spoofing from the web domain. Not in the decision packet — needs an
operator ack before it enters `intent.yaml`.

## Related

- Apply-plane runbook (CF API + DreamHost): `great-falls-tool-bus-infra/docs/edge-apply-runbook.md` (local pointer stub: [`docs/runbooks/dns-apply.md`](../../docs/runbooks/dns-apply.md))
- Operator verification checklist: [`docs/runbooks/dns-mail-checklist.md`](../../docs/runbooks/dns-mail-checklist.md)
- Mail/list/Anubis intent: [`../mail-intent/intent.yaml`](../mail-intent/intent.yaml)
- Names-only secrets contract: [`secrets.contract.yaml`](../../secrets.contract.yaml)
- Decision packet: [`docs/decisions/0001-gftb-mvp-decisions.md`](../../docs/decisions/0001-gftb-mvp-decisions.md) (TIN-2360)
