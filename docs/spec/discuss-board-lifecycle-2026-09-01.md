# Discuss Board Account Lifecycle - 2026-09-01

Linear: `TIN-3964`, `TIN-3813`, `TIN-3965`, `TIN-4208`, `TIN-4216`

This spec binds the discuss-board account lifecycle for the Great Falls Tool
Bus platform: who can read the HyperKitty discuss archive, who can write to
`discuss@latoolb.us`, how a member acquires write access, and when the public
site may ship the board as a top-level nav item. It records the operator
ruling and maps it onto the ratified meta clauses and the operator-ratified
unified-identity carrier. Meta PR #58 must land before this implementation;
until then its identity/archive rows are a merge-order dependency, not a claim
about current `meta` main.

## Operator ruling (2026-09-01, recorded verbatim)

> the Hyperkitty discuss board should become a top-level nav item on the
> public site; ANYONE can READ the discuss board; becoming a WRITER requires
> becoming a member — membership account creation is the ONLY path that adds
> users to the discuss board (the members account-creation structures add
> users to discuss automatically), as already established in the
> architecture/topology docs and tickets.

The ruling restates, and this spec is subordinate to, the meta authorities
cited below. Where an implementation detail here conflicts with the landed
record, the landed record wins.

## Read / write / subscribe matrix

| Capability | Who | Mechanism | Authority |
| --- | --- | --- | --- |
| Read the discuss archive | Anyone, anonymously | Public `archive_policy` on `discuss@latoolb.us`; HyperKitty recomputes authorization per request | ADR 0019 §2.2: "the private-board read grant is a **derived** property — a pure function of (archive account exists) × (address is subscribed)… **Do not build a `grant_board_read` projection.**" Public archive requires nothing — anonymous read is the design. |
| Read the keyholders archive | Subscribed keyholders with an archive account | Private `archive_policy`; anonymous requests are refused (verified 403, see the probe log below) | ADR 0019 §1 (the gap statement): "A list subscription alone does not deliver the private archive. Reading a private board requires a second object — an archive account…" §2.2 derives the consequence: the read grant is recomputed from (archive account) × (subscription) per request. |
| Hold an archive identity | Every Active member | `provision.ensure_archive` records the entitlement to project the same immutable `person_id`; there is no second signup | Unified Member v0 identity carrier, Meta PR #58 (merge-order dependency): activation is assent and creates one member identity. Keycloak's `(iss, sub)` maps to `person_id`; mutable email is never an identity key. |
| Write to (post on) discuss | Subscribed members | Subscription-gated posting; non-member posts are held (`default_nonmember_action=hold`) | Operator ruling above; ADR 0024 §1.3: "Every Active member is subscribed to `discuss@` by default." |
| Become subscribed to discuss | Members, via activation only | Membership activation emits the list projection; no other add path is sanctioned | ADR 0024 §1.5: "Activation emits idempotent mailbox and discussion-list projection intent. The mail-automation readiness gate controls when the external effects may run, not whether the member is entitled to them… opening it must reconcile every Active member." ADR 0024 §2: "Activation is the assent." |
| Keyholders on discuss | Every keyholder, automatically | Add-only infra reconciler (`mailman-listsync` CronJob) | ADR 0017: "Every address with `role=member` on `keyholders@latoolb.us` is also a member of `discuss@latoolb.us`… enforced going forward by an automated reconciler." "The reconciler only adds `keyholders@` members to `discuss@`; it has no removal path." Disclosure rides the admission notice — "keyholders are also subscribed to `discuss@`, whose archive is public" — landing before the auto-add fires. |
| Offboarding | Departing members | `offboard.remove_lists` projection; 30-day intact recovery, 90-day purge including any orphaned archive account | ADR 0024 §3 + Amendment 1 (RA-5). |

## Provisioning flow: shipped vs planned

The intended end-to-end flow is:

```
membership activation (src/lib/server/membership/activate.ts)
  -> provision.ensure_identity
  -> provision.enable_mailbox
  -> provision.add_lists
  -> provision.ensure_archive
  -> each closed delivery gate leaves its row pending, attempts=0
  -> protected restricted interfaces later converge the mailbox, discuss
     subscription, and HyperKitty identity from the same person_id
```

Status per the 2026-09-01 recon of this repository and the infra overlay:

**Landed before this carrier**

- Outbox queue, dispatcher, and dead-letter lane (`src/lib/server/outbox/`).
- Offboarding projection intents `offboard.cancel_billing`,
  `offboard.remove_lists`, and `offboard.disable_mailbox`. The old list/mailbox
  no-op handlers are not evidence that either external effect happened.
- `stripe.project` handler.
- Application mail handlers (`application.receipt_email`,
  `application.decision_email`, `application.withdrawn_ack`) — registered,
  delivery-disabled journal outcome unless `GFTB_MAIL_DELIVERY=enabled` plus a
  DSN and an approved template (TIN-4062 machinery).
- Archive edge stack in the infra overlay (`k8s/archive/` production
  declaration) — live, serving the public read path.

**This carrier (not production until merged and deployed)**

- Fresh membership
  activation (`src/lib/server/membership/activate.ts` via
  `src/lib/server/membership/provision.ts`) enqueues all four projection jobs
  in the same transaction as the membership commit, using
  generation-bound keys `<tenant>:membership:<id>:<effect>:g1` and an exact
  v1 payload containing only tenant, membership, person, and generation ids.
- Worker startup adds missing intents for pre-carrier Active/paused members.
  A standing dead row remains visible for audited replay and cannot crash the
  worker or block another member/kind from being repaired.
- A verified-email change atomically owes a fresh ids-only list projection
  trigger keyed by the new address-row id.
- The worker defers identity, mailbox, list, archive, list-removal, and
  mailbox-disable kinds. They remain `pending` with `attempts=0`; no
  delivery-disabled branch records an external effect as done.
- The direct Mailman REST client and broad administrator-credential wiring are
  deliberately absent. The public application cannot enable list delivery by
  environment variable or DSN.

**Planned (not yet built)**

- Protected handlers for `provision.ensure_identity`,
  `provision.enable_mailbox`, `provision.add_lists`,
  `provision.ensure_archive`, `offboard.remove_lists`, and
  `offboard.disable_mailbox`. Their durable intent is present; every kind
  remains deferred until an independently reviewed interface is live.
- TIN-3813's allowlisted, idempotent, list-scoped desired-state interface with
  observed-state readback. Mailman 3.3.10 exposes one global REST identity, so
  the restricted proxy is a real build. The application never receives that
  broad credential, a cluster credential, or direct pod access.
- The audited operator replay surface for genuinely `dead` outbox rows
  (spec §3.1: reset attempts/status, audited). Closed gates do not create dead
  or done rows and therefore do not depend on that surface.
- Platform outbound SMTP transport DSN (TIN-4208) and its CA-trust
  prerequisite (TIN-4216).
- The mail-automation readiness gate proof (TIN-3813, due 2026-09-10): prove
  automated mailbox/list provisioning end to end or keep member mail
  disabled. Carrier values from ADR 0024 Amendment 1: account ceiling 64,
  alert at 48.
- Member-facing "where the boards are" disclosure page (ADR 0019 §2.3
  consequence).
- Infra `mailman-listsync` keyholders-into-discuss reconciler: declared in the
  infra overlay but **suspended** (`suspend: true`, dry-run default, Secret
  unminted). Merging its declaration changed nothing by itself; activation is
  operator-gated (ADR 0017).

**Identity invariant**

- There is no independent HyperKitty signup lifecycle. A person becomes a
  member once, and the protected account controller projects that identity to
  Keycloak, mailbox, list, and archive resources. People may choose not to use
  the provided mailbox; provisioning it is still part of activation. This row
  becomes landed authority when Meta PR #58 merges, and is a hard merge-order
  dependency for this carrier.

## Public-nav gate

The nav item ships when, and only when, the discuss archive UI is publicly
reachable to an anonymous reader. That condition is **met today**. Anonymous
probes on 2026-09-01:

- `https://lists.latoolb.us/` → 301 → `/postorius/lists/`
- `https://lists.latoolb.us/hyperkitty/` → 200
- `https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/` → 200
  (anonymous read works)
- The private keyholders archive → 403 (private `archive_policy` enforced)

The Anubis proof-of-work gate in front of the archive is anti-scrape only,
not authentication; the discuss read path (list overview, thread permalinks,
static assets) is exempted from the challenge (TIN-2559). Privacy is enforced
by Mailman per-list `archive_policy`, not by the edge.

Nav requirements (the nav item itself belongs to the `gftb-site` microsite,
not this repo — recorded here because this spec owns the gating condition):

- Deep-link to `https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/`,
  never the HyperKitty root or Postorius index — the root list index sits
  outside the read-path exemption and surfaces the private list's 403.
- Label it "Discussion archive", external-link shape, ungated. Anonymous read
  is ratified (ADR 0019 §2.2/2.3: the public archive grants nothing a
  stranger lacks) and empirically live.
- Never link the keyholders archive anywhere public (leak-scan rule
  `private-list-archive` enforces this in both repos).
- Nearby copy must carry the read-is-free / write-requires-membership
  distinction before inviting a subscription (ADR 0014 §0.5 disclosure duty).

## Non-goals

- **No self-serve list signup outside membership.** Membership account
  creation is the only sanctioned path onto `discuss@latoolb.us` (operator
  ruling; ADR 0024 §1.3/§1.5). The platform builds no public subscribe form
  and links to none.
- **No agent-sent mail.** No handler, job, or agent surface in this repo
  sends mail to the lists on a member's behalf; posting is a human act from
  the member's own mail client.
- **No second archive signup.** HyperKitty identity is a projection of the
  member identity, never an independent public registration path.
- **No read-grant projection.** Read access stays a derived property
  recomputed by HyperKitty (ADR 0019 §2.2).
- **No removal path in the keyholders reconciler.** Add-only by design
  (ADR 0017); removals are offboarding projections.

## Open divergence (flagged, not resolved here)

The live Mailman `subscription_policy` for `discuss@latoolb.us` is `confirm`
(anyone can subscribe with email confirmation, per the infra list-operations
runbook), which is wider than the ruling's members-only-writers model.
Posting is subscriber-gated today (`default_nonmember_action=hold`), so the
practical write gate holds, but self-serve subscription remains open at the
Mailman layer. Tightening `subscription_policy` so that "membership is the
only add path" is true at the engine layer, not just the platform layer, is
tracked by TIN-4268. Its mutation must ride the existing protected hosted
`list-crs`/`mail-crs` lanes; an attended laptop or pod-exec recipe is not a
substitute. Until a hosted receipt proves the live value, public copy must not
promise that subscription itself is members-only — only that posting rights
come with membership.

## Authorities

- Meta ADR `decisions/0017-keyholders-discuss-autoadd-carrier-2026-08-20.md`
  (TIN-3965 carrier): keyholders-into-discuss invariant, add-only reconciler,
  operator-gated activation, disclosure line.
- Meta PR #58 (TIN-4215), required to merge first: the unified Member v0
  identity carrier supersedes ADR 0019's separate archive-signup model so
  mailbox, list, and archive resources project one application-owned
  `person_id`.
- Meta ADR `decisions/0024-member-account-lifecycle-values-2026-08-30.md`:
  discuss-by-default for Active members, activation-as-assent, idempotent
  projection intent behind the readiness gate, recovery/purge windows,
  ceiling 64 / alert 48.
- Infra overlay repo `great-falls-tool-bus-infra`: archive edge stack
  declaration, list-sync CronJob declaration, discuss archive packet
  (host decision), list-operations runbook (live Mailman policy values).
