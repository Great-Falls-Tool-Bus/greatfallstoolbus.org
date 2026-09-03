# keyholders@ → discuss@ → svx: the draft-staging pipeline

Lane B mechanism (operator-ratified 2026-08-20). This document is the READ
path for the pipeline: how a keyholders@ post becomes a staged discuss@
draft, and where the on-cluster HyperKitty read lives. It does not implement
mail sending — see **Hard rules** below.

## What this pipeline is (and is not)

- **Is:** a way to turn a note the operator already sent to the private
  `keyholders@latoolb.us` list into a git-tracked, `published: false` draft
  under `src/content/discuss-drafts/`, staged for the operator to post to the
  public `discuss@latoolb.us` list by hand.
- **Is not:** a mail sender, a scheduler, an auto-poster, or a live read of
  the HyperKitty archive at build or CI time. Nothing in this pipeline
  touches the cluster. The four drafts staged alongside this doc were built
  from the operator's own already-redacted proposal packet, not from a fresh
  HyperKitty pull.
- **Does not render on the site.** `src/content/discuss-drafts/**` is not
  wired into any route or glob import — compare `$lib/data/cells.ts`, which
  globs `content/tools/**` only. A draft file here has zero effect on the
  deployed build.

## The flow, end to end

1. **Operator posts to keyholders@** (private list) — this already happened;
   it is the source material.
2. **Operator drafts a redaction proposal** — a human editorial pass that
   decides what survives for a public repost, against
   `naming-consent.md` and the spec's public-log rejection classes (no
   secrets, addresses, internal hostnames, private URLs, private-person
   metadata). This step happens entirely outside this repo, in the
   operator's own working notes. **This pipeline does not redact anything.**
3. **`scripts/discuss-to-svx.mjs` stages the draft.** Takes one JSON export
   of an already-redacted message (see the script's header for the input
   contract) and:
   - re-checks naming-consent (`src/lib/naming-consent.ts`) on EVERY
     free-text field that can reach output in any form — `slug`, `subject`,
     `sourceMessageId`, and `body` — rejecting a private-only identity
     outright and rejecting the bus host's unredacted first name (only the
     initial "J." is a public-consent form); see **Naming-consent gate
     design** below for how this is enforced without the module itself
     containing the protected names,
   - re-checks for any bare email address or NANP-shaped phone number in
     subject, sourceMessageId, or body (the two list addresses themselves
     are the only allowed address exceptions — they are list identifiers,
     not personal addresses),
   - validates the assembled frontmatter against `DiscussDraftFrontmatter`
     (`src/lib/data/discuss-draft-schema.ts`),
   - writes `src/content/discuss-drafts/<slug>.svx` with `published: false`,
     a provenance HTML comment (source list + opaque message id, never an
     address), and the pending-notice HTML comment below.
   - Never overwrites an existing draft without `--force`.
   - **Requires `~/.gftb/naming-consent.key` to run at all** (see below) —
     this script only ever runs as a manual local operator action before
     staging new content, so it fails hard, not loud-and-skip, if it can't
     verify what it's about to write.
4. **`scripts/validate-discuss-drafts.mts`** (`just discuss-drafts-validate`,
   wired into `just check`) independently re-runs the same naming-consent,
   address, and phone-number gates against every file's raw text AND its
   filename (the slug is never written into a draft's own text — only used
   as the filename — so a violation hiding only in a renamed file needs its
   own check), plus the schema and a pending-notice-comment check — so a
   hand-edited or renamed draft that bypassed the generator still fails CI,
   not just gitleaks. Unlike the generator, this one *can* run without the
   key — see **CI scope** below for why, and what it still checks in that
   case.
5. **`.gitleaks.toml`** carries two custom rules scoped to
   `src/content/discuss-drafts/**` (`gftb-discuss-drafts-bare-email`,
   `gftb-discuss-drafts-phone-shape`) as a third, independent backstop
   through `just secrets-scan-dir` / `just secrets-scan`. These are
   deliberately generic-format rules (email/phone SHAPE, not identity) —
   see below for why identity matching cannot live in gitleaks here.
6. **Operator reviews the staged draft** and, when ready, sends the body to
   `discuss@latoolb.us` **themselves**, from their own mail client. No part
   of steps 1–5 sends mail.
7. **Reconciliation (`just discuss-reconcile`,
   `scripts/discuss-reconcile.mts`).** Once the post lands in the public
   HyperKitty archive, the operator copies the thread permalink from the
   archive page they are already looking at and runs, on their keyed
   machine:

   ```sh
   just discuss-reconcile -- --slug <slug> \
     --archive-url 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/<thread-id>/'
   ```

   The tool flips `published: true`, injects the `archiveUrl`, and removes
   the pending-notice comment — a minimal textual edit (never a YAML
   re-serialization), so the reconcile diff reviews as exactly three hunks.
   The schema enforces that `archiveUrl` is required once `published` is
   `true` and must sit under its exported `PUBLIC_THREAD_URL_PREFIX`, so a
   draft can never claim to be live without pointing at a real destination.
   Before writing anything, the tool re-runs the full draft validation
   in-process against the reconciled text — naming-consent identity gate,
   bare-email/phone gates, mdsvex compile, schema decode — and fails
   closed, writing nothing, on any violation.

   The archive URL is verified **textually**: https, the exact public
   discuss@ thread deep-link prefix, one alphanumeric thread id, no query
   string, fragment, port, or userinfo — the same anonymous-200 read-path
   family the lifecycle spec's public-nav gate probed
   (`docs/spec/discuss-board-lifecycle-2026-09-01.md`). The tool
   deliberately performs **no live probe**: the operator just loaded that
   page to copy the link, and nothing in this pipeline touches the network.

   Like generation, reconciliation **requires
   `~/.gftb/naming-consent.key`** — it changes staged content, so the same
   "CI scope" rule below applies as when staging a new draft: validate and
   commit from a keyed machine; a keyless CI run fails closed on the
   changed draft. Until reconciliation happens, the pending-notice comment
   stands:

   ```html
   <!-- pending discuss@ posting by operator; svx to be reconciled to the posted archive URL -->
   ```

## Naming-consent gate design (why it's a keyed hash, not a name)

An earlier version of this pipeline enforced naming consent with a literal
denylist: the protected names appeared, in plaintext, inside
`naming-consent.ts`, its test file, and `.gitleaks.toml` rule descriptions —
all tracked in this **public** repo. That is itself a disclosure (worse: the
rule descriptions labeled *which* name was which, republishing the exact
association they existed to protect) and was blocked before merge. The
rebuilt design follows one rule everywhere: **no protected string,
initial-mapping, association, or roster fact may appear in any tracked
file — ever. Enforcement must work without containing what it protects.**

The first hash-gate attempt at that (per-token **salted SHA-256**, salt
committed next to the digest) was *also* insufficient and was caught in
review before merge: salt defeats a precomputed rainbow table, not a fresh
guess, and both protected tokens were recovered in single-digit
milliseconds from a stock OS dictionary (`/usr/share/dict/words`) with zero
prior knowledge — dropping the committed per-token length didn't help
either (measured ~16 ms either way). **That is a recovery oracle, not a
confirmation oracle** — no candidate, no suspicion, no prior knowledge of
the name required. An earlier draft of this section (and of the generator
script's header) described the residual risk as "someone who already
suspects a candidate can confirm it," which understated the actual exposure
by roughly an order of magnitude and would have led an operator to
materially misjudge the risk. This design and its wording were corrected
together, deliberately, and are not to be reintroduced.

- **The plaintext list lives outside every repo.** One protected token per
  line in `~/.gftb/naming-consent.plain` — never created inside a git
  working tree, never committed, on any branch.
- **The key lives outside every repo too.** `~/.gftb/naming-consent.key` —
  32 random bytes, hex-encoded, mode `0600`. Generated automatically by
  `just naming-consent-hashes` on first run if it does not already exist.
  **Never regenerate an existing key casually** — doing so silently
  invalidates every previously committed digest; nothing will match the new
  key's output. Back it up.
- **`just naming-consent-hashes`** (`scripts/generate-naming-consent-hashes.mjs`,
  an `[OPERATOR]`, local-only step) normalizes each token (see below) and
  computes `HMAC-SHA256(key, normalizedToken)`, writing the hex digests —
  sorted, deduplicated, **no plaintext, no per-token length, no salt** — to
  the COMMITTED `src/lib/naming-consent.hashes.json`.
- **Without the key, the committed file is cryptographically inert.** There
  is nothing in the repo, in its history, or in the file itself that lets
  anyone — including someone holding the full repo and its complete git
  history — compute a candidate's digest and check it. This is the actual
  fix; the salted-SHA-256 design's fix was cosmetic by comparison.
- **`src/lib/naming-consent.ts`** normalizes the text it's checking the same
  way, then, because the committed file no longer states a per-token
  length, sweeps a fixed window range (`MIN_TOKEN_LENGTH`..`MAX_TOKEN_LENGTH`,
  currently 4–16 characters) across the normalized stream at every position,
  HMACing every candidate substring with the local key and comparing
  digests. It never needs the plaintext of a protected token, or the key
  used to generate the committed file's contents from someone else's
  machine, to detect one — only its own local key.
- **HMAC is deterministic**, unlike the old per-run-random-salt design —
  regenerating from an unchanged plaintext file and key reproduces the
  committed file byte-for-byte. That's what makes the drift gate below
  possible at all.
- **Why normalize by stripping separators entirely, not just collapsing
  them:** this is what lets the scan see through a name split across a mail
  line-wrap (`"Al-\nex"` / `"Al\nex"`), a name hidden in a slug or
  filename (`ask-alexexample-about-key`), or ordinary whitespace/punctuation
  noise — all collapse to the same stream a deliberate no-separators
  evasion attempt would produce. It also means matching is substring-based,
  not word-boundary-based: a protected token flags even inside a longer
  word. That's intentional — over-flagging (a false positive a human has to
  clear) is the correct failure mode for a gate that must fail closed;
  under-flagging is the actual harm this rebuild exists to prevent.
- **Diacritics are folded, not just compatibility forms.** Normalization is
  NFKC (folds fullwidth/compatibility variants) → NFD (decomposes an
  accented letter into base letter + combining mark) → strip `\p{M}`
  (drops the combining marks) → lowercase → strip non-letter/digit. This
  isn't only an evasion closure: a legitimately-accented spelling, or one a
  mail client autocorrected in, would otherwise silently miss the gate.
  Both sides (generation and matching) go through the same function, so
  they always agree.
- **A small, explicit homoglyph fold is applied too** — Cyrillic
  а/е/о/р/с/х/у/і/ј/ѕ/к/м and Greek ο/ρ are folded to their Latin lookalike
  before the alnum strip. **This is not a full UTS #39 confusable-skeleton
  implementation** — it is the cheap subset that closes the forms actually
  tested against this gate. Other scripts, and rarer confusable characters
  within Cyrillic/Greek/etc., are a real, undefended residual. Treat this as
  a partial mitigation, not a closed finding.
- **The loader fails closed.** A missing, unparseable, empty, or
  malformed-entry committed hash list is a hard error everywhere it's
  loaded (`validateHashList` in `naming-consent.ts`) — never a silent
  "nothing to protect against." An earlier version of this loader accepted
  `[]` and let the gate silently pass everything while `just check` stayed
  green; that state is now unreachable.
- **The drift gate** (`just naming-consent-hashes-verify`, wired into
  `just check`) recomputes the expected hash list from
  `~/.gftb/naming-consent.plain` + the local key and diffs it against the
  committed file, so an operator who edits the plaintext file and forgets
  to regenerate + commit gets caught, instead of the committed list quietly
  going stale. It **skips loudly (prints a warning, exits 0) whenever
  either operator-local file is absent** — which is the permanent, expected
  state in CI.

### CI scope — a local pre-publication control that fails closed on what it can't run

A keyed MAC cannot be verified without the key, and the key deliberately
never enters any git tree — which means CI (and any checkout that isn't the
operator's own machine) **cannot run the identity-matching half of this
gate at all**, structurally, by design. Concretely:

- `just discuss-to-svx` (generation) **hard-fails** if the key is missing —
  it never runs unattended or in CI anyway, so failing hard is correct: an
  operator should never stage new content this script can't verify.
- `just discuss-drafts-validate` (re-validation, part of `just check`) does
  **not** simply skip the identity check whenever the key is missing — an
  earlier version of this design did exactly that, and review (round 3 on
  PR #190) traced a real hole in it: a hand-written draft containing a
  protected identity, added from a machine without the key, validated `OK`
  and CI read green **as if the consent gate had run, when it never
  touched that content at all.** A green check must mean the gate actually
  ran, not "the gate was unavailable so nothing failed."
- The actual rule, implemented in `src/lib/discuss-drafts-ci-scope.ts`
  (`decideIdentityGateScope`) and wired into
  `scripts/validate-discuss-drafts.mts`:
  - key present → run the full identity gate, as always.
  - key absent, and `src/content/discuss-drafts/**` is **unchanged**
    relative to the base ref (i.e. this run isn't introducing or modifying
    staged content) → skip the identity check with one loud warning; the
    schema, pending-comment, and generic email/phone checks still run and
    still enforce. Safe, because unchanged content was already verified by
    a keyed run when it was added or last changed.
  - key absent, and `src/content/discuss-drafts/**` **did** change → **fail
    closed**, with a message pointing at running the check on a keyed
    machine (the operator's) or provisioning the key to CI. Also fails
    closed if the diff itself couldn't be determined at all (no resolvable
    base ref) — "couldn't check" and "checked, nothing changed" are not the
    same claim, and only the second one is safe to treat as a skip.
  - This is what makes "every file that ever entered
    `src/content/discuss-drafts/**` was verified by a keyed run at some
    point" an **inductive invariant** rather than an assumption: the only
    way a new or changed draft can pass CI at all is a keyed run — locally,
    or a future CI-secret-provisioned run — actually checking it. A PR
    that doesn't touch this directory is unaffected and stays green.
  - Provisioning the key as a CI secret to the runners remains the
    alternative if the operator wants CI itself to be able to verify
    changed drafts without a local step; until that decision is made, a
    changed draft simply requires a keyed local run before it can land.
    The generic gitleaks rules and the schema/pending-comment checks remain
    real, CI-enforced backstops in every case, changed or not.

### Enrollment guidance — what can and can't go in the plaintext file

The normalize+sweep mechanism is generic over token content, but **not over
token length** — very short tokens over-flag so badly they are not usable.
Measured against every file tracked in this repo (384 files) by enrolling a
synthetic token of each length and running the real gate:

| enrolled token length | tracked files that would flag |
| --- | --- |
| 1 (a bare initial) | 375 / 384 |
| 2 | 253 / 384 |
| 3 | 50 / 384 |
| 4 (a typical diminutive) | 1 / 384 |
| 5–6 | 0 / 384 |

**What to enroll in `~/.gftb/naming-consent.plain`:** the full protected
name(s), nicknames, and suffixed/surname-shaped forms — anything that
normalizes to `MIN_TOKEN_LENGTH` (4) characters or more. `just
naming-consent-hashes` refuses to enroll anything shorter and tells you why
rather than silently accepting a token that can't work.

**What NOT to enroll, because the mechanism cannot enforce it:** bare
initials (e.g. `<consented-initial>`, `<private-individual>`) and other
1–3 character forms. A 1-character
enrolled token flags 98% of this repo's tracked files — it would either be
so noisy the gate gets disabled in practice, or it silently never gets
enrolled at all, both of which are worse than being honest about the gap.
**Route the bare-initial class to editorial review** (the same human
redaction-proposal pass in step 2 above) instead of treating a line in this
file as coverage for it — it isn't, and implying otherwise is exactly the
mistake this section exists to prevent.

## The on-cluster HyperKitty read path (documentation only)

This section documents where a future export step would read from — **no
live read was performed for this PR**, and this pipeline has no code that
performs one.

- **Namespace:** `latoolb-us-production`.
- **Surface:** the same in-cluster `mailman-web` Service the live discuss@
  archive already reads (`$lib/server/discuss-archive.ts`,
  `DEFAULT_INCLUSTER_ORIGIN`), a plain ClusterIP Service DNS name resolvable
  only inside the cluster. HyperKitty exposes a read-only REST API under
  `/hyperkitty/api/list/<list-address>/...` (`threads/`, `thread/<id>/`,
  `thread/<id>/emails/`, `email/<hash>/`) — see that module for the exact
  request shapes and the `ALLOWED_HOSTS` / Host-header quirk it already
  works around.
- **Scope for a keyholders@ export:** the same REST surface, scoped to
  `keyholders@latoolb.us` instead of `discuss@latoolb.us`. Because that list
  is **private**, any such read must run from an operator-authorized,
  in-cluster context (a job or pod with netpol access to the private
  archive) — never from this public repo's CI, never from an agent sandbox
  without cluster access, and never against `discuss-archive.ts`'s existing
  discuss@-only code path, which is deliberately scoped to the public list
  and must stay that way.
- **Read-only.** `SELECT`-shaped reads only, matching the operator's own
  packet-preparation note (`mailmanweb` database via the HyperKitty web
  tier, read-only). No list mutation, no credential printing or persistence.
- **Output shape:** whatever future export step reads this way would still
  need to pass through the SAME editorial redaction step (2, above) before
  it could ever become `scripts/discuss-to-svx.mjs` input — this doc does
  not shortcut that; it only names where the raw material would come from.

## Hard rules

- **Never sends mail.** No script in this pipeline holds a mail transport
  dependency, an SMTP credential, or a "send" code path. Posting is always a
  human, manual, operator action.
- **Never reads keyholders@ live from this repo's automation.** The read
  path above is documented for a future, separately-authorized export step;
  it is not wired into any Just recipe, CI job, or script here.
- **Never invents redactions.** `scripts/discuss-to-svx.mjs` stages
  already-redacted text verbatim; it does not decide what to redact.
- **Never ships a draft to the live site.** `src/content/discuss-drafts/**`
  is outside every glob import this repo's build actually uses.

## Usage

```sh
# [OPERATOR, one-time / whenever ~/.gftb/naming-consent.plain changes]
just naming-consent-hashes
just naming-consent-hashes-verify   # confirm no drift before committing

just discuss-to-svx -- --input path/to/export.json
just discuss-drafts-validate

# [OPERATOR] after manually posting a draft's body to discuss@ (step 6):
just discuss-reconcile -- --slug <slug> --archive-url '<public thread deep link>'
```

See `scripts/discuss-to-svx.mjs` for the full input contract,
`src/lib/data/discuss-draft-schema.ts` for the frontmatter contract, and
**Naming-consent gate design** above for the hash-gate mechanism.
