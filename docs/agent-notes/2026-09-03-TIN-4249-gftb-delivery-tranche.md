# TIN-4249 GFTB delivery tranche — 2026-09-03

Status: active execution plan, operator-ratified 2026-09-03.

## Objective

Within ten execution hours, land the protected GloriousFlywheel v4 path,
establish automatic GFTB main-to-production convergence, close the platform
image visibility breach, publish the approved microsite work, and merge the
unified Member v0 identity/projection slice. By end of day, prove the protected
Keycloak-backed member lifecycle or leave only an exact reviewed production
plan blocked on a named external authority.

Execution is remote-only. Neo coordinates reviewed git and API operations; it
does not run application, Bazel, container, database, OpenTofu, Kubernetes, or
browser workloads.

## Binding decisions recovered from the record

- `person_id` is the immutable application identity. Email, mailbox address,
  external providers, and authentication adapters are replaceable claims or
  projections and never primary keys.
- Activation is assent. There is no second assent checkbox or ceremony.
- Every Active member receives an `@latoolb.us` mailbox and `discuss@`
  subscription. A closed automation gate delays an entitlement; it does not
  make the entitlement optional or turn an unperformed effect into success.
- An inactive application closes after 60 days. Exit/removal has a 30-day
  intact recovery window and a 90-day personal-account, mailbox, list, and
  archive purge point.
- HyperKitty is part of the same member identity. The older separate-signup
  ruling in decisions 0019/0024 and TIN-4215 is superseded.
- The delegated-auth implementation is exact-digest Keycloak 26.7.3 at
  `https://id.greatfallstoolbus.org/realms/great-falls-tool-bus`.
- The canonical tenant is one tenant-aware deployment with slug
  `great-falls-tool-bus`, display name `Great Falls Tool Bus`, one UUIDv4
  minted exactly once at bootstrap, and one initial operator principal.

## Ownership

- `meta`: product decisions, executable slices, diagrams, and milestone truth.
- `greatfallstoolbus.org`: member/application state, lifecycle, outbox intent,
  `person_id`, and authorization.
- `gftb-site`: public static copy, logs, and images only.
- `tinyland-auth`/BCR: reusable relying-party and subject-binding primitives;
  never a locally invented identity provider.
- `great-falls-tool-bus-infra`: Keycloak/Mailman/database configuration,
  secret references, saved plans, apply, and rollback.
- `GloriousFlywheel`, `owner-overlay-controller`, and `ci-templates`: action
  execution, signed result joining, publication, and convergence mechanics.
- `blahaj`: admission, placement, networking, and observed cluster state only.
- `account-controller`: mailbox transport projection only; never person or
  membership authority.

## 0–5 hours — v4 product fabric

1. Repair GF PR #1743 by co-moving the existing 90-second timeout assertion to
   the implemented 150-second publisher window. Land through `merge-next` on
   remote validation and exact-head LAND review.
2. Repair GF PR #1739 so repository identity derives only from verified
   `OwnerInstallation/v1` and `TenantOverlay/v1`, every enrollment/provider
   reference is bound, and documentation matches executable truth. Land next.
3. Publish and deploy the exact-digest runner containing `gf-action-client`.
4. Mint and custody the read-only, GloriousFlywheel-only source-reader GitHub
   App through `lab` SOPS+age; update and land owner-overlay-controller #19.
5. Land Blahaj #1472, converge placement one voter at a time, then rebase and
   land infra #171 against observed labels.
6. In parallel, amend meta decisions 0019/0024, the Member v0 spec/slices, and
   diagram sources to carry the recovered identity doctrine above. Rewrite
   TIN-4215 rather than creating a competing decision.

## 5–10 hours — continuous main equals served production

1. Land site.scaffold #163, then rebase and land gftb-site #54 and platform
   #229 on the same immutable v4 schema-3 contract.
2. Prove a first miss leases exactly one WorkerLeaf and an identical repeat is
   an AC hit with no WorkerLeaf lease; retain LGTM attribution.
3. Replace stale infra #104 with permanent GF-I09 convergence. A protected
   merge-group candidate holds the verified `ActionOutputSet/v1`; main creates
   an `ApplicationRelease`; the owner controller saves and applies the one-use
   OpenTofu plan for the same digest; an independent observer records
   `PINNED`, `RUNNING`, and `SERVED`.
4. Prove update, revert, and forward recovery with merge-to-served at or below
   600 seconds. There is no bridge, attended apply, dispatch, local fallback,
   or pre-ship LOOK.
5. After authenticated current/rollback pulls work, make the platform GHCR
   package private. Leave only `ghcr.io/great-falls-tool-bus/gftb-site`
   public; source-repository visibility is unchanged.
6. With continuous CD standing, land gftb-site #63, rebase/land #66, close
   duplicate #60, and publish the operator-approved SVX carrier #42 with the
   correct front matter. Execute the reviewed TIN-4203/TIN-2421 public-apex
   edge plan while keeping dev/preview protected.

## End of day — unified Member v0 carrier

- Rework platform #239 and fold platform #240 plus the valid security part of
  infra #173 into one lifecycle implementation.
- Activation atomically enqueues IDs-only `provision.ensure_identity`,
  `provision.enable_mailbox`, `provision.add_lists`, and
  `provision.ensure_archive` jobs. Payloads contain schema version,
  `tenantId`, `membershipId`, `personId`, and generation only.
- The dispatcher claims only gate-enabled kinds. Disabled effects remain
  `pending` with zero attempts; opening a gate reconciles every Active member.
- Add an `auth_identity` binding keyed by tenant, application person, issuer,
  audience/client, OIDC subject, and broker user. Email never participates in
  identity uniqueness.
- Disable Keycloak self-registration and automatic email linking. Future
  GitHub, Google, and SAML identities link only from an already-authenticated
  broker account. Keycloak roles never grant membership.
- Configure distinct SvelteKit and Mailman Web Authorization Code + PKCE
  clients with exact redirect/audience checks, nonce/state protection, JWKS
  overlap, short access-token lifetime, and back-channel logout.
- HyperKitty has no separate signup or password authority. Its local Django
  row may be materialized on first trusted OIDC login, but entitlement exists
  at activation and only a provisioned Active member can authenticate.
- Refresh infra #118 then #121: CNPG/backup first, then image-carried migrator,
  web, and worker. Never apply an ad hoc local migration.

## Acceptance and cadence

- Remote negative tests cover forged issuer/audience, replayed code, bad
  nonce/PKCE, email-link takeover, provider collision, disabled member, stale
  JWT, and signing-key rollover.
- Activation rollback leaves no person, membership, identity binding, or
  projection fragments. Gate opening is idempotent and creates no duplicates.
- Offboarding denies application access first, revokes broker sessions,
  removes lists, disables mailbox/archive, preserves the binding for 30 days,
  and purges at day 90.
- Anonymous platform-image pulls fail; anonymous gftb-site pulls succeed;
  current and rollback digests pull through the governed projection.
- Push-to-verdict is at most 90 minutes, parked-lane rescue at most 15 minutes,
  merge-to-served p95 at most 600 seconds, and each landing receives a durable
  receipt within 15 minutes.
- One lead holds merge authority. Merges are SHA-guarded and exact-head
  LAND-reviewed; no signing, consent, ruleset, or production bypass is used.
- Under GF R251, every new validation assertion replaces at least as much
  redundant validation. No loose test or one-off script is admitted.

## Carrier disposition

- Repair/land: GF #1743/#1739, OOC #19, Blahaj #1472, infra #171/#118/#121,
  scaffold #163, site #54/#63/#66/#42, platform #229 and rewritten #239.
- Fold then close: platform #240/#218/#232/#230, infra #173, site #60.
- Replace/close obsolete: infra #104/#133 and meta #57.
- Hold beyond launch: platform #238, generic dependency/action churn, and meta
  #44 until its existing dissent window.
- Never merge: platform #210.

If a protected App, IAM grant, capacity check, or backup proof is unavailable,
stop only that apply at a reviewed saved plan and name the missing authority.
Do not invent a manual, local, public-image, or direct-cluster fallback.
