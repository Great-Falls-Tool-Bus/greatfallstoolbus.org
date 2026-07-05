# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer 2.0](https://semver.org/).

## [Unreleased]

### Added

- Wave-2.5 interaction polish (Skeleton-bundled Zag, zero new deps): calm,
  keyboard-accessible interaction upgrades built entirely on components
  `@skeletonlabs/skeleton-svelte@4.15.2` already re-exports (Zag 1.39.1), so no
  direct `@zag-js`/`bits-ui`/`melt` import is added and the house-stack-contract
  test stays green. A nav active-underline (`.nav-underline` in `app.css`) grows
  from the left on hover/focus and stays lit for the current page via
  `aria-current="page"`; the `/plans` now/near-term status collapses into a
  Skeleton `Accordion` (each trigger wrapped in an `<h2>` per the WAI-ARIA
  accordion pattern, "now" open by default) to cut scroll; keyboard/focus
  glossary tooltips (`InfoTip`, backed by Skeleton `Tooltip`) explain the
  keyholder role on `/access` and the steward roles on `/shout-outs`; and the
  `/contact` keyholder addresses gain copy-to-clipboard feedback through a
  Skeleton `Toast` (`createToaster`, region mounted once in `+layout.svelte`).
  Every affordance rides the existing global `prefers-reduced-motion` guard, so
  motion snaps off for users who ask for it while the state stays legible.
- Find-the-bus surface (TIN-2419): a new short, prerendered `/find-the-bus`
  route closes the "where is it?" gap flagged in `docs/ux-research.md` (line
  149) — nothing on the site answered where the bus is. The answer is
  request-first by design: the bus is based at a fixed location in
  Lewiston-Auburn, Maine (concrete, known), but the exact spot is
  deliberately not published; a visitor reaches out through the live
  `/contact` form and a keyholder shares the location and walks them through
  access. The page names this as a deliberate, keyholder-stewarded posture
  for safety and access control while the Tool Bus is an unincorporated
  neighborhood initiative. It invents nothing: the bus does not roam, so there
  are no stops, routes, hours, or schedule, and the page carries no
  placeholder `detailsNeeded` scaffolding. The route uses `PageHeader`, so it
  gains the view/edit-source affordance for free and is registered in the
  generated `source-map.json`. Added to the primary nav (with a `MapPin` icon)
  in the "use" cluster and linked from the homepage's "Getting on the bus"
  section and more-pages row so a visitor looking for "where" finds it. The
  `/access` step-three copy is corrected to match: the bus sits at a fixed
  location a keyholder shares, rather than one that moves.
- Media pipeline proven end-to-end with a verifiably public-domain image. Adds
  `static/photos/hand-tools-plate-1922.jpg` — a labeled 1922 plate of
  woodworking hand tools from Louis M. Roehl's _Manual Training for the Rural
  Schools_ (published 1922, US public domain; verified via the Wikimedia Commons
  imageinfo API), with no identifiable people. A new `src/lib/data/credits.ts`
  license ledger records the exact source page, asset URL, author, and license
  for every content image and exposes `creditFor(src)`; `/mission` renders the
  plate through `Picture.svelte` off the generated `static/image-manifest.json`
  (AVIF/WebP renditions + intrinsic dimensions) with an auto-resolved credit
  caption. Adds `docs/contributing-photos.md`, a keyholder walkthrough for
  adding a photo through the `SourceLink` "Edit this page" view-source flow
  (grounded in the `detailsNeeded` / `detailsWanted: ['photo']` pattern), with
  the license rules: only CC0 / public-domain / own photos, no random web
  images, no AI passed off as real, no hotlinking.
- In-page contact form submission UX (TIN-2420 Path B, site side): the
  `/contact` form graduates from a plain mailto compose to a modern in-page
  flow with an idle to submitting to success or error state machine. On
  submit it POSTs JSON `{name,email,message,website}` to
  `${PUBLIC_GFTB_FORM_ENDPOINT}/api/contact` (the Anubis-guarded form-handler
  that injects to the keyholders list over LMTP), with a 15s `AbortController`
  timeout, a disabled `aria-busy` button with a spinner, an inline success
  panel that replaces the form ("Your request is on its way to the
  keyholders"), and an inline error alert that preserves the typed values and
  offers both a retry and the mail draft as a manual fallback. Adds a
  screen-reader-hidden, untabbable honeypot field, client-side field
  validation with inline per-field errors before any network call, and
  respects `prefers-reduced-motion` on the panel-swap transition. Progressive
  enhancement is preserved: with `PUBLIC_GFTB_FORM_ENDPOINT` unset (today) the
  form still composes a keyholders mail draft in the visitor's own app,
  reframed as the deliberate fallback, plus a `<noscript>` block with the
  direct mailto instructions. The honeypot and validation logic is extracted
  to the pure, unit-tested `$lib/contact-form.ts` (new Vitest suite).
- Wave-2.5 icon vocabulary: expand `@lucide/svelte` usage from the theme and
  drawer utility icons to a curated set of decorative icons across the
  primary nav, mobile drawer, and page headers. `NavItem` in `nav-items.ts`
  gains an optional `icon` field so the desktop nav, mobile drawer, and each
  route's `PageHeader` share one icon per section: Mission (Compass), Tools
  (Hammer), Cells (Boxes), Access (KeyRound), Safety (ShieldCheck), Donate
  (Gift), Wants (ClipboardList), Plans (Map), Bibliography (BookOpen),
  Shout-outs (Megaphone), Contact (Mail), plus Stewards (Users) on its page
  header. All icons are tree-shaken named imports, sized to match the site's
  existing 16-20px icon convention, and marked `aria-hidden` as decoration.
- View/edit page source subsystem (TIN-2360): `scripts/build-source-map.mjs`
  walks `src/routes/**/+page.svelte` and derives
  `src/lib/generated/source-map.json` (route id to repo-relative source path,
  plus the repo URL and branch resolved from `tinyland.repo.json` /
  `package.json`, never hardcoded in a component). A new `SourceLink.svelte`
  renders a calm "Edit this page" / "View source" pair linking to GitHub's web
  editor and blob view, wired into the shared `PageHeader` so every page with a
  header gets the git-onboarding affordance from architectural zero (no per-page
  opt-in; routes absent from the map render nothing). Wired `just
  source-map-build` and the `just source-map-check` drift gate into `just
  check`, mirroring `skills-build` / `skills-check`, and added a Vitest contract
  asserting every route that renders `PageHeader` resolves to a source-map entry.
- Two new tool cells welded into the shared `.svx` inventory tree: the
  **network and tracing cell** (Jess's, captain Jess) with a Fluke tone
  generator and probe set, a PortaPack Mayhem SDR, a G2 base-station LoRa
  radio, and assorted ethernet splicing and testing gear; and the **welding
  cell** (Ripley's, captain Ripley) with a multiprocess arc/MIG welder, work
  holding and related gear, arc-rated eye protection, and clamps. Both get a
  printable cell sheet at `/cells/network` and `/cells/welding`, appear
  automatically on `/tools`, `/cell-sheets`, and the `/cells` index, and are
  registered in the sitemap.
- A wiki "citation needed" pattern for the tool inventory: a per-item
  `detailsNeeded` frontmatter flag plus an optional `detailsWanted` list, and a
  calm `DetailsNeeded.svelte` chip that names exactly what is missing (model
  number, photo, config) and links "Edit this page" to the tool's `.svx` source
  on GitHub. This lets an owner fill in a real specific instead of the site ever
  inventing a make, model, year, or spec. The edit URL resolves through a new
  `$lib/repo.ts` helper (mirroring `tinyland.repo.json` `repo.github`), which is
  the convergence point for the #60 view-source source map when it lands.
  Applied truthfully: the welder (brand and model unknown), the Fluke kit (exact
  model plus photo), the SDR and LoRa radio (photo plus config), and the
  assorted ethernet gear (itemized contents plus photo) all carry the flag.
- Wave-2.5 media pipeline: manifest-driven `Picture.svelte` component and
  `src/lib/responsive-image.ts` srcset builder (AVIF/WebP sources, lazy
  loading by default, intrinsic width/height plus aspect-ratio to prevent
  layout shift). `scripts/optimize-images.js` now emits intrinsic
  width/height per entry and writes the manifest to
  `static/image-manifest.json` (a committed empty fallback keeps zero-photo
  builds green), and `just build` chains the optimizer automatically when
  `static/photos` has assets.
- Add a derived Server-side Sieve mail lace-up profile so agents can set up
  mailbox-side keyholders filing without inventing mail-host endpoints.

### Changed

- Rewrite site prose in the Wave-2.5 voice pass: remove every em-dash from the
  page copy, dedupe the tagline and other boilerplate echoes to one canonical
  home each, cut the self-describing "honest" tic and build-status leaks, and
  align `/access`, `/mission`, `/tools`, and the home page with the ratified
  access model (keyholders are a curated, owner-approved group; anyone may
  request access and non-member requests reach all keyholders; no membership
  fee, no paperwork wall).
- Wave-2.5 typography: swap the display/wordmark face from Raleway to
  self-hosted Fraunces Variable (`@fontsource-variable/fraunces`), keeping
  Crimson Pro body and Inter UI chrome; replace the hand-vendored FiraCode
  Nerd Font Mono woff2 files in `static/fonts/` with
  `@fontsource-variable/fira-code`, ligatures on (liga + calt) through a
  Tailwind v4 `@theme` mono token; wire `--typo-*` tokens and CLS-safe
  fallback stacks in `app.css` and the omux theme. No runtime external font
  fetches; everything stays self-hosted through fontsource.
- Re-point apply-plane references from the blahaj tenants lane to the org
  apply-plane overlay `great-falls-tool-bus-infra` (packet 0001 Amendment 1,
  memo 0002): `applied_by` in both intent files, secrets plane vocabulary
  (`gftb-infra-sops`), runbook superseded into the pointer stub
  `docs/runbooks/dns-apply.md`, and removal of the site-side `.sops.yaml`
  recipient pin (the sops lane lives in the overlay).

### Fixed

- Restore a clean static-build accessibility pass by labeling home secondary
  navigation and footer navigation links.
- Remove static build warning noise by giving card/tool links explicit
  accessible labels, splitting printable-sheet print colors for Svelte's
  accessibility validator, and normalizing mdsvex module scripts to Svelte 5
  syntax.
- Forward GloriousFlywheel `BAZEL_REMOTE_INSTANCE_NAME` through the Bazel
  wrapper so tenant-scoped REAPI tokens do not fall back to Bazel's `default`
  instance.

## [0.1.0] - 2026-06-23

### Added

- First versioned `greatfallstoolbus.org` release surface, including a release workflow
  that cuts immutable `vMAJOR.MINOR.PATCH` tags, moves the floating `vMAJOR`
  tag with an explicit remote lease, and creates GitHub Releases from this
  changelog.
- Release operator runbook documenting the required `release: vX.Y.Z` commit
  shape and tag immutability rules.

### Changed

- Promote the scaffold package version to `0.1.0` so SBOM/source-version output
  matches the first taggable scaffold release.
- Correct spoke state guidance to stay provider-neutral: state keys target the
  operator-provisioned S3-compatible backend, while spokes must not hard-code a
  backend provider. Tinyland's current internal RustFS deployment remains
  separate from trusted RBE CAS/action-cache/publication authority.
