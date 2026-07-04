# 0001 — GFTB MVP decisions (prompt-50 DAG step 1, NEW-1)

- **Linear anchor:** TIN-2360 ("GFTB MVP decisions (NEW-1) — operator decision
  packet"), project-less by design.
- **Sibling packet:** `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` PR #4
  (`docs/mvp-decision-packet.md`) — the runner/IaC-side copy of this packet.
- **Status:** **DECIDED 2026-07-02** — operator sign-off recorded via the
  in-session interview (session 1f91b703, ~20:45Z): rows (b)(c)(d)(f)(g)(i)
  approved as recommended, (j) confirmed, and row (h) decided as **TOOLS-ONLY**
  (tool donations only until an entity exists; money conversations happen
  off-site, person-to-person; zero deductibility claims remain binding). This
  document is the **canonical** packet; the sibling copy in
  `great-falls-tool-bus-infra` PR #4 carries a pointer here.

| # | Question | Decision | Status |
|---|----------|----------|--------|
| a | Repo shape | One PUBLIC monorepo; `latoolb.us` = DNS redirect/alias + mail domain, never a second site repo | **OPERATOR-ANSWERED** (2026-07-02 brief) |
| b | Repo home | `Great-Falls-Tool-Bus/greatfallstoolbus.org` (this repo) | **DECIDED 2026-07-02** (operator sign-off) |
| c | IaC home | Three planes: **declare-only** tofu/intent in this repo (public-safe, zero secrets/endpoints/state); **runtime apply** (mail/list/Anubis/tunnel/DNS) in blahaj per the MassageIthaca precedent; **runner tenancy** in `great-falls-tool-bus-infra` per TIN-2299 | **DECIDED 2026-07-02** (operator sign-off) |
| d | Public-repo SOPS posture | **Zero secrets in this repo, ever** — a names-only `secrets.contract.yaml` is the public surface; sops+age material lives blahaj-side under the prepared `tenants/great-falls-tool-bus/secrets/` lane with a **distinct age recipient** for this tenant; CI decrypt (if ever needed) via protected GitHub *environment* secrets, never repository secrets. DKIM private keys never appear as public ciphertext (DNS-pinned = effectively unrotatable; age has no revocation) | **DECIDED 2026-07-02** (operator sign-off) |
| e | List engine | Mailman 3 + HyperKitty (+ Postorius), pinned trio 3.3.10 / 1.3.13 / 1.3.12; first-of-kind deployment on blahaj — staged before announcement; ADR to follow blahaj-side | **OPERATOR-ANSWERED** ("we'll want to use hyperkitty") |
| f | Anubis placement | Behind the blahaj Cloudflare tunnel, default-allow + one CHALLENGE rule scoped to the join/contact form route only; archive, `/agent`, `/llms.txt` and all SEO surfaces stay unguarded; house's FIRST real Anubis deployment (ADR + runbook blahaj-side) | **DECIDED 2026-07-02** (operator sign-off) |
| g | DNS authority | House plane: Cloudflare via blahaj; DreamHost stays registrar-only. Mail DNS (MX→relay.tinyland.dev, SPF, DKIM, DMARC) is a manual, operator-visible checklist (`external_dns_create_mx_records = False`) | **DECIDED 2026-07-02** (operator sign-off) — DNS work unblocked |
| h | Donation legal framing | **TOOLS-ONLY**: the site accepts tool donations only until an entity exists; money conversations happen off-site person-to-person. Zero tax-deductibility claims and lab-as-aspiration framing remain binding | **DECIDED 2026-07-02** (operator sign-off) |
| i | Linear home | NEW-1 = TIN-2360 (exists; never re-mint). NEW-2 (this spawn + site MVP) and NEW-4 (keyholders list + archive) mint project-less, related-linked to TIN-2360. NEW-3 (first production MailAccount) mints in "Business Operations — Tinyland, Inc." cross-linked to TIN-373. No new project or initiative inside the MVP window. Titles always contain "greatfallstoolbus"/"GFTB" (plain "toolbus" tokenizes to zero Linear hits) | **DECIDED 2026-07-02** (operator sign-off) |
| j | "L-A tool bus" | Confirmed: latoolb.us = Lewiston-Auburn tool bus (Great Falls of the Androscoggin between Lewiston and Auburn) | **DECIDED 2026-07-02** (confirmed in sign-off interview) |

## Boundary contract this repo is born into

- **This repo OWNS:** the public site, tool-inventory content (MDX pipeline is
  NEW-2 follow-up work), printable cell sheets, bibliography/shout-outs/donate/
  wants pages, declare-only IaC intent, `/agent` + `/llms.txt` agent surfaces.
- **This repo NEVER HOLDS:** `.enc.yaml` ciphertext or age keys; Cloudflare or
  any DNS credentials; cluster hostnames / grpc:// endpoints / RFC1918 hosts;
  raw `--remote_cache` / `--remote_executor` values; tofu state or backend
  coordinates; DKIM private keys. Enforced today by gitleaks (`just
  secrets-scan-dir` / `secrets-scan`), the conformance endpoint checks, and
  the dedicated `just scan-endpoints` denylist gate (goo's
  `scripts/scan-internal-endpoints.sh` shape, ported under TIN-2366 and
  wired into `just conformance` so the suite fails closed on leaks).
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

## Sign-off record (2026-07-02, in-session interview)

- [x] Rows (b), (c), (d), (f), (g), (i) approved as recommended
- [x] Row (h): **tools-only** until an entity exists
- [x] Row (j) confirmed: latoolb.us = Lewiston-Auburn tool bus
- [x] "movement" = the UPLIFT follow-through (driving prompts 34–38/52
      execution across spokes); no new Linear object
- [ ] Kate Pulham shout-out wording sign-off — still open (current copy stays
      modest/recipient-neutral)


---

## Amendment 1 — row (c): IaC home (AMENDED 2026-07-02, operator correction; ledger item 19, citing item 18)

**Superseded text (retained per the no-silent-rewrite rule):**

> ~~(c) IaC home — three planes: declare-only tofu/intent in this repo; runtime
> apply (mail/list/Anubis/tunnel/DNS) in blahaj per the MassageIthaca precedent;
> runner tenancy in `great-falls-tool-bus-infra` per TIN-2299.~~

**Replacement row (c):**

> **(c) IaC home.** The GFTB **apply plane** lives in
> `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` — the org's implementation
> overlay (TIN-2299 L6), remit extended to the full **org apply-plane overlay**.
> Runner tenancy (live), mail intent as CR manifests
> (`mail.tinyland.dev/v1alpha1` MailDomain/MailAccount for latoolb.us), the list
> engine (Mailman3/Postorius/HyperKitty), and Anubis all land as `tofu/stacks/*`
> + manifests in the infra repo, planned and applied by its protected plan/apply
> CI against substrate interfaces (namespace-scoped kubeconfig; RustFS state
> under the repo's own prefix).
>
> **blahaj is a substrate**, consumed only through named interfaces — the
> MailDomain/MailAccount CRDs, `relay.tinyland.dev` transport, the S3 tofu-state
> endpoint, namespace-scoped kubeconfig grants, and the dispatch schemas — and
> must remain **logically replaceable**: no GFTB stack, schema, or workflow may
> assume blahaj internals. The replaceability test: swapping the substrate may
> change endpoint values and credential material in this org's repos, and
> nothing else.
>
> **Carve-out — RESOLVED 2026-07-02 (TIN-2385, operator interview; ledger
> item 20):** option (ii) — the infra repo's protected environment holds a
> **Cloudflare token scoped to exactly the two GFTB zones**; the overlay
> applies its own DNS/Access/Tunnel-route changes. The binding overlay-
> credential rule is narrowed with dated notes (spokes and non-owner repos:
> unchanged; owner overlays: own-zones-scoped tokens only). blahaj keeps CF
> custody for house zones and its tunnel daemon.
>
> **The MassageIthaca precedent is demoted to legacy reference.** blahaj's own
> doctrine already classifies `tofu/stacks/massageithaca*` as adopted-live
> transitional, "not templates." The exemplar for new tenants is the
> consumer-owned overlay pattern (this org's infra repo).

**Boundary-contract deltas:** `great-falls-tool-bus-infra` OWNS protected
plan/apply for all GFTB stacks, GFTB state coordinates, GFTB ciphertext under
the distinct GFTB age recipient (repo-local `.sops.yaml`), and DNS/tunnel
intent. blahaj OWNS the cluster, the mail transport (interface: CRDs +
relay.tinyland.dev), CF edge custody per the carve-out, the shared SOPS tenant
rule — and, as the ONLY GFTB ciphertext it hosts, transport-consumed DKIM
private keys under `tenants/great-falls-tool-bus/secrets/`. This public repo's
NEVER list is unchanged. **Row (d) custody delta:** the ciphertext lane
re-homes to the infra repo except the DKIM carve-out.

**Operator signature:** directed verbatim in-session 2026-07-02 ~21:00Z ("the
blahaj repo should be logically replaceable and not an intertangled part of our
projects"); **countersigned 2026-07-02 ~21:35Z** (in-session; recorded on
TIN-2360, which re-closed Done).

---

## Amendment 2 — row (g): execution end-state record (AMENDED 2026-07-03, citing the wf_13f12359 recheck)

Row (g) is not superseded — this amendment records the **executed end-state**
of the DNS-authority decision plus the truthful CI status as verified by the
wf_13f12359 recheck.

**DNS end-state (executed 2026-07-03):**

- **greatfallstoolbus.org NS is on Cloudflare** — cutover executed 2026-07-03,
  zone active 09:13Z, apex Access-gated per REV-2.
- **latoolb.us NS stays on DreamHost** (REV-2).
- A **Cloudflare zone for latoolb.us exists but is undelegated** — harmless;
  its redirect ruleset stays dormant until/unless NS delegation ever moves.

> **AMENDMENT (dated 2026-07-04, operator): repos PRIVATE for now.** Row (d)
> made this repo PUBLIC; the operator flipped both org repos private on
> 2026-07-04 pending launch — consistent with the gated apex + the
> naming-consent policy (consent-pending names live in repo content). CF
> Pages serving is unaffected (wrangler direct upload). Re-publicizing the
> repo joins the TIN-2421 gate-opening sweep. Note: GH Pages rollback (ADR
> 0003) requires public-or-paid — acceptable while CF Pages is primary.

> **CORRECTION (dated 2026-07-04, supersedes the two latoolb.us lines above —
> D1=A executed):** the operator repointed **latoolb.us NS to Cloudflare**
> (austin/oaklyn) on 2026-07-03; the zone went **active** the same evening.
> MX/SPF/DKIM/DMARC are live and CI-managed in the infra edge stack
> (`mail_dns_enabled=true`; SPF authorizes the relay + honey egress IPs per
> infra PR #28). The **mail stack is certified both directions** — port25
> verifier: SPF pass + DKIM pass (2026-07-04; TIN-2379 comment 5e2038c9).
> The redirect ruleset now serves (301 target still github.io until the gate
> opens, TIN-2421). TIN-2379's runtime split: inbound + outbound-signed mail
> LIVE; list/archive = TIN-2380 (draft infra PR #27, not applied); Anubis
> direct-submit = TIN-2420 Path B.

**CI status (truthful line from the wf_13f12359 recheck):**

> CI cache-first attach LIVE with native cache-hit proof on the legacy
> in-cluster endpoint; zero remote execution BY DESIGN (CACHE-FIRST doctrine,
> TIN-1997 Option D); org-grained tenancy gated on TIN-2364 L5.

---

## Amendment 3 — row (f): gated posture vs. "unguarded" surfaces (AMENDED 2026-07-03, citing grounding audit wf_0118a02c)

Row (f) is not superseded — this amendment corrects the record on **when** its
surface claims hold. Row (f)'s "archive, `/agent`, `/llms.txt` and all SEO
surfaces stay unguarded" describes the **gate-open end-state**, not the
present.

**Present state (verified 2026-07-03):**

- Per REV-2 the Anubis "unguarded form" activation is **deferred until
  gate-open**. No Anubis instance is live; dormancy until mail lands and the
  gate opens is decided (TIN-2378 comment b25465d8), not drift.
- `/agent` + `/llms.txt` currently sit behind the **stronger apex gate**: the
  apex, `www`, and `pages.dev` hosts all serve from Cloudflare Pages but are
  Access-gated (302 to Access login; allowlist = jess@sulliwood.org). Nothing
  on the site is "unguarded" today — every surface is behind a gate stronger
  than the CHALLENGE rule row (f) scopes to the form route.
- The Anubis **origin placement** (which hostname/origin serves the
  challenge-guarded form) is an **explicitly deferred sub-decision, tracked
  as TIN-2420**; 0003 Decision 2's `gftb-forms.tinyland.dev` is an example,
  not a binding choice.
- Exit from the gated posture is decision **D2** — see
  `0004-gate-opening-criteria.md`. Until that packet is signed, gate-opening
  is UNOWNED.
