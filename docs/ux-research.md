# UX research: Great Falls Tool Bus

Groundwork for the next design pass on greatfallstoolbus.org. Grounded in the
live site (`Great-Falls-Tool-Bus/greatfallstoolbus.org`, main, read 2026-07-03)
and public tool-library precedents. No invented data; anything not yet
operator-confirmed on the live site is called out as such, matching the
site's own `OPERATOR-CONFIRM` markers.

Update 2026-07-05: PR #64 added `/find-the-bus` and corrected the location
model. The bus is treated as based at a fixed Lewiston-Auburn location; the
exact spot is shared privately after a request through `/contact`. This document
keeps the original friction notes where useful, but recommendations about public
routes, stops, or hours are no longer the near-term model.

File paths below are routes in the `greatfallstoolbus.org` repo, not this
scaffold repo.

## 1. Personas

### Lewiston neighbor, first-time borrower
- **Goals**: get a specific job done (a sewing repair, a repair with a rented
  drill, a one-off woodworking project) without buying a tool used once.
- **Anxieties**: is this free or a scam, do I need to own a truck or shop
  already, will I be judged for not knowing tool names, is the bus even
  running this week, what if I break something.
- **Site tasks**: find out if the bus has the tool (`/tools`), find out what
  borrowing costs and requires (`/access`, `/safety`), learn that the exact
  bus location is shared privately after contact (`/find-the-bus`), reach a
  human (`/contact`).

### Tool donor
- **Goals**: get a tool that is taking up space into productive use instead
  of a landfill or a resale hassle.
- **Anxieties**: is my tool good enough / too niche, will it be resold for
  cash instead of used communally, do I need to deliver it somewhere, is this
  a tax write-off (it is not, and the site says so).
- **Site tasks**: check donation criteria (`/donate`), see what is actually
  wanted right now (`/wants`), understand the project's legal shape
  (`/donate`, "unincorporated community project"), reach a human (`/contact`).

### Keyholder volunteer (prospective)
- **Goals**: understand what a keyholder actually does before committing,
  find out if this is a big ask (bus custodian) or a small one (answer
  messages sometimes), get plugged into the volunteer structure.
- **Anxieties**: unclear scope of responsibility, liability if a tool is lost
  or someone is hurt on their watch, no visible path from "interested" to
  "onboarded."
- **Site tasks**: find the keyholder role definition (does not exist as its
  own page today — see friction below), find the steward role ladder
  (`/stewards`), find how to volunteer for a specific cell (`/stewards`
  footer, `/cells`), reach a human (`/contact`).

### Partner org (library, school, shop, alderman's office)
- **Goals**: assess legitimacy and fit for a formal or informal partnership
  (co-promoting, donating storage/parking, offering a host relationship), fast.
- **Anxieties**: is this a real, safety-conscious operation or an informal
  experiment that could reflect badly on their org; who is legally
  accountable; is there a single point of contact.
- **Site tasks**: read the mission and credibility signals (`/mission`,
  `/bibliography`, `/shout-outs`), read the safety and conduct posture
  (`/safety`), find the single point of contact (`/contact`, and the
  Coordinator role on `/stewards`).

## 2. Task-flow walkthroughs (current pages)

### Borrow a tool
Path: `/` -> `/tools` -> `/access` -> `/safety` -> `/contact`.

- `src/routes/tools/+page.svelte` presents the catalog as capabilities
  (cells), each with a tool count, how the kit travels, and a safety-gate
  note, then lists individual tools underneath. Good: frames tools by what
  they let you *do*, not just brand/model.
- `src/routes/access/+page.svelte` gives a clean four-step flow (reach out,
  safety orientation, get the privately shared location and a time, use the
  tool).
- **Closed by PR #64**: the site now has `/find-the-bus`, which states the
  fixed-location model and sends visitors to `/contact` for the exact spot and
  access procedure. That matches the current security posture: location is
  private-by-request, not a public stop schedule.
- **Friction**: the safety-orientation gate is per-capability (`/tools`
  line 58-61) but there is no page showing which orientations exist, how
  long they take, or how to schedule one — only that one happens "before
  your first borrow."
- **Friction**: `/access` step 4 says access is free, donations optional,
  but this is flagged `OPERATOR-CONFIRM` (line 56) — a real borrower reading
  the page today cannot be told with certainty this is final.

### Donate a tool
Path: `/` -> `/donate` (or `/wants` -> `/donate`).

- `src/routes/donate/+page.svelte` frames the ask as three yes/no questions
  (travels well, bits marked, repairable/documented) before any logistics —
  a good filter that pre-sorts casual junk from serious donations.
- `src/routes/wants/+page.svelte` pulls from the same content tree as
  `/tools` and `/cell-sheets` (see `src/lib/data/cells.ts` header comment),
  so the wants list cannot drift from the real inventory. Good architecture,
  not just good UX.
- **Friction**: after passing the three-question checklist, there is no
  concrete next step on `/donate` itself (no "here's how to arrange
  drop-off/pickup," no address, no scheduling link) — it ends on a paragraph
  about the project's legal status, and the actual hand-off happens through
  `/contact`, one more click and one more context switch away.
- **Friction**: no photo or example of what "kitted and marked" looks like
  in practice for a donor unfamiliar with the standard, only prose criteria.

### Become a keyholder
Path: unclear — this is the biggest gap found.

- There is no `/become-a-keyholder` or equivalent page. "Keyholder" is used
  throughout the site (`/`, `/access`, `/safety`, `/cell-sheets`,
  `/cells/sewing`) as the ambient term for "the humans who answer requests
  and share the bus location," but the only defined volunteer role ladder is
  on `src/routes/stewards/+page.svelte` (Coordinator, cell captains/shop
  leads, Safety steward) — a different taxonomy than "keyholder."
- **Friction**: `/stewards` line 66-68 invites "want to steward a cell?
  reach out," but a visitor cannot tell from the site whether "keyholder"
  and "cell captain" are the same commitment, different ones, or how
  "keyholder" maps onto the three defined roles at all.
- **Friction**: `/stewards` is intentionally excluded from primary nav (see
  `src/lib/nav-items.ts` lines 17-21, a documented lane-A decision) and is
  not linked from the home page's page-grid (`src/routes/+page.svelte`
  lines 27-44) — a motivated volunteer has to find it via a footer link on
  another page or search.
- **Friction**: the roster is explicitly empty (`/stewards` line 50-58,
  "Roster pending — operator to populate") — a partner org or volunteer
  cannot see who is currently doing this work, only that the seats exist.

### Join the list
Path: `/contact`.

- `src/routes/contact/+page.svelte` is honest about current state: the
  contact form is a mailto hand-off pending a bot-guarded endpoint
  (`endpointLive` flag, lines 2-9), and the three list addresses
  (`keyholders-join@`, `keyholders@`, `keyholders-owner@latoolb.us`) are
  shown with a note that they activate "once the list runtime lands"
  (lines 23-39). Mail-client setup notes (lines 41-62) are a thoughtful
  touch for a non-technical audience.
- **Friction**: a visitor who wants to "join the list" today has one real
  action — send an empty email to `keyholders-join@latoolb.us` — but the
  page does not visually distinguish "do this now" from "this exists but
  isn't live yet" beyond a small badge ("Endpoint live" / "Mail draft
  hand-off") that only covers the contact form, not the list addresses
  themselves. All three list rows read with equal visual weight regardless
  of whether they work today.
- **Friction**: no confirmation of what happens after joining (what kind of
  mail to expect, how often, how to leave the list) — reasonable for
  privacy-conscious neighbors and multilingual households to want to know
  before subscribing.

## 3. Usability checklist for the next design pass

- [x] Add a request-first bus location surface — `/find-the-bus` now explains
  that the bus is based at a fixed location and that keyholders share the exact
  spot after a request through `/contact`.
- [ ] Reconcile "keyholder" and the `/stewards` role ladder into one
  vocabulary, or explicitly map them, so a volunteer knows which role they
  are actually signing up for.
- [ ] Give `/donate` a concrete closing action (contact link inline, not
  only reachable by leaving the page) right after the three-question
  checklist.
- [ ] Surface `/stewards` in primary nav or at least link it from the home
  page grid — it currently reads as orphaned relative to its importance for
  the keyholder/volunteer persona.
- [ ] Add a per-orientation index (what orientations exist, roughly how
  long, how to book one) so "safety orientation" stops being an opaque
  gate mentioned on four different pages.
- [ ] On `/contact`, visually separate "works today" (mailto form) from
  "described but not yet live" (list addresses) beyond a single badge —
  three equally-weighted rows currently invite someone to email an address
  that may not do anything yet.
- [ ] Resolve the `OPERATOR-CONFIRM` markers on `/access` (free-after-
  orientation, donations-optional) and `/tools` (per-capability safety
  gate) before treating those flows as final in design work — they are
  currently recommended defaults, not confirmed policy.
- [ ] Add a photo or worked example of "kitted and marked" tools to
  `/donate` — current guidance is text-only criteria.
- [ ] Add a short "what to expect after you join" note near the list
  addresses on `/contact`.

## 4. Tool-library UX patterns worth stealing

**Inventory browsing** — Toronto Tool Library and other myTurn-platform
libraries (Minnesota Tool Library, Tacoma Tool Library) expose a live,
searchable `inventory/browse` view with per-tool availability and a direct
reserve action; myTurn's own material describes click-to-reserve with a
chosen pickup date. The tool bus's static capability catalog (`/tools`)
is a reasonable v1 given no live inventory system, but the reserve-by-date
pattern is the clear next step once there is real availability data to show.
(Toronto Tool Library, https://torontotoollibrary.com/ ; myTurn,
https://myturn.com/library-of-things/ — both already cited in the site's own
`/bibliography`.)

**Deposit/loan policy presentation** — Station North Tool Library's
membership page states its sliding-scale formula with a worked example
("$50,000 income = start at $50"), separates Cost/Benefits/Action into
distinct labeled sections with visual dividers, and states plainly "we will
never turn away a member for inability to pay." Berkeley's Tool Lending
Library, by contrast, defers loan periods and fines to a separate linked
page rather than showing them inline — a pattern that creates friction for
a first-time visitor. The tool bus should follow Station North's inline,
worked-example approach once (if) any deposit or fee policy is adopted,
and should keep policy statements inline rather than one click removed, per
Berkeley's negative example. (Station North, https://toollibrary.org/
membership ; Berkeley Public Library, https://www.berkeleypubliclibrary.org/
locations/tool-lending-library — both already cited in the site's own
`/bibliography`.)

**Hours/location for a mobile service** — public bookmobile programs
(Mobile Public Libraries, Santa Clara County, Kansas City) publish a schedule of
stops, note that stops are subject to change, and advise calling ahead to
confirm. That is a useful future pattern if the Tool Bus adopts a public route,
but it is not the current model: `/find-the-bus` is intentionally request-first
for a fixed location. (Mobile Public Libraries,
https://www.mobilepubliclibrary.org/locations-hours/bookmobile-outreach.)

**Multilingual note (Lewiston's Somali and French-speaking communities)** —
Lewiston's school population is documented as multilingual across English,
Somali, Portuguese, Arabic, and French (Sun Journal, "25 years later,
Lewiston's Somali residents help shape the city's identity," 2026), and
local navigation services (Somali Bantu Community Association of Maine)
already serve residents in Somali and Maay Maay with French and Swahili as
stated growth targets. The tool bus site is English-only today with no
language switcher or translated summary anywhere in the routes reviewed.
Given the borrower and donor personas draw directly from this population,
even a translated one-paragraph summary of "how access works" in Somali and
French — the two languages most explicitly tied to Lewiston-Auburn in
public reporting — would remove a real barrier the current design does not
address. Any expansion should be led by community members fluent in the
target languages rather than machine translation alone, and should be
confirmed against current, not two-decade-old, community language data
before shipping.

## 5. Research questions only real users can answer

For the interest-form / first-orientation cohort (the first people to
actually go through `/access` end to end):

- When you first reached out, what made you unsure whether this was legit
  or safe to try?
- Between reading `/tools`, `/access`, and `/safety` and actually getting a
  reply from a keyholder, where did you lose confidence or almost give up?
- Did you understand what "safety orientation" would involve before you
  showed up for one? What did you expect versus what happened?
- How did you find out the exact bus location and time? Did the request-first
  handoff feel clear and safe, or did it feel like missing information?
- If your first language is not English, what would have made the site
  easier to use, and at what point in the process (browsing, contacting,
  orientation) would translation have mattered most?
- For donors: what made you trust that your tool would be used communally
  rather than resold or wasted? What, if anything, would you want to see
  after handing it off (a photo, a confirmation, a note on `/tools`)?
- For prospective keyholders/cell captains: before you asked, did you know
  what the role actually required day to day? What would you have wanted to
  read on the site before reaching out?
- For partner orgs: what convinced you (or would have convinced you) this
  was a credible, safety-conscious operation worth attaching your name to?

## Sources

- Toronto Tool Library — https://torontotoollibrary.com/ and
  https://torontoeast.myturn.com/library/inventory/browse
- myTurn / Local Tools — https://myturn.com/library-of-things/ ,
  https://localtools.org/
- Artisan's Asylum — https://www.artisansasylum.com/individual-memberships ,
  https://wiki.artisansasylum.com/index.php/New_Member_Guide
- Station North Tool Library — https://toollibrary.org/membership
  (also cited in this repo's counterpart site's `/bibliography` route)
- Berkeley Public Library Tool Lending Library —
  https://www.berkeleypubliclibrary.org/locations/tool-lending-library
- Mobile Public Libraries (bookmobile/outreach) —
  https://www.mobilepubliclibrary.org/locations-hours/bookmobile-outreach
- "25 years later, Lewiston's Somali residents help shape the city's
  identity," Sun Journal, 2026 —
  https://www.sunjournal.com/2026/03/26/25-years-later-lewistons-somali-residents-help-shape-the-citys-identity/
- Somali Bantu Community Association of Maine, Client Navigation Services —
  https://somalibantumaine.org/services-programs/client-navigation-services/
