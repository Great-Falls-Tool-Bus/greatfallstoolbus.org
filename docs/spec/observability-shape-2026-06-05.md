# Observability Shape (Forward-Looking)

Date: 2026-06-05

Linear: TIN-788 (M5.2). Parent: TIN-734 umbrella.

The launch site ships **zero analytics**. No page-view counter, no event
tracker, no session replay, no third-party script. This document describes
the *shape* observability would take *if/when* the site grows a dynamic
surface that warrants it. It is not an implementation plan.

We don't collect what we don't need.

## Event Taxonomy

If events are ever shipped, they ride a single envelope:

```ts
type OmuxEvent = {
  name: string;             // see list below
  ts: string;               // ISO-8601, server-assigned
  route: string;            // pathname only, no query
  session: string | null;   // opt-in pseudonymous id, never PII
  props?: Record<string, string | number | boolean>;
};
```

Initial event names:

- `page-view` — route + referrer hostname (no full URL).
- `primary-cta-click` — click on the primary launch or contact CTA.
- `contact-link-click` — click on a public mailto or inquiry link.
- `provider-request-submit` — form-action success (only if forms exist).
- `daemon-health-check` — internal-only, never client-emitted; from a
  hypothetical health proxy.

Events are append-only. No update, no delete, no per-user join keys.

## Privacy Posture

- **No PII**: no email, name, account id, or auth token reaches the event
  pipeline. Ever.
- **No IP logging**: edge layer drops the client IP before the event hits
  any persistent store. If the chosen backend logs IPs by default, that
  backend is disqualified.
- **Opt-in only**: a single dismissible banner offers analytics opt-in. The
  default for every visitor is *opted out*. No dark patterns.
- **No cross-site tracking**: no third-party cookies, no fingerprinting,
  no `document.referrer` beyond hostname.
- **Operator-readable**: anything the analytics backend stores must be
  auditable by a single operator running a redacted dump on demand.

This matches the founding-prompt voice on the CLI side ("typed, audited,
redacted-by-default") applied to the website.

## Pluggable Backends

Comparison if a backend is ever picked:

| Backend | Cost | Data residency | Notes |
|---|---|---|---|
| Plausible (cloud) | $9/mo @ 10k events | EU | Cookieless, no PII by design, public dashboard option. Closest fit to privacy posture out of the box. |
| Plausible (self-hosted) | infra-only | self | Same model, full control. Adds ops surface. |
| PostHog (self-hosted) | infra-only | self | Heavier; supports session replay but we'd disable it. Worth it only if product analytics ever expand. |
| Cloudflare Logpush → R2 | $0–5/mo | configurable | Structured logs, no UI; you bring your own dashboard (DuckDB, Grafana). Best fit if events stay sparse. |
| Vendor-cloud telemetry | varies | varies | Disqualified by default; revisit only with explicit ticket. |

Default if forced to choose today: **Cloudflare Logpush → R2**, queried
ad-hoc with DuckDB. Lowest commitment, easiest to delete, no third-party JS
in the page.

## Acceptance

- The launch site (`site.scaffold` at M4) ships zero analytics. Verified by
  inspecting the deployed `index.html` for any third-party `<script>`.
- This document is the *shape*, not the implementation. Implementation
  requires its own ticket, a privacy-policy update, and a CI check that
  fails if a tracker script lands without explicit opt-in plumbing.
- If implementation is ever proposed, it cannot precede a public privacy
  policy on `/privacy`.
