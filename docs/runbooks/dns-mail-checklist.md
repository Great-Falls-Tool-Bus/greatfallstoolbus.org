# DNS + mail cutover — verification matrix and historical checklist

> **STATUS (2026-07-04): this checklist is EXECUTED.** latoolb.us NS is on
> Cloudflare (zone active), MX/SPF/DKIM/DMARC live and tofu-managed in
> great-falls-tool-bus-infra `tofu/stacks/edge` (`mail_dns_enabled=true`) —
> records are no longer manual-panel steps. Live SPF:
> `v=spf1 ip4:45.61.188.177 ip4:71.168.64.84 mx ~all` (relay + honey egress,
> live-evidence reconcile, infra PR #28). Certification: port25 SPF pass +
> DKIM pass, 2026-07-04. This document remains as the historical procedure +
> verify matrix.


**TIN-2360 row (g), DECIDED 2026-07-02; executed state amended 2026-07-04.**
House DNS plane is Cloudflare; GFTB zone apply is the org overlay
`great-falls-tool-bus-infra` (zone-scoped token, TIN-2385); DreamHost stays
registrar-only. The original checklist was deliberately operator-visible
because the shared blahaj mail stack does not create tenant MX records
automatically. The current state is newer: DNS records are now managed by the
GFTB infra overlay, and this file is the repo-local verification matrix plus
historical procedure.

Scope: `greatfallstoolbus.org` (web) and `latoolb.us` (mail + redirect
alias). Nothing in this repo applies any of this; this checklist is executed
by the operator against the Cloudflare zones the apply plane
(`great-falls-tool-bus-infra`) manages. The API-level apply steps (zone
create, record create, redirect ruleset, DreamHost read-only capture) are
documented in `great-falls-tool-bus-infra/docs/edge-apply-runbook.md`
(local pointer stub: [`dns-apply.md`](./dns-apply.md)); the declarative
record set
is [`tofu/dns-intent/intent.yaml`](../../tofu/dns-intent/intent.yaml). This
checklist stays the verification surface either way.

Conventions:

- Every step ends with a verification command. Run it from any laptop; add
  `@1.1.1.1` to bypass local caches.
- For future replays, do not proceed to a mail step until the NS cutover
  (step 1) is verified.
- Values written `<like-this>` are apply-plane/operator choices and must not be
  guessed from this public repo.

---

## 1. NS cutover: DreamHost -> Cloudflare (both domains)

DreamHost remains **registrar only**. In the DreamHost panel, replace the
assigned nameservers for `greatfallstoolbus.org` and `latoolb.us` with the
pair Cloudflare assigns when the zones are added (via the infra overlay's
edge-dns stack). Recreate any records you still need in Cloudflare **before**
flipping NS.

Verify (repeat per domain; expect two `*.ns.cloudflare.com.` hosts and no
DreamHost nameservers):

```bash
dig NS greatfallstoolbus.org +short @1.1.1.1
dig NS latoolb.us +short @1.1.1.1
```

## 2. Web: apex + www for greatfallstoolbus.org -> Cloudflare Pages

Current truth is ADR 0003 and [`docs/deploy/cloudflare-pages.md`](../deploy/cloudflare-pages.md):
GFTB serves from Cloudflare Pages through the reusable `ci-templates`
Cloudflare Pages lane. Do **not** add `static/CNAME`; that was a GitHub Pages
artifact. GitHub Pages remains only the cold-standby rollback publisher.

DNS, Cloudflare Access, and tunnel/edge apply authority live in
`great-falls-tool-bus-infra`. This public repo owns only the static artifact
and the wrapper that asks Cloudflare Pages to publish it. During the REV-2
gated phase, the healthy external response is a Cloudflare Access `302`, not a
public `200`.

Verify:

```bash
dig A greatfallstoolbus.org +short @1.1.1.1
dig CNAME www.greatfallstoolbus.org +short @1.1.1.1
curl -sI https://greatfallstoolbus.org/ | head -n 5
curl -sI https://www.greatfallstoolbus.org/ | head -n 5
```

## 3. Web: latoolb.us root + www 301

`latoolb.us` is a redirect/alias + mail domain, never a second site (row a).
Current state is managed by `great-falls-tool-bus-infra` in the Cloudflare zone
for `latoolb.us`:

1. Create proxied (orange-cloud) placeholder records so the redirect rules
   have something to attach to: apex `A` -> `192.0.2.1` and `www` `CNAME` ->
   `latoolb.us` (the `192.0.2.0/24` block is reserved documentation space;
   the proxy answers before origin contact).
2. Add a Redirect Rule (or Bulk Redirect): requests for `latoolb.us/*` and
   `www.latoolb.us/*` -> the current `alias_redirect_target` in
   `great-falls-tool-bus-infra/tofu/stacks/edge/variables.tf` with status
   `301`, preserving nothing (the alias carries no paths worth preserving).

Current gated-phase truth (2026-07-03): `alias_redirect_target` is the raw
GitHub Pages fallback, `https://great-falls-tool-bus.github.io/greatfallstoolbus.org/`.
It flips to `https://greatfallstoolbus.org/` when the TIN-2421 gate opens and
the apex is publicly loadable without Cloudflare Access.

Verify (expect `301` and a `location:` equal to the current target):

```bash
curl -sI http://latoolb.us/ | grep -i -E '^(HTTP|location)'
curl -sI https://latoolb.us/ | grep -i -E '^(HTTP|location)'
curl -sI https://www.latoolb.us/anything | grep -i -E '^(HTTP|location)'
```

## 4. Mail: MX for latoolb.us -> relay.tinyland.dev

The house public MX target is `relay.tinyland.dev` (blahaj
`docs/services/mail/dns-records.md`; it is also the live MX for
`tinyland.dev`). In the `latoolb.us` zone this record is live and must remain
**DNS-only, never proxied** (Cloudflare cannot proxy SMTP):

| Name | Type | Priority | Value |
| --- | --- | --- | --- |
| `latoolb.us` | `MX` | `10` | `relay.tinyland.dev` |

Verify:

```bash
dig MX latoolb.us +short @1.1.1.1        # expect: 10 relay.tinyland.dev.
dig A relay.tinyland.dev +short @1.1.1.1 # sanity: relay resolves
```

## 5. Mail: SPF for latoolb.us

Current live record authorizes the relay plus honey egress IPs; soft-fail stays
in place while list traffic ramps:

| Name | Type | Value |
| --- | --- | --- |
| `latoolb.us` | `TXT` | `v=spf1 ip4:45.61.188.177 ip4:71.168.64.84 mx ~all` |

The mechanism list is apply-plane authority and must cover the actual outbound
egress path for mailbox and list mail. Do not tighten `~all` to `-all` until
DMARC reports (step 7) have been quiet for a full list cycle.

Verify:

```bash
dig TXT latoolb.us +short @1.1.1.1 | grep spf1
```

## 6. Mail: DKIM for latoolb.us

The DKIM key pair is **generated apply-plane-side** in the infra overlay's
sops lane (row d: the private key never appears in this repo, not even as
ciphertext; it is named — names-only — in `secrets.contract.yaml`). The
selector is chosen apply-plane-side too. The public half is published by the
infra overlay:

| Name | Type | Value |
| --- | --- | --- |
| `<selector>._domainkey.latoolb.us` | `TXT` | `v=DKIM1; k=rsa; p=<public-key-from-infra-overlay>` |

Verify the public selector from the overlay, then send a test mail to a mailbox
you control and check that the `DKIM-Signature` header validates:

```bash
dig TXT <selector>._domainkey.latoolb.us +short @1.1.1.1
```

## 7. Mail: DMARC for latoolb.us — monitor mode

Current live policy is monitor-only with aggregate reports. Tighten later,
after the list has real traffic and the reports are clean:

| Name | Type | Value |
| --- | --- | --- |
| `_dmarc.latoolb.us` | `TXT` | `v=DMARC1; p=none; rua=mailto:postmaster@latoolb.us` |

The `rua=` mailbox must exist before publishing. If it is on a different
domain than `latoolb.us`, that domain must publish the external-destination
verification record DMARC requires
(`latoolb.us._report._dmarc.<report-domain>` TXT `v=DMARC1`).

Verify:

```bash
dig TXT _dmarc.latoolb.us +short @1.1.1.1
```

## 8. Optional: MTA-STS for latoolb.us

Optional hardening; note the blahaj mail render currently ships
`enable_mta_sts = False` with `mta_sts_mode = "testing"`
(`dhall/render/mail-honey.dhall`), so coordinate blahaj-side before
enabling — the policy host and the MX must present matching certificates.
When enabled:

| Name | Type | Value |
| --- | --- | --- |
| `_mta-sts.latoolb.us` | `TXT` | `v=STSv1; id=<datestamp>` |
| `mta-sts.latoolb.us` | `A`/`CNAME` | host serving `/.well-known/mta-sts.txt` over HTTPS |

Policy file starts at `mode: testing`, listing `mx: relay.tinyland.dev`.

Verify:

```bash
dig TXT _mta-sts.latoolb.us +short @1.1.1.1
curl -s https://mta-sts.latoolb.us/.well-known/mta-sts.txt
```

---

## Exit criteria

- [x] Both zones answer from Cloudflare nameservers (step 1)
- [x] `https://greatfallstoolbus.org` and `https://www.greatfallstoolbus.org`
      serve the gated site by returning Cloudflare Access `302` responses
      during REV-2 (step 2)
- [x] `latoolb.us` root + www 301 to the current `alias_redirect_target`
      (step 3; GitHub Pages fallback during the gated phase,
      `https://greatfallstoolbus.org/` after TIN-2421 opens the Access gate)
- [x] `dig MX latoolb.us` returns `10 relay.tinyland.dev.` (step 4)
- [x] SPF, DKIM, DMARC TXT records resolve (steps 5–7)
- [x] Mailbox round-trip is certified with SPF + DKIM pass (TIN-2379)
- [ ] Mailman/HyperKitty list/archive round-trip remains TIN-2380; do not
      imply the list runtime is live from mailbox DNS success
