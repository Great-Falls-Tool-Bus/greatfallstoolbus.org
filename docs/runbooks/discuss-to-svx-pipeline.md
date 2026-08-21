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
   - re-checks naming-consent (`src/lib/naming-consent.ts`): rejects a
     private-only identity outright, rejects the bus host's unredacted first
     name (only the initial "J." is a public-consent form),
   - re-checks for any bare email address in the subject or body (the two
     list addresses themselves are the only allowed exceptions — they are
     list identifiers, not personal addresses),
   - validates the assembled frontmatter against `DiscussDraftFrontmatter`
     (`src/lib/data/discuss-draft-schema.ts`),
   - writes `src/content/discuss-drafts/<slug>.svx` with `published: false`,
     a provenance HTML comment (source list + opaque message id, never an
     address), and the pending-notice HTML comment below.
   - Never overwrites an existing draft without `--force`.
4. **`scripts/validate-discuss-drafts.mts`** (`just discuss-drafts-validate`,
   wired into `just check`) independently re-runs the same naming-consent and
   address gates against every file's raw text, plus the schema and a
   pending-notice-comment check — so a hand-edited draft that bypassed the
   generator still fails CI, not just gitleaks.
5. **`.gitleaks.toml`** carries two matching custom rules
   (`gftb-naming-consent-bus-host-full-name`,
   `gftb-naming-consent-private-only-identity`) as a third, independent
   backstop through `just secrets-scan-dir` / `just secrets-scan`.
6. **Operator reviews the staged draft** and, when ready, sends the body to
   `discuss@latoolb.us` **themselves**, from their own mail client. No part
   of steps 1–5 sends mail.
7. **Reconciliation (future step, not implemented here).** Once the post
   lands in the public HyperKitty archive, a human flips `published: true`
   and adds the real `archiveUrl` (the public thread deep link, same shape as
   `publicThreadUrl()` in `$lib/server/discuss-archive.ts`). The schema
   enforces that `archiveUrl` is required once `published` is `true`, so a
   draft can never claim to be live without pointing at a real destination.
   Until reconciliation happens, the pending-notice comment stands:

   ```html
   <!-- pending discuss@ posting by operator; svx to be reconciled to the posted archive URL -->
   ```

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
just discuss-to-svx -- --input path/to/export.json
just discuss-drafts-validate
```

See `scripts/discuss-to-svx.mjs` for the full input contract and
`src/lib/data/discuss-draft-schema.ts` for the frontmatter contract.
