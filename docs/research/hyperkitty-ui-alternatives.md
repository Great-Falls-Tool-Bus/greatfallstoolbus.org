# Research: HyperKitty archive UI — brand it, replace it, or stay headless?

Decision-ready survey for the Great Falls Tool Bus list archive. Grounded in the
live GFTB stack (`Great-Falls-Tool-Bus/greatfallstoolbus.org`, `main`, read
2026-07-06), the in-repo reader in `src/lib/server/discuss-archive.ts`, and
upstream HyperKitty / docker-mailman / public-inbox sources. External claims are
cited inline with URLs in §6. Anything not verified against a primary source is
marked `UNVERIFIED`.

## 0. Situation (what we run today)

- **Mail engine + fallback archive:** GNU Mailman 3 with HyperKitty `1.3.12`,
  served by the `maxking/mailman-web:0.5` image under uWSGI on k8s at
  `lists.latoolb.us`, behind an **Anubis proof-of-work gate**.
- **Static-assets bug:** FIXED via a uWSGI `static-map`, so stock HyperKitty now
  renders its own CSS/JS correctly. Note: the upstream `maxking` `uwsgi.ini`
  ships **no** `static-map` (static is normally fronted by nginx), so our fix is
  a local delta on top of the pinned image — it lives outside the image and must
  survive image bumps.
- **Primary archive UX:** an on-site custom reader at `greatfallstoolbus.org`
  `/discuss` (SvelteKit) that reads HyperKitty's REST API **in-cluster** at
  build time and maps it into the `DiscussSnapshot` contract. HyperKitty is now
  mostly a **fallback / deep-link surface** plus the mail engine.

The question: can HyperKitty itself be branded acceptably off-the-shelf, and is
there a materially better archive UI we should adopt instead?

## 1. HyperKitty theming mechanics

HyperKitty is a Django app; theming is plain Django template + static override.
There are two tiers of effort.

### 1a. Light branding (snippet injection) — hours

HyperKitty ships three intentionally-empty include points you override via
Django's `TEMPLATES['DIRS']` precedence (your dir wins over the app's) — no fork
required:

- `hyperkitty/headers.html` — injected **before `</head>`** (add a `<link>` to a
  brand stylesheet, a `<style>` block, or a favicon).
- `hyperkitty/top.html` — injected **before `<body>` content** (brand banner /
  nav bar).
- `hyperkitty/bottom.html` — injected **before `</body>`** (footer, analytics).

The base template also exposes a `{% block additional_stylesheets %}` hook, but
setting it cleanly has historically been awkward (upstream issue #306); the
`headers.html` include is the supported, low-friction path. This tier gets you
colors, logo, favicon, a nav strip, and a footer without touching upstream HTML.

### 1b. Deep restyle (template + static override) — days to weeks

To change layout, the thread list, or the message view you override the actual
page templates (e.g. `base.html`, `index.html`, thread templates) in your
`TEMPLATES['DIRS']` dir, typically using `{% extends %}` + `{% block %}` /
`block.super` so you inherit behavior and re-skin the shell. HyperKitty's own
CSS is Bootstrap-based (`hyperkitty/static/hyperkitty/libs/bootstrap`), so a
Bootstrap re-theme (a Bootswatch-style variable swap) is the natural deep-restyle
route. Cost: every override is now a surface you own against HyperKitty upgrades
— upstream template churn can silently break your extends.

### 1c. Static pipeline (the real operational cost)

CSS/JS changes are **not** live-served. HyperKitty uses `collectstatic` +
`django-compressor`, so any static change requires re-running, per the install
docs:

```
django-admin collectstatic --pythonpath <project> --settings settings
django-admin compress     --pythonpath <project> --settings settings
```

### 1d. Doing this inside the pinned `maxking/mailman-web:0.5` image

The image imports a user-supplied `settings_local.py` (Django reads it at
startup; it lives under the mounted web-data volume — the image mounts host
`/opt/mailman/web` → container `/opt/mailman-web-data` for db/logs/config). So:

- **Settings + snippet templates:** mount a templates directory, point
  `TEMPLATES[0]['DIRS']` at it in `settings_local.py`, drop in
  `hyperkitty/headers.html` etc. No image rebuild. This is the §1a path and is
  fully compatible with staying pinned.
- **Static/CSS:** because `collectstatic`/`compress` must run against the served
  static root, a brand stylesheet either (a) is injected as an inline `<style>`
  or an absolute-URL `<link>` via `headers.html` (no collectstatic needed — the
  cheap trick), or (b) is baked into a **derived image** `FROM
  maxking/mailman-web:0.5` that runs collectstatic at build. Option (b) is where
  upgrade friction lives: every base-image bump re-derives.

**Themed-deployment precedents (packaging patterns):**

- **Fedora (`lists.fedoraproject.org`)** and **Debian/DebOps** manage HyperKitty
  via Ansible; DebOps exposes a documented `hyperkitty_configuration` role
  surface, i.e. theming is done as **config-managed settings + template
  overrides in the deployment role**, not as a redistributable "theme package."
  `UNVERIFIED`: I did not confirm the exact template set Fedora overrides (their
  navbar/branding is applied in their private infra ansible), but the mechanism
  is the standard `TEMPLATES['DIRS']` + custom static described above.
- There is **no maintained, installable HyperKitty theme on PyPI** — no
  "themes ecosystem." Every branded instance is a bespoke per-deployment
  override set. Treat "themed HyperKitty" as *your* small template dir, versioned
  in `great-falls-tool-bus-infra`, not a dependency you can pull.

**Effort estimate:** minimal brand (colors/logo/nav/footer via `headers.html` +
`top.html`/`bottom.html` and an inline/linked stylesheet) is a **hours-scale,
upgrade-safe** change. A deep restyle (custom thread/message templates, Bootstrap
re-theme, derived image) is **days-to-weeks** and creates a standing upgrade tax.

## 2. Alternate archive UIs (must consume Mailman 3 / mbox / maildir)

| Option | Maturity | Ingest from our stack | Self-host cost | Look/feel |
|---|---|---|---|---|
| **public-inbox** (lore.kernel.org engine) | High, actively maintained (Eric Wong) | Mirror the list to an mbox and feed `public-inbox-watch` / MDA; v2 inbox = git + SQLite + Xapian | Low RAM, git-backed; needs Xapian/SQLite; multi-protocol daemons | Deliberately spartan, text-first HTML; Atom/NNTP/IMAP too |
| **sourcehut `lists.sr.ht`** | High, production (AGPL) | Feed by email; part of the full sourcehut platform | Heavy — pulls in the whole sourcehut suite (Postgres, multiple services) | Clean, threaded, patch-centric |
| **mail-archive.com** | Stable, but a hosted third party | Subscribe the archive address to the list; not self-hosted | $0 infra but **externalizes** the archive off our cluster | Dated; weak threading/collapsing |
| **marc.info (MARC)** | Long-running, volunteer-run | Not self-hostable; you request inclusion | n/a (not ours to run) | Very dated |

Reading of the field:

- **public-inbox** is the only alternative that is both modern-maintained *and*
  self-hostable at low cost. Its data model is "archives are a git repo," it has
  **real full-text search via Xapian** (something HyperKitty's REST API does not
  expose — see §3), and it speaks HTTP + Atom + NNTP + IMAP. Ingestion from
  Mailman 3 is via mbox/MDA mirroring, which we can drive from the list. The cost
  is aesthetic: it is intentionally plain and text-first — the opposite of a
  branded community-board look. It is a great *engineer-grade* archive, a poor
  *neighborhood-tool-library* front door.
- **sourcehut lists** is excellent software but adopting it means adopting
  sourcehut — far too much surface for one community list.
- **mail-archive.com / marc.info** are non-starters here: they move the archive
  off-cluster (privacy: we deliberately keep `discuss@` public-safe and never
  emit raw addresses — see `discuss-archive.ts`), and their UI is worse than what
  we already ship.

**Conclusion:** no alternative archiver beats *our own reader* on look/feel, and
only public-inbox beats HyperKitty on search. None is worth a platform swap given
we already have a branded reader.

## 3. The "headless HyperKitty" pattern (what we already do)

Consuming HyperKitty's REST API and rendering your own frontend is a **real,
if uncommon, pattern** — precedent exists (e.g. `maxking/hyperkitty.el`, an Emacs
client that reads the same REST API). It is not a documented "product mode," but
it is a supported read surface: for **public** lists the API returns data without
auth (private lists are filtered out by `ArchivePolicy`), which is exactly what
our in-cluster build-time fetch relies on.

**REST API surface (verified against `hyperkitty/urls.py`, master):**

- Lists: `GET /api/lists/`, `GET /api/list/<addr>/`
- Threads: `GET /api/list/<addr>/threads/`,
  `GET /api/list/<addr>/thread/<thread_id>/`
- Emails: `GET /api/list/<addr>/emails/`,
  `GET /api/list/<addr>/email/<message_id_hash>/`,
  `GET /api/list/<addr>/thread/<thread_id>/emails/`,
  `GET /api/sender/<mailman_id>/emails/`
- Tags: `GET /api/tags/`

**Limitations we will hit building a *full* reader (verified against source):**

1. **No search endpoint.** There is no full-text search in the REST API at all.
   HyperKitty's own search is a server-rendered view backed by Whoosh/Xapian, not
   an API route. A headless reader cannot offer search without either scraping
   the HTML archive or standing up our own index over the emails endpoint. This
   is the single biggest headless gap.
2. **No attachments in the API.** The `EmailSerializer` exposes `subject`,
   `date`, `content`, `sender`, `message_id`/`message_id_hash`, thread/parent
   links, likes/dislikes — but attachments are commented out / unimplemented.
   Attachments exist only on the **HTML** archive (a per-message attachment URL),
   so any attachment UX must deep-link into HyperKitty, not render inline.
3. **Pagination is DRF `PageNumberPagination`** (page-number style, default page
   size) — fine, but a full reader must page through `?page=N`, not offset/limit.
   Our reader sidesteps this by capping at `MAX_THREADS = 50`.
4. **Deep links cross the Anubis gate.** Every deep link from `/discuss` into
   `lists.latoolb.us/hyperkitty` lands on the Anubis PoW interstitial before the
   archive renders — an extra JS challenge for a neighbor who just wanted to read
   one message. This is a UX cost that argues for keeping our reader the primary
   surface and minimizing forced hand-offs to HyperKitty.

Net: the headless pattern is sound for **browse + thread-read** (which is what a
community board needs), but the API cannot back **search** or **attachments**
without extra machinery. Those two are the features that would justify ever
sending a user to HyperKitty itself.

## 4. Recommendation (ranked)

Weighing maintenance, upgrade friction against the pinned image, and the
Anubis-gated deep-link UX:

1. **(a) Keep stock-but-minimally-branded HyperKitty as fallback + our `/discuss`
   reader as primary.** RECOMMENDED. Add a small, upgrade-safe override set
   (`headers.html` + `top.html`/`bottom.html` + one linked/inline brand
   stylesheet via `settings_local.py`, no derived image) so that when a user
   *does* cross the Anubis gate into the raw archive it looks like GFTB, not
   default Mailman. This is hours of work, survives image bumps, and needs no
   `collectstatic` if the stylesheet is injected via `headers.html`.
2. **(d) Harden the headless reader.** Do this in parallel with (1), not instead:
   treat `/discuss` as the product, and close the two headless gaps deliberately
   — for **search**, either accept "no in-reader search, deep-link to HyperKitty
   search" or build a tiny local index over `/emails/`; for **attachments**,
   deep-link to HyperKitty. The goal is to almost never *need* the hand-off.
3. **(c) Adopt public-inbox** only if full-text search + durable git-backed
   archive mirroring become first-class requirements. It is the one credible
   alternative, but it is aesthetically wrong for the audience and adds a second
   archive system to run. Park as a *future search backend*, not a UI swap.
4. **(b) Deep-theme HyperKitty.** NOT RECOMMENDED. It duplicates the look our
   reader already delivers, requires a derived image + `collectstatic`/`compress`
   pipeline, and creates a standing upgrade tax against the pinned `web:0.5`
   image — all to polish a surface we are trying to demote to a fallback.

**One-liner:** brand HyperKitty just enough to not look broken on deep-link,
invest in the reader as the real UX, and keep public-inbox in the back pocket
purely as a possible search/mirror backend.

## 5. Open questions for the operator

- Is **search** a required `/discuss` feature? If yes, that is the only fact that
  can move public-inbox from "back pocket" (§4.3) to "adopt."
- Should the Anubis gate exempt the `/hyperkitty/` **read** paths (or serve a
  lighter challenge) so fallback deep-links don't hit a PoW wall? This is an
  infra (`great-falls-tool-bus-infra`) decision, not a UI one, but it changes the
  value of branding HyperKitty at all.
- Where does the minimal HyperKitty override set live and deploy — baked config
  in `great-falls-tool-bus-infra` (list stack) mounted into the pinned image?

## 6. Sources

- HyperKitty install / customization (templates, collectstatic, compress):
  <https://docs.mailman3.org/projects/hyperkitty/en/latest/install.html>
- HyperKitty REST API routes (`urls.py`, master):
  <https://gitlab.com/mailman/hyperkitty/blob/master/hyperkitty/urls.py>
  (GitHub mirror: <https://github.com/hyperkitty/hyperkitty>)
- HyperKitty email/message API serializer (no attachments, fields exposed):
  <https://github.com/hyperkitty/hyperkitty/blob/master/hyperkitty/api/email.py>
- HyperKitty custom-CSS discussion (`additional_stylesheets` block, issue #306):
  <https://gitlab.com/mailman/hyperkitty/-/issues/306>
- `hyperkitty.el` — third-party REST API consumer (headless precedent):
  <https://github.com/maxking/hyperkitty.el>
- docker-mailman web image (`settings_local.py`, `/opt/mailman-web-data`, uwsgi):
  <https://github.com/maxking/docker-mailman/blob/main/web/README.md>
- Django template overriding (precedence):
  <https://docs.djangoproject.com/en/stable/howto/overriding-templates/>
- DebOps HyperKitty configuration role (config-managed theming precedent):
  <https://docs.debops.org/en/master/ansible/roles/mailman/defaults/main/hyperkitty_configuration.html>
- public-inbox — "archives first" overview, protocols:
  <https://public-inbox.org/README.html>
- public-inbox config / watch / Xapian search (v2 = git+SQLite+Xapian):
  <https://public-inbox.org/public-inbox-config.html>,
  <https://public-inbox.org/public-inbox-extindex.html>
- lore.kernel.org / grokmirror mirroring (public-inbox in production):
  <https://korg.docs.kernel.org/lore.html>
- sourcehut lists.sr.ht docs: <https://man.sr.ht/lists.sr.ht/>
- The Mail Archive: <https://www.mail-archive.com/faq.html> · MARC:
  <https://marc.info/>
