# DNS + mail cutover: manual operator checklist

> **STATUS (2026-07-04): this checklist is EXECUTED.** latoolb.us NS is on
> Cloudflare (zone active), MX/SPF/DKIM/DMARC live and tofu-managed in
> great-falls-tool-bus-infra `tofu/stacks/edge` (`mail_dns_enabled=true`).
> Records are no longer manual-panel steps. Live SPF:
> `v=spf1 ip4:45.61.188.177 ip4:71.168.64.84 mx ~all` (relay + honey egress,
> live-evidence reconcile, infra PR #28). Certification: port25 SPF pass +
> DKIM pass, 2026-07-04. This document remains as the historical procedure +
> verify matrix.


**TIN-2360 row (g), DECIDED 2026-07-02.** House DNS plane is Cloudflare;
GFTB zone apply is the org overlay `great-falls-tool-bus-infra`
(zone-scoped token, TIN-2385); DreamHost stays registrar-only. Mail DNS is a **manual,
operator-visible checklist by design**: the blahaj mail stack pins
`external_dns_create_mx_records = False` (blahaj repo,
`dhall/render/mail-honey.dhall`; the flag is declared in
`dhall/stacks/mail.dhall`), so no controller will ever create MX records for
us. Every record below is placed by a human and verified by a human.

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
- Do not proceed to a mail step until the NS cutover (step 1) is verified.
- Values written `<like-this>` are chosen at execution time (most of them
  apply-plane-side) and must not be guessed.

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

## 2. Web: apex + www for greatfallstoolbus.org -> Pages

Repo-side precondition (scaffold contract, see `AGENTS.md` "Deploy lane"):
add `static/CNAME` containing `greatfallstoolbus.org` and build with
`BASE_PATH=""` before pointing DNS, otherwise the Pages build serves broken
project-path URLs.

In the Cloudflare zone for `greatfallstoolbus.org` (GitHub Pages lane, the
shipped default in `.github/workflows/deploy-pages.yml`):

| Name | Type | Value |
| --- | --- | --- |
| `greatfallstoolbus.org` (apex) | `A` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `www` | `CNAME` | `great-falls-tool-bus.github.io` |

Set both records **DNS-only (grey cloud)** until GitHub Pages finishes
custom-domain verification and issues the certificate; only then optionally
enable the Cloudflare proxy. If the spoke later opts into Cloudflare Pages
(`docs/deploy/cloudflare-pages.md`), replace both rows with the CNAMEs that
lane documents.

Verify:

```bash
dig A greatfallstoolbus.org +short @1.1.1.1
dig CNAME www.greatfallstoolbus.org +short @1.1.1.1
curl -sI https://greatfallstoolbus.org/ | head -n 5
curl -sI https://www.greatfallstoolbus.org/ | head -n 5
```

## 3. Web: latoolb.us root + www 301

`latoolb.us` is a redirect/alias + mail domain, never a second site (row a).
In the Cloudflare zone for `latoolb.us`:

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
`tinyland.dev`). In the `latoolb.us` zone add, **DNS-only, never
proxied** (Cloudflare cannot proxy SMTP):

| Name | Type | Priority | Value |
| --- | --- | --- | --- |
| `latoolb.us` | `MX` | `10` | `relay.tinyland.dev` |

Verify:

```bash
dig MX latoolb.us +short @1.1.1.1        # expect: 10 relay.tinyland.dev.
dig A relay.tinyland.dev +short @1.1.1.1 # sanity: relay resolves
```

## 5. Mail: SPF for latoolb.us

Starting record (authorizes the MX host; soft-fail while ramping):

| Name | Type | Value |
| --- | --- | --- |
| `latoolb.us` | `TXT` | `v=spf1 mx ~all` |

The final mechanism list is **blahaj-side authority**: it must cover the
actual outbound egress path for list mail (per blahaj
`docs/services/mail/dns-records.md`, house outbound currently goes direct
from the on-prem edge, not through the relay), so expect to widen this
record when the Mailman deployment lands. Do not tighten `~all` to `-all`
until DMARC reports (step 7) have been quiet for a full list cycle.

Verify:

```bash
dig TXT latoolb.us +short @1.1.1.1 | grep spf1
```

## 6. Mail: DKIM for latoolb.us

The DKIM key pair is **generated apply-plane-side** in the infra overlay's
sops lane (row d: the private key never appears in this repo, not even as
ciphertext; it is named, names-only, in `secrets.contract.yaml`). The
selector is chosen apply-plane-side too; for
reference, `tinyland.dev`'s live selector is `mail`.

Publish the public half handed over by the apply-plane operator:

| Name | Type | Value |
| --- | --- | --- |
| `<selector>._domainkey.latoolb.us` | `TXT` | `v=DKIM1; k=rsa; p=<public-key-from-infra-overlay>` |

Verify (then send a test mail to a mailbox you control and check the
`DKIM-Signature` header validates, e.g. via the provider's "show original"):

```bash
dig TXT <selector>._domainkey.latoolb.us +short @1.1.1.1
```

## 7. Mail: DMARC for latoolb.us (start at p=none)

Start in monitor-only mode with aggregate reports; tighten later, after the
list has real traffic and the reports are clean:

| Name | Type | Value |
| --- | --- | --- |
| `_dmarc.latoolb.us` | `TXT` | `v=DMARC1; p=none; rua=mailto:<operator-chosen report mailbox>` |

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
enabling, the policy host and the MX must present matching certificates.
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

- [ ] Both zones answer from Cloudflare nameservers (step 1)
- [ ] `https://greatfallstoolbus.org` and `https://www.greatfallstoolbus.org` serve the site (step 2)
- [ ] `latoolb.us` root + www 301 to the current `alias_redirect_target` (step 3;
      GitHub Pages fallback during the gated phase, `https://greatfallstoolbus.org/`
      after TIN-2421 opens the Access gate)
- [ ] `dig MX latoolb.us` returns `10 relay.tinyland.dev.` (step 4)
- [ ] SPF, DKIM, DMARC TXT records resolve (steps 5–7)
- [ ] A round-trip test mail to `keyholders@latoolb.us` is delivered and
      passes SPF + DKIM + DMARC in the receiving provider's headers,
      only meaningful after the overlay-applied MailAccount/list exist
