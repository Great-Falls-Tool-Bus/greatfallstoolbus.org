# Security policy

This repository is the source for the static marketing/devtool site at
<https://greatfallstoolbus.org>. The site itself is purely static — no server
runtime, no user accounts, no inbound data, no analytics.

## Reporting a vulnerability

Until a public security email is published, please report security
issues against this site via a **private GitHub security advisory** on
this repository:

<https://github.com/tinyland-inc/greatfallstoolbus.org/security/advisories/new>

## Scope

In scope for this repository:

- Build / CI supply-chain issues
- Static site content that misrepresents this brand or the Tinyland platform posture
- Secrets accidentally committed to history
- Third-party dep vulnerabilities affecting the build pipeline

Out of scope:

- Cosmetic / SEO / accessibility issues — please open a normal issue
- DDoS / availability — site is on Cloudflare Pages with no privileged
  routes; standard Cloudflare Pages edge availability applies

## What we won't do

- Bug bounties (no programme yet)
- Public discussion of unfixed issues until a coordinated disclosure
  date is agreed
