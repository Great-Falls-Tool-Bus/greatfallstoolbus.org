# 0001 — GFTB MVP decisions (prompt-50 DAG step 1, NEW-1)

- **Linear anchor:** TIN-2360 ("GFTB MVP decisions (NEW-1) — operator decision
  packet"), project-less by design.
- **Sibling packet:** `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` PR #4
  (`docs/mvp-decision-packet.md`) — the runner/IaC-side copy of this packet.
- **Status:** reconciled 2026-07-02 against the operator brief of 2026-07-02,
  which initiated this repo spawn ("this is a repo + tree initiation flow") and
  answered rows (a), (e), (j) outright. Rows marked RECOMMENDED-DEFAULT were
  adopted provisionally to unblock the spawn; they flip to DECIDED with a dated
  operator line per row on TIN-2360. Row (h) remains OPEN and gates
  **money-donation copy only** — not the spawn, not tool-donation copy.

| # | Question | Decision | Status |
|---|----------|----------|--------|
| a | Repo shape | One PUBLIC monorepo; `latoolb.us` = DNS redirect/alias + mail domain, never a second site repo | **OPERATOR-ANSWERED** (2026-07-02 brief) |
| b | Repo home | `Great-Falls-Tool-Bus/greatfallstoolbus.org` (this repo) | RECOMMENDED-DEFAULT, adopted — org exists, holds `great-falls-tool-bus-infra`, has live ARC tenancy per TIN-2299 (Done 2026-07-02) |
| c | IaC home | Three planes: **declare-only** tofu/intent in this repo (public-safe, zero secrets/endpoints/state); **runtime apply** (mail/list/Anubis/tunnel/DNS) in blahaj per the MassageIthaca precedent; **runner tenancy** in `great-falls-tool-bus-infra` per TIN-2299 | RECOMMENDED-DEFAULT, adopted |
| d | Public-repo SOPS posture | **Zero secrets in this repo, ever** — a names-only `secrets.contract.yaml` is the public surface; sops+age material lives blahaj-side under the prepared `tenants/great-falls-tool-bus/secrets/` lane with a **distinct age recipient** for this tenant; CI decrypt (if ever needed) via protected GitHub *environment* secrets, never repository secrets. DKIM private keys never appear as public ciphertext (DNS-pinned = effectively unrotatable; age has no revocation) | RECOMMENDED-DEFAULT, adopted |
| e | List engine | Mailman 3 + HyperKitty (+ Postorius), pinned trio 3.3.10 / 1.3.13 / 1.3.12; first-of-kind deployment on blahaj — staged before announcement; ADR to follow blahaj-side | **OPERATOR-ANSWERED** ("we'll want to use hyperkitty") |
| f | Anubis placement | Behind the blahaj Cloudflare tunnel, default-allow + one CHALLENGE rule scoped to the join/contact form route only; archive, `/agent`, `/llms.txt` and all SEO surfaces stay unguarded; house's FIRST real Anubis deployment (ADR + runbook blahaj-side) | RECOMMENDED-DEFAULT, adopted (operator named Anubis-on-form; placement detail is the default) |
| g | DNS authority | House plane: Cloudflare via blahaj; DreamHost stays registrar-only. Mail DNS (MX→relay.tinyland.dev, SPF, DKIM, DMARC) is a manual, operator-visible checklist (`external_dns_create_mx_records = False`) | RECOMMENDED-DEFAULT — **gates DNS work, not this repo** |
| h | Donation legal framing | **OPEN — needs operator verbatim.** Binding interim guardrails on all public copy: recipient-neutral, zero tax-deductibility claims, tinyland.dev lab framed as aspiration only. Tool-donation copy (transportable / mark-the-bits / repairability) is NOT gated | **OPEN-NEEDS-OPERATOR** |
| i | Linear home | NEW-1 = TIN-2360 (exists; never re-mint). NEW-2 (this spawn + site MVP) and NEW-4 (keyholders list + archive) mint project-less, related-linked to TIN-2360. NEW-3 (first production MailAccount) mints in "Business Operations — Tinyland, Inc." cross-linked to TIN-373. No new project or initiative inside the MVP window. Titles always contain "greatfallstoolbus"/"GFTB" (plain "toolbus" tokenizes to zero Linear hits) | RECOMMENDED-DEFAULT, adopted |
| j | "L-A tool bus" | Confirmed: latoolb.us = Lewiston-Auburn tool bus (Great Falls of the Androscoggin between Lewiston and Auburn) | **OPERATOR-ANSWERED** (implicit in brief; one-line confirm requested on TIN-2360) |

## Boundary contract this repo is born into

- **This repo OWNS:** the public site, tool-inventory content (MDX pipeline is
  NEW-2 follow-up work), printable cell sheets, bibliography/shout-outs/donate/
  wants pages, declare-only IaC intent, `/agent` + `/llms.txt` agent surfaces.
- **This repo NEVER HOLDS:** `.enc.yaml` ciphertext or age keys; Cloudflare or
  any DNS credentials; cluster hostnames / grpc:// endpoints / RFC1918 hosts
  (`just scan-endpoints` gate); raw `--remote_cache` / `--remote_executor`
  values; tofu state or backend coordinates; DKIM private keys.
- **blahaj OWNS:** mail transport (postfix/dovecot/rspamd/account-controller,
  `mail.tinyland.dev/v1alpha1` CRDs), Mailman/HyperKitty runtime, Anubis
  runtime, Cloudflare DNS/tunnel, SOPS secret plane, protected plan/apply.
  Note: local truth reads must use the **fresh** blahaj clone
  (`~/git/blahaj-infra-boundary`, main); `~/git/blahaj` is a stale 2026-05-18
  snapshot.
- **great-falls-tool-bus-infra OWNS:** ARC runner tenancy (TIN-2299 sense-3
  overlay). CI here consumes the pool; this repo never scaffolds a runner and
  never bakes an endpoint. Until the public token exchange clears L5
  (TIN-2364), flywheel CI lanes ride scaffold-inherited **skip-green** gates
  (both `vars.FLYWHEEL_ENABLED` and `vars.FLYWHEEL_EXECUTOR_ENABLED` OFF).

## Greenfield firsts (each named in its Linear issue when minted)

1. First PUBLIC spoke repo (exceeds the private MassageIthaca exemplar's bar).
2. First production MailAccount application(s) (`keyholders@latoolb.us`) —
   coordinate with, never absorb, TIN-373 (`hello@tinyland.dev`).
3. First mailing-list engine deployment in the house (Mailman3/HyperKitty).
4. First real Techaro Anubis deployment (the tinyland.dev Caddy snippet is
   name-only).

## Sign-off checklist (operator, on TIN-2360)

- [ ] Approve or amend defaults (b), (c), (d), (f), (g), (i)
- [ ] Supply row (h) verbatim (personal receipt / fiscal sponsor / tools-only)
- [ ] One-line confirm of (j)
- [ ] Clarify what "movement" refers to (no Linear initiative matches; "uplift"
      maps to the site.scaffold UPLIFT project 55d2b0d0)
- [ ] Whether Kate Pulham's shout-out wording needs her sign-off before the
      shout-outs page leaves recipient-neutral phrasing
