# Apex Access-gate flip — readiness pack (TIN-2421)

- Status: **AUDIT + DOCS deliverable. No flip performed. No Access policy, infra,
  Cloudflare, or site copy changed by this pack.** Read-only across the site.
- Owner: TIN-2421 (`GFTB: open the apex Access gate`, currently **Backlog**)
- Date: 2026-07-04
- Authoritative criteria source: `docs/decisions/0004-gate-opening-criteria.md`
  (A1–A5). Authoritative consent source: `docs/naming-consent.md`.
- Provenance: pre-flip audit lane (Lane C). Copy edits are owned by the copy
  lane (TIN-2516); this pack **reports** copy/consent gaps, it does not fix them.

## Headline

**1 of the 5 gate-opening criteria holds (A3 — mail/list smoke, done).** The
other four are not met. The single biggest blocker is **A5 (naming-consent
sweep not clean)**: `static/readme.txt` still publishes the alderman's full
first name **"Joe"** even though the operator ruling consented him only to the
initial-only credit **"J."** (a live, public consent-scope violation on an
indexable file), and **5 org / institution references remain PENDING** consent.
A1 (Wave-3 prose sign-off), A2 (Ripley/Kate-Pulham wording sign-off), and A4
(Access allowlist expansion for pre-flip review) are additionally
operator-gated and not started.

The gate opens only when **all five** hold and **no criterion may be waived
silently** (0004, "Option A"). At 1/5, the flip is not ready.

---

## 1. Naming-consent audit

### Method

Enumerated every named person/stakeholder/org reference reachable on a public
route or public static file (`src/routes/**`, `src/lib/data/**`, `static/**`),
then cross-referenced each against the consent tracker in
`docs/naming-consent.md`.

### Individuals

| Name (as published) | Public surface(s) found | Tracker status | Verdict |
| --- | --- | --- | --- |
| **Ripley** | `/shout-outs` (Founding supporter); **`/cells` "Captain: Ripley."** and **`/cells/welding` "Ripley's cell"** (`src/lib/data/cells.ts:73`, `src/routes/cells/welding/+page.svelte:32`); `static/readme.txt:29` | CONSENTED 2026-07-04 (public name = Ripley, was Kate Pulham) | Consented, but **tracker Surface column is stale** — it lists only `/shout-outs`; the `/cells*` captain surfaces are undocumented. See §Ripley-vs-Kate-Pulham open confirm. |
| **J.** (alderman, Lewiston) | `/shout-outs:14-17` (initial-only "J.") | CONSENTED 2026-07-04, **initial-only credit approved** | Consented **as "J." only**. **VIOLATED elsewhere** — see next row. |
| **"Joe"** (same person as "J.") | **`static/readme.txt:29`** — "Joe (Lewiston alderman -- the bus lives on his property)" | Consent is for **initial-only "J."**, not the full first name | **REDACTION BLOCKER (A5).** `static/readme.txt` is a public, indexable file (`/readme.txt`). It exposes the consented-away full first name. Must be changed "Joe" → "J." before the flip. PR #69 fixed the Kate→Ripley leak in this same file but did not catch "Joe". |
| **Alex** (founder) | `/shout-outs:19-22`; `static/readme.txt:29` | CONSENTED 2026-07-04 (first-name credit approved) | Consented; surfaces consistent. |
| **Jess Sullivan** | `/shout-outs` (person + About-Jess bio); `/stewards` (footer/links); `/plans:115` ("webmaster Jess"); **`/cells` "Captain: Jess."** (`src/lib/data/cells.ts:66`); `static/readme.txt:30` | SELF (self-consent) | Fine. `/cells` captain surface not in tracker Surface column (documentation gap, not a blocker). |

Non-rendered mention (not a surface): `src/lib/components/DetailsNeeded.svelte:7`
names "Jess, Ripley, a captain" in a **code comment** only — not shipped to the
page. No action.

### Org / institution references (policy covers "reference", not only people)

The operator policy (verbatim, `docs/naming-consent.md`): *"Will withhold all
shoutouts / names publicly until each stakeholder / reference has agreed to be
named."* All rows below are **PENDING** in the tracker — neither
agreed-and-dated nor redacted — so under A5 as written each is unresolved:

| Reference | Public surface | Tracker status |
| --- | --- | --- |
| The Portland makerspace community | `/shout-outs` (Friends of the bus) | PENDING |
| Ithaca Generator | `/shout-outs` (Friends + About-Jess bio) | PENDING |
| Artisan's Asylum | `/shout-outs` (Friends + bio) and `/bibliography` credit | PENDING |
| Cornell CALS Landscape Architecture makerspace | `/shout-outs` (About-Jess bio) | PENDING |
| Plymouth State D&M Makerspace | `/shout-outs` (About-Jess bio) | PENDING |

These are lower-severity than the "Joe" leak (institutional references in the
operator's own bio, not private individuals), but A5's literal text —
*"every named stakeholder/reference … has explicitly agreed … any name without
recorded consent is redacted from the site in the pre-flip sweep"* — is not
satisfied while they sit PENDING. Per the tracker's own rule 3, a stale PENDING
row must be **escalated to the operator**, not left to block silently.

### Ripley-vs-Kate-Pulham — OPEN operator confirm (do NOT resolve here)

The tracker records Ripley as CONSENTED (public name = Ripley, was Kate Pulham,
gh: krosepulham), but notes the **D4 wording sign-off is still tracked
separately**. `TIN-2516` (copy-audit, Backlog) carries the same item as a **P1
operator-confirm** and states explicitly that it **gates TIN-2421 criteria A2
(naming consent wording) and A5 (redact unconsented names)**. This pack leaves
it OPEN by design.

- Good news, verified: **"Kate" / "Pulham" / "krosepulham" appear NOWHERE on any
  public route or static file** (grepped `src/`, `static/`). The on-site
  redaction to "Ripley" is already complete; there is **no live Kate-Pulham
  leak**. The open item is the operator's **wording sign-off (D4 / A2)**, not a
  redaction.

---

## 2. Org-name / domain consistency sweep

Swept `src/`, `static/`, and `src/app.html` for the org's names, domains, and
mail addresses. **Result: consistent. No typos or variants found.**

| Token | Expected form | Finding |
| --- | --- | --- |
| Web domain | `greatfallstoolbus.org` | Consistent everywhere (`+layout.svelte:26`, `sitemap.xml/+server.ts`, `robots.txt`, `llms.txt`, JSON-LD). No `.com`, no `greatfallstoolbus` one-word/misspelled variant. Projection host `greatfallstoolbus.org.tinyland.dev` in `docs/CI-SCHEMA.md` is the legitimate internal snapshot domain, not a site-facing typo. |
| Mail / redirect domain | `latoolb.us` | Consistent everywhere. No `latoolbus`/`latoolb.us.org` variants. |
| Org display name | `Great Falls Tool Bus` | Consistent (`SITE_NAME`, every `<title>`, `BusMark`/`Wordmark`). Uppercase `GREAT FALLS TOOL BUS` in cell-sheet kickers and `readme.txt` is intentional styling, not a variant. |
| Short name | `GFTB` | Used only in code/env identifiers (`PUBLIC_GFTB_FORM_ENDPOINT`, skill slugs `gftb-mail-laceup-*`), never in user-facing prose. Consistent. |
| Keyholders list | `keyholders@latoolb.us` | Consistent across the contact mailto, `src/lib/data/mail-clients.ts`, `llms.txt`, and runbooks. `keyholders-join@` / `keyholders-owner@` / `keyholders-leave@` sub-addresses consistent. |
| Future public list | `discuss@latoolb.us` | Referenced only in a `mail-clients.ts` code comment and runbooks as the *future* public board — not a live site-facing address. Correct. |
| Form endpoint | `forms.latoolb.us` | Consistent (`contact/+page.svelte:30` default, `contact-form.ts`). Live per TIN-2420 (Done). |

The **only** name-level defect is the `static/readme.txt` "Joe" spelling of the
"J." alderman — reported under §1 as a **consent** issue, not an org-name typo.

---

## 3. SEO / OG surface check (read-only)

| Surface | State | Launch-ready? |
| --- | --- | --- |
| **og-image** | `static/og-image.png` present (49 KB). `SEOHead.svelte` emits `og:image` + `og:image:alt` + `twitter:image`; `+layout.svelte:33` sets `OG_IMAGE = ${SITE_URL}/og-image.png`. | **Yes.** (Cards can't render until the Access 302 is removed — that's the flip itself, 0004 execution step 2.) |
| **`<title>` / meta description** | Per-route `<title>` + description present on all routes; `SEOHead` supplies canonical, og:*, twitter:*, JSON-LD `WebSite`, and `robots: index,follow`. | **Gap — see SEO-1.** |
| **sitemap.xml** | `src/routes/sitemap.xml/+server.ts`, prerendered, 14 entries, referenced by robots.txt. | **Gap — see SEO-2.** |
| **robots.txt** | `static/robots.txt`: `User-agent: * / Allow: /` + `Sitemap: https://greatfallstoolbus.org/sitemap.xml`. | **Yes** — allow-all is the intended post-flip posture; Access blocks crawlers until the flip, so no pre-flip disallow is needed. |
| **canonical / JSON-LD** | `SEOHead` normalizes canonical to the production origin (strips the GitHub-Pages `base` prefix); JSON-LD `<` escaped. | Yes. |
| **favicon** | `static/favicon.svg`, referenced in `app.html`. | Yes. |

### SEO-1 — duplicate + wrong-text meta description (should fix before flip)

`src/app.html:6-9` hard-codes the **scaffold boilerplate** description:

> "Tinyland house scaffold for static SvelteKit brand sites with Just, Nix,
> Bazel, Skeleton, and static projection discipline."

`SEOHead.svelte:99` **also** emits a real `<meta name="description">`. Because
`app.html` is static template HTML and `%sveltekit.head%` is injected
alongside it (SvelteKit does not de-duplicate across the two), **every page
ships two `<meta name="description">` tags, one of them the wrong scaffold
text.** Fix = remove the `<meta name="description">` block from `src/app.html`
(the per-page `SEOHead` one is authoritative). Not owned by this pack.

### SEO-2 — sitemap omits 5 live public routes

`sitemap.xml/+server.ts` lists 14 URLs but **omits `/access`, `/find-the-bus`,
`/mission`, `/safety`, `/stewards`** — all live, indexable routes. The endpoint
comment ("Add additional routes here as M5 lands them") confirms the list was
never updated as those pages landed. Fix = add the 5 paths to `PAGES`. Not
owned by this pack.

### SEO-3 — informational: no `static/CNAME`

There is no `static/CNAME`. Primary hosting is Cloudflare Pages (ADR 0003; note
ADR 0008, Accepted 2026-07-05, supersedes 0003 for the production-hosting
direction toward on-cluster, but that cutover is operator-gated and not yet done,
so CF Pages is still the live host), for which a `CNAME` file is not required, so
this is **not a flip blocker**. It only matters for the GitHub-Pages fallback
lane described in `docs/runbooks/dns-mail-checklist.md` §2. Flagged for operator
awareness.

---

## 4. Exit-criteria checklist (0004 A1–A5)

Criteria and "evidence of done" reproduced verbatim from
`docs/decisions/0004-gate-opening-criteria.md`; status is this pack's
evidence-backed assessment as of 2026-07-04.

| # | Criterion | Required evidence (0004) | Status | Evidence / why |
| --- | --- | --- | --- | --- |
| **A1** | Wave-3 prose/design sign-off | "TIN-2419 closed Done" | ❌ **NOT MET (operator-blocked)** | **TIN-2419 is Backlog**, not Done. It is explicitly blocked on operator-only inputs: source photography, logo direction (interim wordmark not yet ratified as final), stewards roster, and 501(c)(3)/fiscal-sponsor status. Wave-2.5 polish shipped (PRs #56–#70) but the Wave-3 sign-off ticket is unclosed. |
| **A2** | Ripley/Kate-Pulham wording sign-off (D4) | "the open checkbox in 0001's sign-off record is checked, with the agreed copy landed" | ❌ **NOT MET (open operator confirm)** | Tracker: Ripley CONSENTED but "D4 wording sign-off still tracked separately." **TIN-2516 P1** carries this as an unresolved operator-confirm and states it gates A2/A5. No live Kate-Pulham leak (already redacted to "Ripley"); the open item is the wording sign-off itself. |
| **A3** | Mail/list smoke green | "TIN-2379 CRs applied and a keyholders@latoolb.us round-trip + list smoke passes" | ✅ **MET** | **TIN-2379 Done 2026-07-04** (two-way deliverability smoke; Postfix logs show inbound LMTP + outbound STARTTLS fan-out accepted by Gmail). **TIN-2380 Done 2026-07-04**: live Mailman API `archive_policy=private`, `subscription_policy=moderate`, `advertised=False`; anonymous HyperKitty probe returns 403. Blahaj PRs #869/#875/#894/#901; infra PRs #23/#26/#27/#31/#32. |
| **A4** | Access allowlist expanded (Alex/Kate/Joe) | "the three named reviewers have seen the gated site through their own Access logins before the flip" | ❌ **NOT MET / not verifiable from repo (operator-gated)** | This is a Cloudflare Access action with no in-repo artifact. No recorded evidence the three reviewers logged in. TIN-2421 is Backlog and unstarted, so this is presumed not done. Operator must confirm. |
| **A5** | Naming-consent sweep clean | "every named stakeholder/reference currently on the site has explicitly agreed to be named … any name without recorded consent is redacted … before the Access policy changes" | ❌ **NOT MET** | Individuals Ripley/Alex/Jess consented and J. consented **as "J." only**, BUT (a) **`static/readme.txt:29` still publishes "Joe"** — the consented-away full first name — a live public leak; and (b) **5 org/reference rows are PENDING** (Portland makerspace community, Ithaca Generator, Artisan's Asylum, Cornell CALS, Plymouth State D&M) — neither agreed nor redacted. See §1. |

**Score: 1 / 5 (A3 only). Flip NOT ready.**

### Operator-blocked vs actionable

- **Purely operator-gated (no agent action possible):** A1 (needs assets +
  sign-off), A2 (needs D4 wording ruling), A4 (needs Access-login evidence).
- **Actionable redaction/edit work, then operator sign-off (A5 + SEO):**
  1. `static/readme.txt:29` — "Joe" → "J." (consent leak; highest urgency).
  2. Resolve/escalate the 5 PENDING org-reference consent rows.
  3. SEO-1 — remove the scaffold `<meta name="description">` from `src/app.html`.
  4. SEO-2 — add `/access`, `/find-the-bus`, `/mission`, `/safety`, `/stewards`
     to the sitemap.
  (Items 1–4 are **reported here, owned by the copy/SEO lanes** — this pack does
  not edit site source.)

---

## Appendix — what this pack changed

- **Added:** this file (`docs/launch/apex-flip-readiness.md`).
- **Appended (not rewritten):** a dated pre-flip audit addendum to
  `docs/naming-consent.md` recording the newly-found surfaces (Ripley/Jess on
  `/cells*`) and the `static/readme.txt` "Joe" leak.
- **Changed on the site:** nothing. No route, component, `static/` file, Access
  policy, or infra touched.
