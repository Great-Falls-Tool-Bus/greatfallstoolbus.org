# `tofu/mail-intent/` — declare-only mail/list/Anubis intent

**This directory is intent documentation consumed by the org
apply-plane overlay (`great-falls-tool-bus-infra`).
Nothing here is applied from this repo. No endpoints, no state, no
credentials — ever.**

That sentence is the whole contract. Expanded:

- **Declare-only (TIN-2360 row c, DECIDED 2026-07-02; amended by packet
  0001 Amendment 1).** GFTB IaC lives on three planes: declare-only
  tofu/intent in this public repo; runtime apply (mail / list / Anubis /
  tunnel / DNS) in `great-falls-tool-bus-infra`, the org apply-plane
  overlay (the MassageIthaca-precedent blahaj placement is superseded —
  see `docs/decisions/0002-blahaj-substrate-boundary.md`); runner tenancy
  also in `great-falls-tool-bus-infra` per TIN-2299. This directory is the
  first plane only.
- **Not wired into `tofu plan`.** `tofu/main.tf` composes the five
  spoke-facing modules; this subdirectory declares no resources, no
  providers, no backend, and is never referenced by any `.tf` file. Running
  `just tofu-plan` neither reads nor needs it.
- **Zero secrets (row d).** The names of the secrets this intent will
  eventually need are recorded — names only — in `secrets.contract.yaml`
  at the repo root. Values live in the infra overlay's `secrets/`
  sops+age lane (`great-falls-tool-bus-infra/.sops.yaml`, distinct row-d
  recipient).
- **Nothing here unblocks work by itself.** This is prep. Mail cutover
  follows the manual operator checklist in
  [`docs/runbooks/dns-mail-checklist.md`](../../docs/runbooks/dns-mail-checklist.md)
  (row g), and the overlay-side deployments carry their own ADRs before
  anything is announced.

## What is declared (see `intent.yaml`)

| Surface | Intent |
| --- | --- |
| `latoolb.us` | Mail domain + DNS redirect/alias to the site (row a) |
| `greatfallstoolbus.org` | Web domain for this repo's static site |
| `keyholders@latoolb.us` | First production `MailAccount` application (`mail.tinyland.dev/v1alpha1`; CR applied from the infra overlay, reconciled by the house mail substrate) |
| `keyholders` list | Mailman 3 + Postorius + HyperKitty, pinned trio 3.3.10 / 1.3.13 / 1.3.12, private/members-only archive or archive off (row e corrected 2026-07-04) |
| `discuss` list | Public/open discussion list with public archive; source/transport reconciled, smoke proof tracked on TIN-2498 |
| Anubis v1.25.0 | Behind the Cloudflare tunnel (edge apply in the infra overlay); default-allow with a single CHALLENGE rule scoped to the join/contact form route only; `/agent`, `/llms.txt`, and SEO surfaces stay unguarded once the apex gate opens (row f) |

## Related

- Decision packet: [`docs/decisions/0001-gftb-mvp-decisions.md`](../../docs/decisions/0001-gftb-mvp-decisions.md) (TIN-2360)
- Names-only secrets contract: [`secrets.contract.yaml`](../../secrets.contract.yaml)
- Declarative DNS record set: [`../dns-intent/`](../dns-intent/README.md)
- Manual DNS checklist: [`docs/runbooks/dns-mail-checklist.md`](../../docs/runbooks/dns-mail-checklist.md)
- Apply-plane runbook: `great-falls-tool-bus-infra/docs/edge-apply-runbook.md` (local pointer stub: [`docs/runbooks/dns-apply.md`](../../docs/runbooks/dns-apply.md))
- Keyholders list-client instructions: [`docs/runbooks/keyholders-client-setup.md`](../../docs/runbooks/keyholders-client-setup.md)
- Spoke infra proper (the five composed modules): [`../README.md`](../README.md)
