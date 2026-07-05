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

## Add a photo without cloning the repo (keyholder path)

You do not need git installed to add a photo. Every substantive page carries an
**Edit this page** / **View source** affordance in its header (the `SourceLink`
idiom — "This page lives in git. Anyone can propose an edit."). Those links open
GitHub's own web editor, and GitHub's web UI can upload files and open a pull
request for you. A non-developer keyholder can add a photo entirely in the
browser:

1. **Find the gap.** A tool card that still needs a picture shows a
   details-needed cue. In the source it looks like frontmatter with
   `detailsNeeded: true` and `detailsWanted: ['photo']` (see any `.svx` under
   `src/content/tools/`). That flag is the honest placeholder — clearing it is
   exactly this job.
2. **Upload the image file.** On GitHub, open the `static/photos/` folder, click
   **Add file → Upload files**, and drop in your image. Name it with a stable,
   descriptive slug, e.g. `network-kit-open-case.jpg`. Commit to a new branch
   when GitHub offers ("Create a new branch for this commit and start a pull
   request").
3. **Record the credit.** Open `src/lib/data/credits.ts` with **Edit this page**
   (or GitHub's pencil on that file) and add one entry keyed by the manifest key
   — the path under `static/` without the leading slash or extension
   (`photos/network-kit-open-case`). Fill in `src`, `title`, `author`,
   `source` (the exact page you got it from), `license`, `licenseUrl` when one
   exists, and a short `note` recording the year / provenance / why it fits.
4. **Reference it.** On the page or tool where it belongs, use
   `<Picture src="/photos/network-kit-open-case.jpg" alt="…" />` and remove the
   `detailsNeeded` / `detailsWanted: ['photo']` frontmatter now that the gap is
   filled. Resolve the credit with `creditFor(src)` for the caption, as
   `/mission` does.
5. **Open the pull request.** GitHub bundles your commits into a PR. A keyholder
   with merge rights reviews the license and merges. You never touch a terminal.

The renditions (AVIF/WebP + intrinsic dimensions in
`static/image-manifest.json`) are produced automatically by CI on build — you
commit only the original under `static/photos/` and the credits entry.

## Add a photo from a local clone (developer path)

1. Save the original under `static/photos/`, using a stable descriptive name:
   `static/photos/network-kit-open-case.jpg`.
2. Add an entry to `src/lib/data/credits.ts` with:
   source URL, author, license, license URL when available, and a short note.
3. Use `<Picture src="/photos/name.jpg" ... />` in the page or component, and
   clear any `detailsNeeded` / `detailsWanted: ['photo']` frontmatter.
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
