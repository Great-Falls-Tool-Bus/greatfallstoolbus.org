# Runsheet: deployed Member v0 proof

> **Status: execution carrier, not an execution receipt.** This document is
> intentionally the only change in its pull request. It adds no test runner,
> staging client, version probe, package dependency, or local execution path.
> Complete it only against the exact reviewed artifact deployed by the apply
> plane.

## Purpose and proof layers

This runsheet records the Member v0 path through the deployed HTTP surfaces:
application, verification, keyholder review, assent, login, contribution,
member-controlled transitions, keyholder removal, and offboarding observation.

The binding outcome is TIN-3440 plus TIN-3818 and their ratified
specification/decision carriers. Routes are the implementation under
observation, not a replacement authority.

Merged PR
[#212](https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org/pull/212)
provides deterministic code proof. Its registered
//:first_membership_rehearsal_test drove the real route factories through
apply, verify, claim, tour scheduling, approval, agreement publication, assent,
activation, merged login, cash state, a Stripe projection, and /home against
PostgreSQL 16.15. The PR merged at
588059c62105bac12e3357170bd3f2d85286d5fa from exact proof head
8e43a0218c4de8d4855d7f4ecc794862e36d5cae. That test is
manual/local/no-cache and makes no RBE or deployed-origin claim.

The contribution visibility boundary is a separate registered domain proof:
src/lib/server/contribution/visibility.test.ts locks the permitted keyholder
summary to exactly offered plus helpRequested and excludes amount, rail,
cadence, processor state, and version. It is enrolled in //:unit_tests through
//:app_srcs. A historical v3 remote proof passed at signed source
31f8afc2a6c130b2208d84e8a95483a6b060da36:
[job 99167490982](https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org/actions/runs/33277725087/job/99167490982).
That proves the closed serializer shape. It does not invent a deployed
keyholder contribution projection, prove route authorization, or prove a real
provider lifecycle.

The registered negative-authorization grounding on current main is narrow and
named rather than implied. The registered `just test-integration` lane includes
`src/lib/server/application/review.integration.test.ts`, whose exact negative
rows are `a non-keyholder is refused, mutating nothing (S5 acceptance row 4)`
and `a grant revoked mid-request — session already validated — is refused in
the SAME unit of work`; the second drives `_createClaimAction` and asserts
`403/not_keyholder`. The same role vocabulary and live-grant mechanism are
exercised against a finance-only actor by
`src/lib/server/membership/offboarding-observability.integration.test.ts` row
`a live FINANCE grant with no keyholder grant is refused, same as no grant at
all`. `src/lib/server/membership/lifecycle.integration.test.ts` drives the real
`_createRemoveAction` factory, but current main has no registered
finance-only/non-keyholder `/remove` negative row. Do not invent one or turn
that file's positive route coverage into one. These container-backed tests
name code scope only; current remote CI does not run them. The deployed
two-session POST controls below are therefore mandatory and may not be
replaced by source tests.

This document has the third job: prove one immutable deployed image and its
runtime dependencies expose the ratified behavior to real users. A PR #212
PASS never substitutes for a deployed observation. The registered closed-shape
PASS never substitutes for deployed role checks. CI's gated
live-testmode.test.ts skips without an operator key and creates only a Checkout
Session when enabled; it is not an authoritative subscription, renewal,
refund, cancellation, or webhook-delivery receipt.

## Receipt identity: PINNED, RUNNING, SERVED

Fill this section before the first member mutation. Do not record credentials,
bearer tokens, cookies, private customer identifiers, email addresses,
database identifiers, or raw provider payloads in this repository or in a
public PR.

### PINNED

PINNED requires both sides of the digest equality:

- reviewed great-falls-tool-bus-infra commit and deployment path:
- immutable digest committed in that carrier:
- live pod status.containerStatuses imageID:
- equality check between the committed digest and live imageID:
- observation time and private evidence reference:

A committed pin without the live pod imageID is not PINNED. The origin is not
claimed to report an OCI digest.

### RUNNING

RUNNING requires the deployed controller and pods to have observed the pin:

- deployment metadata.generation:
- deployment status.observedGeneration:
- desired replicas:
- updated replicas:
- ready replicas:
- available replicas:
- pod readiness observation:
- observation time and private evidence reference:

RUNNING requires generation equality and the intended replicas updated,
ready, and available. A committed manifest alone is not RUNNING.

### SERVED

SERVED is source provenance from the public health response:

- external GET /health status:
- /health response .sha:
- expected application source SHA:
- equality check between .sha and the expected source SHA:
- observation time and private evidence reference:

The health response carries source SHA, not image digest. Do not turn SERVED
into an origin-digest claim.

### Remaining run identity

- Environment and origin:
- Observation start/end in UTC:
- Operator:
- Database migration ledger head:
- Mail gate observation:
- Stripe account mode observation:
- Private evidence bundle location:
- Rollback digest confirmed before the run:

A row is PASS only when the remote deployed surface was observed and its
non-sensitive receipt is named. Use BLOCKED when a prerequisite is absent and
FAIL when deployed behavior contradicts the contract. Never convert either
state to PASS from source inspection.

## Non-negotiable execution rules

1. Use rendered pages and their forms. The current /review,
   /agreement/publish, /assent, /membership, and /remove pages provide the
   identifiers and versions their actions require.
2. Reload immediately before each state-changing action. Submit
   expectedVersion or agreementVersionId exactly as rendered. Never guess,
   increment, scrape from another environment, or brute-force a version. A
   version_conflict means reload and re-evaluate the standing state.
3. Use dedicated synthetic adults and operator-controlled external addresses.
   Never reuse a real prospective member's record for QA.
4. Keep mail delivery disabled. GFTB_MAIL_DELIVERY activates transport only
   when it is exactly enabled, and the shipped templates remain unapproved.
   Do not enable delivery to make this rehearsal convenient and do not ask an
   agent to send mail.
5. Never paste token-bearing links into receipts. Verification and activation
   may continue only through an operator-approved private token-custody
   mechanism. If none exists in the deployed apply plane, stop at that
   boundary and mark dependent rows BLOCKED.
6. Stripe stays in test mode. Use real hosted Checkout and Stripe's own events
   for the exact synthetic member. Never POST committed fixtures, fabricated
   events, or canned customer/subscription IDs to /api/stripe/webhook.
7. Provider lifecycle evidence is mandatory and remote. Each required row
   names a real test-mode provider object, event, delivery attempt, and
   deployed projection in the private bundle. A source test, fixture replay,
   local process, or CI skip cannot satisfy it.
8. Do not infer application or membership status from payment. Confirm those
   states on their own member/keyholder surfaces.
9. Execute against the remote deployed environment. Do not run the platform,
   database, browser suite, migration, container, Nix, pnpm, Bazel, or Tofu
   workload on neo.

## Preconditions and identities

- PINNED, RUNNING, and SERVED are each proved as defined above.
- The deployed schema ledger is current for that image.
- Intake is explicitly open and the ratified 18+ attestation is present.
- One keyholder-only account and one finance-only account are available.
  Keyholder and finance are orthogonal grants.
- A ratified agreement version is already published. Never publish rehearsal
  copy. If none exists, the operator publishes the ratified body through
  /agreement/publish before any applicant assents.
- Mail is observed disabled and the private token-custody prerequisite is
  available or explicitly blocked.
- The Stripe dashboard visibly shows test mode and the live gate remains
  closed.

Reserve eleven separate synthetic identities so terminal and provider states
cannot contaminate one another:

- happy-leave: application through pause/resume and voluntary leave;
- zero: the $0 rail;
- cash: the cash rail;
- check: the check rail;
- stripe-cancel: real subscription creation and provider-side cancellation;
- stripe-refund: real full-refund lifecycle;
- stripe-failure: real failed-renewal/past-due lifecycle;
- withdraw: applicant withdrawal;
- decline: keyholder decline;
- stale-withdraw: approval followed by stale withdrawal rejection;
- remove: keyholder-forced removal.

Keep actual addresses, bearer material, provider identifiers, and database
identifiers only in the private evidence bundle.

## Deployed proof

For every numbered row, record PASS, FAIL, or BLOCKED, observation time, and a
non-sensitive evidence reference.

### 1. Artifact and role-boundary preflight

- Prove PINNED, RUNNING, and SERVED independently.
- As anonymous, confirm /contributions and /offboarding-obligations refuse
  with 401.
- With the keyholder-only session, confirm both finance routes refuse with
  403.
- Keep two isolated browser contexts on this same deployed origin: K is the
  keyholder-only session and F is the finance-only session. Never transfer
  cookies, passwords, bearer links, or a whole rendered page between them.
- The finance-only session never renders keyholder forms. After an eligible
  synthetic record reaches its standing state later in this run, reload it in K immediately
  before the probe and privately capture only the rendered action URL,
  identifier, expectedVersion, and permitted non-secret form fields. In F,
  replay that exact same-origin form POST under F's own session. For /remove,
  F supplies F's own password and a permitted synthetic reason. Never copy
  K's cookie or password, invent a version, or reuse a form from another
  environment.
- Apply that two-session capture/replay sequence to claim, schedule, approve,
  decline, and remove at the points named below. Each F POST must return
  403/not_keyholder. Reload in K and confirm the application or membership is
  unchanged before K performs the intended positive action. Keep this row
  BLOCKED until all five negative receipts exist; if the private two-context
  handoff is unavailable, mark it BLOCKED.
- Observe /review, /remove, and /offboarding as keyholder-only. Confirm they
  expose no amount, rail, cadence, processor/customer identifier, cash note,
  or billing failure detail.
- Do not claim a keyholder contribution projection exists. Cite the registered
  visibility.test.ts closed-shape proof above for the only permitted domain
  summary, and record only what the deployed keyholder routes actually show.
- Record mail disabled, Stripe test mode, and live Stripe gate closed.

Receipt:

### 2. Application submission (happy-leave)

- Open /apply and confirm the ratified age attestation is rendered.
- Submit once with the required adult attestation.
- Confirm the public non-enumerating receipt. Do not expect mail delivery.
- Confirm the outbox/mail journal records disabled delivery without network
  transmission. Do not include the queued payload in evidence.
- Obtain the verification link only through approved private token custody. If
  unavailable, mark every dependent row, including steps 3-19, BLOCKED rather
  than enabling mail or querying production ad hoc.

Receipt:

### 3. Email verification (happy-leave)

- Open the private verification link at /apply/verify?token=....
- Confirm GET renders confirmation and does not mutate.
- Submit the rendered form once.
- Confirm /review shows email_verified.
- Do not replay the bearer token merely to manufacture an error receipt.

Receipt:

### 4. Applicant withdrawal (withdraw)

- Submit a separate application.
- Use its privately handled /apply/withdraw?token=... link.
- Confirm GET is non-mutating, then submit the rendered form.
- Confirm withdrawn is terminal and the application cannot be claimed.

Receipt:

### 5. Claim, tour, and approval (happy-leave)

- Sign in at /login with the keyholder-only account.
- Open /review and reload. Run the step-1 F-context claim probe from that
  freshly rendered form; after its 403, reload in K, confirm unchanged, and
  claim happy-leave.
- Open /review/[id] and reload. Run the same captured-form probe for schedule;
  after its 403, reload in K, confirm unchanged, and schedule the tour using
  the newly rendered version.
- After the real tour checkpoint, reload /review/[id] and run the captured-form
  approve probe. After its 403, reload in K, confirm unchanged, and approve.
  Do not attach contribution information to the decision.
- Confirm approved plus one pending_assent membership.
- Obtain the activation link only through approved private token custody.

Receipt:

### 6. Decline with a recorded reason (decline)

- Submit, verify, and claim a separate application.
- Reload /review/[id]. Run the step-1 F-context decline probe with a permitted
  synthetic reason; after its 403, reload in K and confirm unchanged.
- As K, confirm decline without its required reason is refused.
- Enter a permitted reason class in the freshly rendered page and decline.
- Confirm declined is terminal and no membership/contribution state exists.

Receipt:

### 7. Stale withdrawal after approval (stale-withdraw)

- Submit and verify stale-withdraw, retaining its private withdrawal link.
- Claim, schedule, and approve through freshly rendered forms.
- Only after approval commits, submit the standing withdrawal form.
- Confirm the stale withdrawal is refused with not_withdrawable and exactly
  one terminal decision remains. This is an ordered stale-terminal rejection,
  not a concurrency receipt. Do not reuse this identity for activation.

Receipt:

### 8. Assent and activation (happy-leave)

- Open the private /assent?token=... activation link.
- Confirm GET displays the ratified agreement and carries its current version
  in the rendered form.
- Set the synthetic password and submit. There is no assent checkbox: decision
  0024 §2 makes completing activation the agreement event itself.
- Confirm activation, a live session, active membership, and /home displaying
  the exact agreement version recorded at activation.
- Never copy token, password, or cookie into evidence.

Receipt:

### 9. Merged login (happy-leave)

- Sign out, then sign in at /login using verified email and password.
- Confirm redirect to /home and a fresh session.
- Confirm /home shows active membership and the exact agreement version.
- Confirm wrong-password and unknown-address attempts have the same public
  bad-credentials shape without storing their submitted identifiers.

Receipt:

### 10. Pause and resume (happy-leave)

- Open /membership, reload, and pause through the rendered form.
- Confirm paused, borrowing unavailable, and login still valid.
- Reload /membership and resume using the newly rendered version.
- Confirm active. No contribution event may cause either transition.

Receipt:

### 11. $0 choice (zero)

- Activate zero, open /contribution, and choose $0.
- Confirm membership remains active.
- As finance-only, observe state zero at /contributions.
- Confirm no Stripe Checkout, customer, invoice, or subscription was created.

Receipt:

### 12. Cash and check choices (cash and check)

- Activate both identities.
- Choose cash for cash and check for check at /contribution.
- At /contributions, observe both in state cash_pending with distinct rail
  values cash and check.
- Do not claim cash_recorded or check_recorded unless an authorized
  finance-write surface records the receipt and append-only correction is
  observable.

At authoring, /contributions is intentionally read-only and no finance-write
route exposes recordCashCheckReceipt. That is a real TIN-3818 deployment
blocker, not a documentation gap. The domain/integration proof does not make
cash/check live over HTTP.

Receipt:

### 13. Real provider activation (stripe-cancel, stripe-refund, stripe-failure)

For each identity:

- Activate membership, choose an offered card amount at /contribution, and
  follow the real hosted test-mode Checkout.
- Complete Checkout using Stripe's documented test method.
- Capture the exact test-mode Checkout Session and Subscription references in
  the private bundle.
- Capture the actual checkout.session.completed,
  customer.subscription.created, and invoice.paid event references plus their
  webhook delivery-attempt references and 2xx results for this deployed
  endpoint.
- As finance-only, confirm the same identity reaches stripe_active with the
  expected rail, cadence, and amount.
- Ask Stripe to resend one of those exact events. Capture the second delivery
  attempt and confirm the finance projection remains converged.

If any provider object, event, delivery attempt, deployed endpoint result, or
finance projection is missing, this row is BLOCKED. Fixture events and the
gated Checkout-only source test do not satisfy it.

Receipt:

### 14. Real failed-renewal path (stripe-failure)

- Use Stripe's supported test-mode mechanism on stripe-failure to produce a
  real invoice.payment_failed for the standing subscription.
- Capture the provider event and successful webhook delivery attempt.
- As finance-only, observe stripe_past_due.
- Confirm membership remains active and borrowing eligibility is unchanged.
- Resend that exact event and confirm convergence.

If the provider-side failure cannot be produced and observed end to end, mark
BLOCKED rather than substituting a fixture.

Receipt:

### 15. Real full refund (stripe-refund)

- Issue a full test-mode refund against stripe-refund's real paid object.
- Capture the real charge.refunded event and successful webhook delivery.
- As finance-only, observe refunded.
- Confirm membership remains active.
- Resend the exact refund event and confirm refunded remains converged.

If the real provider receipt or deployed projection is absent, mark BLOCKED.

Receipt:

### 16. Provider-side subscription cancellation (stripe-cancel)

- Cancel stripe-cancel's exact test subscription from the provider side.
- Capture the provider cancellation receipt, the real
  customer.subscription.deleted event, and its successful webhook delivery.
- As finance-only, observe cancelled.
- Confirm membership remains active until a separate membership transition.
- Resend the exact deletion event and confirm cancelled remains converged.

This provider-side receipt is mandatory. The current
offboard.cancel_billing handler updates only the internal contribution
agreement and explicitly does not call Stripe. An internal outbox job marked
done is therefore not evidence that future provider billing stopped. Without
the provider-side cancellation receipt, this row and any offboarding claim
that depends on it are BLOCKED.

Receipt:

### 17. Voluntary leave and offboarding (happy-leave)

Run after pause/resume and any intended contribution checks; leave is terminal.

- Open /membership, reload, and submit Leave with the rendered version.
- Confirm left.
- Confirm standing sessions are revoked and correct-password /login is refused
  as membership_inactive.
- As keyholder-only, observe /offboarding showing the three standing job
  kinds: offboard.cancel_billing, offboard.remove_lists, and
  offboard.disable_mailbox.
- Confirm no finance detail appears on that page.
- If cancel_billing dead-letters, confirm its failure detail is available only
  to finance at /offboarding-obligations.
- Do not interpret cancel_billing done as provider cancellation; apply the
  mandatory provider-side rule from step 16 to any member with a subscription.

Receipt:

### 18. Forced removal with fresh reauthentication (remove)

Walk remove through verification, approval, assent, and activation first.

- Sign in as keyholder-only and open /remove.
- Reload immediately; the rendered form supplies membership ID and version.
- Run the step-1 F-context remove probe from that exact capture, using F's own
  password and a permitted synthetic reason. Confirm 403/not_keyholder, then
  reload in K and confirm the membership, both sessions, and version are
  unchanged.
- As K, confirm omission of the recorded reason is refused.
- Confirm missing or wrong keyholder password is refused without transition.
- Submit with a permitted reason and correct password.
- Confirm keyholder session rotation, removed, and open-obligation count.
- Confirm the removed member cannot mint a new /login session.
- Confirm /offboarding shows the same three job kinds without finance detail.

Receipt:

### 19. Offboarding convergence and role separation

- Observe worker processing through approved remote logs/metrics, never a
  local worker.
- Confirm retries converge on standing idempotency keys and do not create a
  second external effect.
- Confirm membership remains left or removed across retry/dead-letter.
- Confirm keyholder-only sees job status but not billing failure detail.
- Confirm finance-only sees an open cancellation obligation when one exists
  through read-only /offboarding-obligations.
- Confirm the five step-1 finance-only POST receipts all show
  403/not_keyholder and no application or membership mutation.
- Confirm neither observation page exposes a mutation action.
- For any Stripe subscription, pair the internal obligation state with the
  mandatory provider-side cancellation receipt. Otherwise mark BLOCKED.

Receipt:

## Completion conditions

The deployed proof is complete only when every applicable row has a
non-sensitive receipt and all of these are true:

- TIN-3440: application, verification, withdrawal, stale-terminal rejection,
  claim, tour, approve/decline, assent/activation, login, pause/resume,
  voluntary leave,
  forced removal, immediate access revocation, and retryable offboarding are
  observed.
- TIN-3818: choices remain post-approval and membership-independent; $0
  creates no provider object; cash/check have an authorized
  recording/correction path; real provider activation, failed renewal, full
  refund, cancellation, redelivery, and deployed projection are observed;
  finance/keyholder boundaries hold; live Stripe remains closed absent all
  seven gates.
- PINNED: committed infra digest equals the live pod imageID.
- RUNNING: observed generation and intended replica readiness agree.
- SERVED: external /health.sha equals the GF-qualified application source SHA.
- Mail remains disabled unless separately authorized after template approval.

Until a finance-write surface exists, cash/check remains BLOCKED. Until
approved private token custody or approved mail activation exists, the
deployed application-to-activation walk remains BLOCKED. Until provider-side
test cancellation is receipted, future-billing cancellation remains BLOCKED
because the internal cancel-billing handler does not call Stripe. Preserve
those facts rather than substituting PR #212, a fixture, an internal agreement
state, or a passing CI job.
