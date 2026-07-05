# Contributing Photos

Photos make the Tool Bus easier to understand, but every committed image must
be public-safe and source-traceable. Use this guide when replacing a
`detailsNeeded: ['photo']` gap or adding a real project/tool photo.

## What is allowed

- **Your own photo**, if you are willing to publish it on this public site.
- **CC0 or public-domain-dedicated media**, such as a Wikimedia Commons file
  with a CC0 license.
- **Public-domain / no-known-restrictions media**, when the source page says so
  and the provenance is recorded.
- **Unsplash Standard License media**, only by manual download and commit.

## What is not allowed

- Hotlinked images from another site.
- Stock photos or "found on the web" images without a named license.
- AI-generated images presented as real tools, places, or people.
- Photos containing private addresses, license plates, children, bystanders, or
  identifying interior-location details unless the operator explicitly approves
  publication.

## Add a photo

1. Save the original under `static/photos/`, using a stable descriptive name:
   `static/photos/network-kit-open-case.jpg`.
2. Add an entry to `src/lib/data/credits.ts` with:
   source URL, author, license, license URL when available, and a short note.
3. Use `<Picture src="/photos/name.jpg" ... />` in the page or component.
4. Run:

   ```sh
   just optimize-images
   just check
   ```

`just build` also runs the optimizer when `static/photos/` contains assets, but
running `just optimize-images` first makes the manifest diff easy to review.

## Source Rules

Every image must have a credit entry, even when attribution is not legally
required. The credit entry is the audit trail. Prefer exact source pages over
search-result pages, and never replace a source URL with a generic homepage.

Unsplash is acceptable only as a downloaded, committed asset. Do not hotlink to
Unsplash CDN URLs; the site should remain static and self-contained.
