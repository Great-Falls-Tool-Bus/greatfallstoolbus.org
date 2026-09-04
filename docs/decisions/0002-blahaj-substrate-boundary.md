# Blahaj as swappable substrate: the GFTB boundary contract

**Date:** 2026-07-02 · **Trigger:** operator correction (verbatim intent: "the apply plane for GFTB belongs in great-falls-tool-bus-infra; blahaj is the IaC substrate LAYER and must stay logically replaceable, never intertangled with projects"). Recorded in session memory (`gftb-initiation-2026-07.md`, BOUNDARY CORRECTION bullet) and acknowledged by the corrective agent on TIN-2378 (comment b25465d8, 2026-07-02T21:03:49Z: "blahaj = swappable substrate; apply plane re-homes to great-falls-tool-bus-infra").

**Operational status (2026-09-04): boundary retained; execution mechanics
superseded.** This ADR remains the ownership provenance for the consumer-owned
overlay. Its dispatch, app-deploy, and provider-interface examples are
historical and must not be recreated. The active application contract is
`tinyland.repo.json` against the schema-v2 manifest plus `docs/CI-SCHEMA.md`:
the application owns product source, finite Bazel targets, and ActionPlan/v4;
the organization overlay owns signed consumer instances and owner
transactions; GF owns interface types and verification; provider supply and
placement stay opaque to the application.

**Process rule:** every surface this memo contradicts takes a **dated correction note citing the decision, never a silent rewrite** (decision-ledger-2026-07.md:103-108). Mint **ledger item 19** for this correction, citing item 18 (the TIN-2360 packet sign-off), so downstream docs have a citable number.

**Amendment note — 2026-07-02, TIN-2385 / ledger item 20:** the Cloudflare
edge-authority carve-out resolved to option (ii): the private
`Great-Falls-Tool-Bus/great-falls-tool-bus-infra` overlay may hold a protected
environment token scoped only to the two GFTB zones and applies GFTB
DNS/Access/redirect resources through its edge stack. Where this memo's
original text says blahaj keeps DNS/Access/Tunnel apply for these zones, read
that as superseded for GFTB only. blahaj remains the substrate and retains
custody for house zones and its shared tunnel/mail infrastructure.

**Terminology (load-bearing):** the three senses of "module" stay separate (house-glorious-build-saas.md:44-57): sense-1 = registry module (bzlmod latch), sense-2 = consumer latch (endpoint-free `.bazelrc.flywheel` + env-delivered endpoints), sense-3 = **org implementation overlay** — "a thin private repo that is an org's entire on-prem integration… Five surfaces, no module logic" (organization.yaml; arc-runners tfvars; `tofu/backend/*.s3.hcl` state coordinates; Justfile wrapping GF-core scripts; pinned CI + vendored taxonomy validator — TIN-2299). That contract is **runner-plane-scoped**. This memo **extends** the overlay's remit — do not silently widen "sense-3"; name the extended role the **org apply-plane overlay**: a sense-3 overlay that additionally owns the org's runtime stacks under the arc-runners ownership model (reusable stack code upstream; overlay owns config + state coordinates + the apply lane — TIN-2299 surfaces 2–5). Record this as a TIN-2299 addendum + house-glorious-build-saas amendment.

## (a) The layering

### Layer 1 — Substrate: `tinyland-inc/blahaj` (+ the honey cluster)
- **OWNS:** the physical cluster and its IaC (honey, RKE2, zero public IP — "any old cluster a user might have… never a required dependency", house-glorious-build-saas.md:58-63); Cloudflare edge custody — DNS/Access/Tunnel apply and credentials (prompts/53:88-89; house-secrets-fleet.md:30-33,66-67; house-ecosystem-map.md:33,47); the shared mail **transport** (postfix/dovecot/rspamd + account-controller — prompt 50:159-174 "do not rebuild it"); the shared SOPS plane's per-tenant recipient rule (prepared `tenants/.*/secrets/.*` rule, prompt 50:99-104); and provider-side capacity and placement under its own manifest.
- **NEVER:** tenant application source or consumer-owned demand instances; provider placement does not enter an application ActionPlan or manifest.
- **INTERFACE:** `mail.tinyland.dev/v1alpha1` MailDomain/MailAccount CRDs, `relay.tinyland.dev` MX/transport, and the upstream GF contracts resolved through the consumer-owned organization overlay. The application never consumes a cluster endpoint, kubeconfig, state backend, or provider route directly.

### Layer 2 — Org apply-plane overlay: `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` (private; sense-3 per TIN-2299 L6, remit extended per this memo)
- **OWNS:** **all** GFTB apply-plane concerns, including the future signed
  `OwnerInstallation/v1`, `TenantOverlay/v1`, consumer `RevocationSet/v1`, and
  `OwnerOverlayRevision/v1` instances; application pins, workloads, state, and
  secret declarations; mail/list/edge intent realization; and authorized owner
  transactions. Existing ARC/manual surfaces are state-continuity inventory,
  not v4 enrollment or convergence authority.
- **NEVER:** application source or business data; reusable GF types/verifiers;
  provider supply, placement, or endpoints; physical-cluster lifecycle; or
  shared transport implementation.
- **INTERFACE:** consumes qualified GF controller results and the Layer-1
  services its own manifest names. Missing GF-I07/GF-I09 authority fails closed;
  it does not restore a dispatch, direct endpoint, or attended application
  release as the product path.

### Layer 3 — Project/spoke: `Great-Falls-Tool-Bus/greatfallstoolbus.org` (public)
- **OWNS:** the public product source, finite Bazel targets, `.github/lanes.json`
  ActionPlan/v4 declaration, declare-only DNS/mail intent, and the canonical
  decision packet (`docs/decisions/0001`).
- **NEVER (boundary contract, packet 0001 — unchanged):** `.enc.yaml`
  ciphertext or age keys; Cloudflare or DNS credentials; cluster hostnames or
  REAPI endpoints; OpenTofu state/backend coordinates; DKIM private keys;
  final OCI construction/publication; application pins/workloads; or apply.
- **INTERFACE:** the immutable v4 CI-template invocation and verified
  `ActionOutputSet/v1`; publication and convergence begin only in qualified GF
  and owner-overlay transactions.

**Grounding for the layering as doctrine, not fiat:** ledger item 2 — "Repo ownership is NOT a blocker — anywhere… fix the overlay, delete the framing" (decision-ledger-2026-07.md:14-18); TIN-2353 (L3) treats house-coupling in substrate defaults as a defect to remove; TIN-2364 (L5) retires compiled house identity so the house becomes an ordinary owner row of its own substrate; blahaj ADR 008 / Route B via TIN-2029's reducibility inventory (`blahaj/docs/architecture/blahaj-reducibility-inventory.md`) — every blahaj component is classified reusable / site-specific / dead, i.e. decomposability is standing doctrine. **Citation hazard:** cite the modularization doctrine as "blahaj ADR 008 (Route B), via TIN-2029" — bare "ADR-008" collides with dollhouse-farm's TIN-2090, and the blahaj ADR file itself is not yet written (blahaj `docs/architecture/decisions/` holds only 001–007; prompt 09:106-108).

## (b) How this refines the MassageIthaca precedent

MI = the blahaj-embedded shape (`tofu/stacks/massageithaca{,-db,-deploy}` + bespoke receivers) = **legacy**, and was already recorded as such before today: the exception register's stop-line "Do not use the fixed-lane wrapper, stack shape, or branch mapping as a template" (:31) and "not the durable app deployment substrate" (:4); TIN-2020 calls the MI receiver "a legacy compatibility adapter"; TIN-1520 shows the pattern propagated by sed-copy — the exact intertangling the correction targets. The schema-v2 manifest and `docs/CI-SCHEMA.md` now make that prohibition mechanical for this consumer. Signed row (c)'s grounding "per the MassageIthaca precedent" was therefore **already forbidden by blahaj's own doctrine** — the correction restores the written rule rather than inventing one.

**The new exemplar is the GFTB pattern:** the consumer-owned org apply-plane overlay. Its live proof is jesssullivan-infra, which already runs full runtime stacks (jesssullivan-blog-shadow, euthanasiapettingparts-shadow: Deployment + Service + Tailscale Ingress + NetworkPolicy in an own namespace, own state key, applied by overlay CI, "No blahaj edits"). GFTB is the first **external-org** instance and should be named as the reference for all new tenants. Surfaces still calling MI "the reference" (house-ecosystem-map.md:24-26; prompt 53:178-179) take dated correction notes. **MI migration is not mandated** by this correction — the MI stacks stay grandfathered as adopted-live transitional receivers; convergence rides TIN-1981/MMS (open question, prompts/53:275-277).

## (c) The replaceability test

If provider supply changes, the application repository remains byte-identical:
its schema-v2 manifest names only the consumer-owned organization overlay, and
its ActionPlan names only finite Bazel targets plus an abstract capability.
Provider endpoints, credentials, workers, storage, and placement remain outside
the application and its workflow. If a provider swap requires an application
source, schema, or workflow change, that is a boundary defect.

## (d) What blahaj legitimately keeps

1. **The physical cluster + its IaC** — honey is "any old cluster a user might have," never a required dependency (house-glorious-build-saas.md:58-63).
2. **Shared mail transport as a service** — postfix/dovecot/rspamd + account-controller stay blahaj; the public interface is `relay.tinyland.dev` plus the MailDomain/MailAccount CRDs. Tenants declare CRs; the transport delivers. Do not rebuild it (prompt 50:159-174).
3. **Cloudflare account custody — OPERATOR CHOICE, flagged:** either (i) status quo — blahaj keeps CF apply, tenants declare intent, the credential ban stands; or (ii) mint a zone-scoped CF token for greatfallstoolbus.org + latoolb.us into the infra repo's protected environment — which requires a **new edge-authority decision** amending prompts/53:88-89 and house-secrets-fleet.md:30-33. Until decided, tunnel/DNS **apply** stays blahaj-side; "ALL apply-plane concerns" is read with this single carve-out.
4. **The shared SOPS plane** hosting per-tenant recipients, plus the irreducible transport-consumed ciphertext: DKIM private keys are mounted into blahaj-owned postfix/rspamd and are DNS-pinned/unrotatable, so they stay in blahaj's `tenants/great-falls-tool-bus/secrets/` lane. Everything else GFTB-encrypted lives in the infra repo.
5. **Provider-side execution supply**, consumed only through the GF contracts
   resolved from consumer-owned signed demand. It never becomes an
   application-owned receiver, endpoint, or fallback.

## Appendix — surfaces requiring dated correction notes (never silent rewrites)

Canonical packet row (c) + boundary block (`greatfallstoolbus.org docs/decisions/0001`); the infra-repo pointer copy (`docs/mvp-decision-packet.md`, commit 23c1e68); TIN-2360 (re-opened In Review 21:03:56Z — land the amendment, re-close); TIN-2378/2379/2380 bodies; `docs/CI-SCHEMA.md`; house-spoke-deploy-lanes.md:93,98-99; house-ecosystem-map.md:24-26 (MI as "the reference"); prompt 50 header + steps 4/5 (:6,304-317); 23-blahaj-gitops-cloud-exit.md:29-31 (golden-story "app deploy status"); tinyland-whoami SKILL.md infra/owner-overlay enumeration. Mint decision-ledger item 19 citing item 18.
