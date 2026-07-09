# Vendored ALTCHA widget (`altcha.js`)

Self-hosted proof-of-work widget for the `/contact` form. Static asset, no CDN,
no npm dependency, no build step. Served from `static/`, so it ships to the
browser verbatim at `/vendor/altcha/altcha.js`.

## What it is

`altcha.js` registers the `<altcha-widget>` custom element and implements the
**ALTCHA SHA-256 challenge/response protocol**: it GETs a signed challenge from
the form handler, brute-forces the SHA-256 preimage off the render path (chunked
so the UI never blocks), and exposes the base64 solution via a hidden input, a
`payload` property, and a `verified` / `statechange` / `error` event. The
`/contact` page reads that payload and includes it on its existing JSON POST.

## Pin and provenance

- **Protocol / reference version:** ALTCHA `v3.2.0` (MIT), <https://altcha.org>,
  `github.com/altcha-org/altcha`. Upstream npm tarball
  `altcha-3.2.0.tgz` sha256 `670c191cf0d7e048ac4a37f42841d1473b00166d39597b2e8120eed39aa9b790`.
- **License:** MIT. See `./LICENSE` (upstream copyright reproduced).

## Why a small reimplementation, not the upstream bundle

This mirrors the handler's own doctrine: the server verifies ALTCHA with
hand-written SHA-256 + HMAC in Python stdlib rather than vendoring a wheel, to
keep a zero-supply-chain, auditable surface. The client does the same:

- **Auditable.** One readable file (~11 KB), no minified 80 KB Svelte-compiled
  bundle, no transitive `hash-wasm` dependency.
- **CSP-clean.** No `eval`, no `new Function`, no WebAssembly, no Blob/Worker
  construction, no CDN, and no external runtime fetch beyond the challenge URL.
  Styling is applied via `element.style` from script (not inline `<style>` or
  `style=` attributes). Under a strict Content-Security-Policy the widget needs
  only:

  ```
  script-src 'self';
  connect-src https://forms.latoolb.us;   # the challenge + submit origin
  ```

- **Interoperable.** The wire format (challenge `{algorithm, challenge, salt,
  signature, maxnumber}`, base64 payload `{algorithm, challenge, number, salt,
  signature}`) is byte-identical to the stock `altcha` widget and to the Python
  handler's verify, so the stock upstream bundle can be dropped in later with no
  server change.

The SHA-256 core was validated byte-for-byte against `node:crypto` and Python
`hashlib`, and the full solve was checked end to end against the handler's
`altcha_new_challenge` / `altcha_verify` before vendoring.

## Swapping in the stock upstream bundle (optional, later)

If the full stock widget is ever preferred (audio/visual fallback, i18n), fetch
`altcha@3.2.0`'s `dist/external/altcha.min.js`, drop it in beside this file,
point the `<altcha-widget>` at the same `challengeurl`, and add the CSP
allowances that bundle needs. No handler change is required because the protocol
is the same.
