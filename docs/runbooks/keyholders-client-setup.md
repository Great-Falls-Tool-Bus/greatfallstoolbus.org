# keyholders@latoolb.us — client setup (DRAFT accordion content)

> **DRAFT — the list does not exist yet.** This page is pre-written accordion
> content for the site's join page, staged while the blahaj-side Mailman 3 /
> Postorius / HyperKitty deployment (pinned trio 3.3.10 / 1.3.13 / 1.3.12,
> TIN-2360 row e) is still being staged. Every address and URL below follows
> the **generic Mailman 3 pattern** and must be re-verified against the real
> deployment before this content ships on the public site. Do not publish
> until the list exists and a round-trip test has passed.

Each `##` section below is one accordion panel. Member panels first, owner
panels last.

---

## How the list works (read this first)

- The list address is `keyholders@latoolb.us`. Mail you send there goes to
  every subscribed member.
- The archive is **public** (HyperKitty): anyone can read past threads
  without subscribing, at the archive URL the deployment publishes.
- Mailman 3 uses service addresses derived from the list name:
  - subscribe: `keyholders-join@latoolb.us`
  - unsubscribe: `keyholders-leave@latoolb.us`
  - reach the humans running the list: `keyholders-owner@latoolb.us`
- You do not need a special app. Any mail client works; the panels below
  are just per-client convenience.

## Join or leave by email (any client)

1. Send an empty email to `keyholders-join@latoolb.us` (subject and body
   are ignored).
2. Mailman replies with a confirmation request. **Reply to it** (again,
   content is ignored) to confirm you own the address.
3. You will get a welcome message; you are subscribed.

Leaving is symmetric: email `keyholders-leave@latoolb.us` and reply to the
confirmation.

## Join via the web (Postorius)

1. Open the list's Postorius page (linked from the join page once the list
   exists), choose **Subscribe**, enter your address.
2. Confirm via the email Mailman sends you.
3. In **Subscription preferences** you can switch to **digest mode**
   (bundled periodic mail instead of every message) or suspend delivery
   without leaving the list.

## Gmail

Works out of the box — subscribe with your Gmail address using either flow
above. Quality-of-life setup:

- **Label the list**: Settings gear -> **See all settings** -> **Filters
  and Blocked Addresses** -> **Create a new filter** -> in *To*, enter
  `keyholders@latoolb.us` -> **Create filter** -> *Apply the label*
  `keyholders` (create it), optionally *Skip the Inbox*.
- **Reply to the list, not the sender**: use **Reply all** and trim the
  recipients, or check the `To:`/`Cc:` line before sending — Gmail has no
  reply-to-list button.
- Gmail collapses long threads and clips very long messages ("View entire
  message"); the public HyperKitty archive is often the more readable view
  of a long thread.
- If list mail lands in Spam at first, open one message -> **Not spam**;
  the filter above plus "Never send it to Spam" fixes it permanently.

## Thunderbird

Thunderbird is mailing-list aware:

- On a message from the list, Thunderbird shows a **Reply List** button —
  prefer it over Reply/Reply All; it addresses `keyholders@latoolb.us`
  only (it reads the `List-Post` header Mailman sets).
- **Filter into a folder**: Tools -> **Message Filters** -> New — match
  the header `List-Id` *contains* `keyholders` -> *Move to folder*.
  Filtering on `List-Id` survives address changes and catches service
  notifications too.
- Threading: View -> Sort by -> **Threaded** makes long list discussions
  readable.

## Geary

Geary is deliberately minimal:

- Subscribe by email or via Postorius (flows above); reading and writing
  list mail needs no Geary configuration.
- Geary has **no reply-to-list button and no local filters**. Check the
  `To:` line by hand when replying, and create any sorting rules
  **server-side** (e.g. in your provider's webmail rules, or via Sieve if
  your mail host supports it) — Geary will then show the sorted folder.

## KMail

KMail has first-class mailing-list support:

- Select any message from the list, then **Folder -> Mailing List
  Management** -> **Detect Automatically**. KMail reads the `List-Post` /
  `List-Id` headers and wires up **Reply to Mailing-List** and **Post to
  Mailing-List** actions for that folder.
- **Filter into a folder**: Settings -> **Configure Filters** -> New —
  condition `List-Id` *contains* `keyholders`, action *Move into folder*.
- The message structure viewer shows the full `List-*` headers if you want
  to confirm what the list engine is doing.

## Owners & moderators (Postorius)

> Applies only to the people listed as owner/moderator of the list.

- Log in to Postorius with the account the deploying operator provisions
  for you; the list appears under **Lists you own**.
- **Held messages**: Postorius -> the list -> **Held messages** — approve,
  reject, or discard. Mailman also emails moderators when something is
  held.
- **Members**: the **Members** tab manages subscriptions, moderation flags
  (per-member "hold posts"), and bans.
- **Settings worth reviewing before announcement** (they default
  reasonably in Mailman 3, but check): archive visibility (public — row e
  says the HyperKitty archive is public), who may post
  (members/moderated/anyone), subscription policy (confirm vs
  confirm-then-moderate), and the welcome message text.
- Mail sent to `keyholders-owner@latoolb.us` reaches all owners without
  going through the list.

---

*Draft authored 2026-07-02 as TIN-2360 rows (c)/(d) prep (tracked with
TIN-2366). Re-verify every address, URL, and Postorius label against the
real blahaj-side deployment before publishing.*
