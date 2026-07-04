# Runbook: greatfallstoolbus.org Cloudflare Pages rollback

Two-level rollback for the apex/`www` production surface of greatfallstoolbus.org
(TIN-2401). This is the explicit rollback path the CD audit flagged as missing.

It deliberately mirrors the **two-level** model in
transscendsurvival.org's `docs/runbooks/dns-cutover-and-rollback.md`
("ROLLBACK: revert apex serving" as the cheap application-level path, and a
separate heavier authority/serving-substrate revert). The two levels here are:

- **Fast path**: roll the Cloudflare Pages _deployment_ back to a prior
  known-good build. Same origin, same DNS, same gate. Minutes.
- **Full path**: move the serving _substrate_ off Cloudflare Pages back to
  GitHub Pages (re-point `var.pages_host`, restore the GH-Pages workflow, re-enable
  GitHub Pages). Larger blast radius; use only when Cloudflare Pages itself is the
  problem.

## Current verified posture (2026-07-03)

- **Registrar / DNS authority:** Cloudflare. The `.org` parent delegates the zone
  to `austin.ns.cloudflare.com` + `oaklyn.ns.cloudflare.com` (asserted by
  `.github/workflows/cloudflare-dns-drift.yml`).
- **Serving:** Cloudflare Pages project `greatfallstoolbus-org`
  (`greatfallstoolbus-org.pages.dev`). apex + `www` are **proxied CNAMEs** to that
  Pages host, declared in `great-falls-tool-bus-infra` `tofu/stacks/edge`
  (`cloudflare_dns_record.web_apex` / `web_www`, `content = var.pages_host`).
- **Access gate:** apex, `www`, and the `*.pages.dev` origin are ALL served behind
  Cloudflare Access (`cloudflare_zero_trust_access_application.web_apex` /
  `web_www` / `pages_dev`). An unauthenticated request returns
  `302 -> <team>.cloudflareaccess.com/cdn-cgi/access/login/...`. That 302 is the
  health signal, see `.github/workflows/production-health.yml`.
- **Rollback publisher of record:** GitHub Pages at
  `great-falls-tool-bus.github.io` remains the substrate-level fallback. The infra
  `var.pages_host` default and `var.alias_redirect_target`
  (`https://great-falls-tool-bus.github.io/greatfallstoolbus.org/`) both encode
  that GitHub Pages host as the known-good origin.

```text
Cloudflare Registrar        Cloudflare DNS (current)          Cloudflare Pages
  NS -> austin/oaklyn  -->  proxied apex + www CNAMEs    -->  greatfallstoolbus-org
                            (Access-gated)                     (immutable deploys)

Substrate fallback (full path only):
  var.pages_host -> great-falls-tool-bus.github.io  (GitHub Pages)
```

## Which level do I use?

| Symptom | Path |
| ------- | ---- |
| A bad build shipped (broken page, wrong content, regression) but the Pages project/edge/gate are healthy | **Fast path**: promote a prior Pages deployment |
| `production-health.yml` fails (no `302` to `cloudflareaccess.com`) but DNS delegation is intact and the Pages dashboard shows the project healthy | Investigate the Access app first; if the Pages origin itself is down, escalate toward **Full path** |
| Cloudflare Pages is the failure mode: project build pipeline broken, Pages origin returning 5xx behind the gate, account/project lockout, AND GitHub Pages is healthy | **Full path**: move the substrate back to GitHub Pages |
| `cloudflare-dns-drift.yml` fails on **NS** drift | Neither: this is a registrar/delegation incident, not a Pages rollback. Fix the delegation. |

Default to the **fast path**. It is immutable-deployment promotion, no DNS
change, no gate change, instantly reversible. Only reach for the full path when
Cloudflare Pages as a serving substrate is the thing that is broken, exactly as
transscend's runbook warns not to revert the heavier layer for an
application-level regression ("Do **not** revert NS for an application-level Pages
issue").

## Fast path: promote a prior Cloudflare Pages deployment

Cloudflare Pages deployments are **immutable**: every build is retained and
addressable, so "rollback" is really "re-promote a known-good deployment to
production." DNS, the custom domains, and the Access gate are untouched, only
which immutable build the production alias points at changes.

**Dashboard (preferred, fastest):**

1. Cloudflare dashboard -> **Workers & Pages** -> `greatfallstoolbus-org` ->
   **Deployments**.
2. Find the last known-good production deployment (the last green one before the
   regression; commit SHA is shown).
3. Use its **⋯ menu -> Rollback to this deployment** (a.k.a. "Retry/Manage
   deployment" -> promote to production). Confirm.
4. Verify (the gate makes this a 302 assertion, not a 200):

   ```sh
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://greatfallstoolbus.org/
   # expect: 302 https://<team>.cloudflareaccess.com/cdn-cgi/access/login/greatfallstoolbus.org...
   ```

   Then re-run `.github/workflows/production-health.yml` (workflow_dispatch) and
   confirm it is green.

**API (when the dashboard is unavailable):** use a short-lived, least-privilege
token with **Account -> Cloudflare Pages: Edit** for this project only (never a
Global API Key, same auth rule as transscend's runbook). The account id is read
off the zone lookup and never committed.

```sh
# List deployments, newest first; pick the known-good deployment id.
curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/greatfallstoolbus-org/deployments"

# Promote (re-deploy) the known-good deployment to production.
curl -sS -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/greatfallstoolbus-org/deployments/${GOOD_DEPLOYMENT_ID}/rollback"
```

Log only endpoint paths, status codes, deployment ids, and Cloudflare Ray IDs.
Never log the token value.

**Root-cause the bad build in git** afterward: the regression came from `main`.
Revert or fix-forward the offending commit so the next deploy does not re-ship it.

## Full path: move the serving substrate back to GitHub Pages

Use this only when Cloudflare Pages is the failure mode and GitHub Pages
(`great-falls-tool-bus.github.io`) is healthy. This is heavier: it changes the
origin the proxied apex/`www` CNAMEs resolve to, and it re-activates a second
publisher. It is the substrate-level analogue of transscend's "revert apex serving
to GitHub Pages" section.

1. **Re-point `var.pages_host` in the edge stack.** In
   `great-falls-tool-bus-infra` `tofu/stacks/edge`, set `pages_host` back to the
   GitHub Pages host:

   ```hcl
   # tofu/stacks/edge (tfvars or -var at apply)
   pages_host = "great-falls-tool-bus.github.io"
   ```

   The apex/`www` records stay **proxied CNAMEs**; only their `content` (origin)
   changes. Apply through the normal infra review/plan/apply loop, do not
   hand-edit the Cloudflare dashboard out of band (keep IaC and live in lockstep,
   same discipline as transscend's "change DNS via IaC, not the dashboard").

   > Gotcha (from transscend's HARD RULE): never point a proxied production
   > hostname at an origin that is not yet serving that hostname. GitHub Pages must
   > already have the custom domain (`static/CNAME` / project-path) active and
   > serving BEFORE the CNAME content is flipped, or the proxied edge will front a
   > dead origin.

2. **Restore the GitHub Pages deploy workflow from git history.** The scaffold's
   default `deploy-pages.yml` (adapter-static -> `upload-pages-artifact` ->
   `deploy-pages`) is the fallback publisher. If it was removed/replaced during
   the Cloudflare Pages cutover, restore it:

   ```sh
   # Find the last commit that still had the GitHub Pages workflow.
   git log --oneline -- .github/workflows/deploy-pages.yml
   git checkout <good-sha> -- .github/workflows/deploy-pages.yml
   # Review, then commit on a branch and open a PR (main is hook-protected).
   ```

3. **Re-enable GitHub Pages** for the repo: Settings -> Pages -> Build and
   deployment -> Source = **GitHub Actions**, and confirm the environment
   `github-pages` is present. Push a commit / dispatch `deploy-pages.yml` so a
   fresh artifact deploys, and confirm the run is green.

4. **Verify end-to-end.** The origin is now GitHub Pages but the apex/`www` are
   still Access-gated at the Cloudflare edge, so the public assertion is still the
   302:

   ```sh
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://greatfallstoolbus.org/
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.greatfallstoolbus.org/
   # both expect: 302 -> <team>.cloudflareaccess.com/cdn-cgi/access/login/...
   ```

   Re-run `production-health.yml` and `cloudflare-dns-drift.yml`; both must be
   green. NS delegation is unchanged by this path, so drift should stay clean.

5. **Recovery / going back to Cloudflare Pages.** Once Cloudflare Pages is healthy,
   reverse step 1 (`pages_host = "greatfallstoolbus-org.pages.dev"`) through the
   same infra plan/apply loop. Leave the restored `deploy-pages.yml` in place as
   the standing fallback publisher.

## Do NOT (guardrails)

- Do **not** touch **NS** delegation for a Pages or application regression. NS is
  the registrar/authority layer; a Pages bad build or a gated-origin 5xx is not an
  NS problem. (Transscend: "Do not revert NS for an application-level Pages
  issue.")
- Do **not** remove the Access gate to "make the health check pass." The gate is
  the intended posture; the `302` is health. Silently un-gating turns the probe
  green while exposing a surface that is meant to be gated.
- Do **not** hold long-lived Cloudflare credentials in this repo. DNS / Access /
  Pages are owned by the `great-falls-tool-bus-infra` overlay; use short-lived,
  least-privilege, project-scoped tokens for any manual API rollback and revoke
  them after.
- Do **not** hand-edit the Cloudflare dashboard for the `full path` DNS change.
  Route it through the infra `var.pages_host` change so IaC and the live zone stay
  in lockstep.

## Related surfaces

- `.github/workflows/production-health.yml`, the gate-302 health probe (TIN-2401).
- `.github/workflows/cloudflare-dns-drift.yml`, dig-only NS + resolution drift
  guard (TIN-2401).
- `great-falls-tool-bus-infra` `tofu/stacks/edge`, the authoritative DNS + Access
  + `var.pages_host` definitions.
- `docs/deploy/cloudflare-pages.md`, the CF-Pages opt-in deploy lane.
- Precedent: transscendsurvival.org `docs/runbooks/dns-cutover-and-rollback.md`
  (the two-level rollback model this runbook mirrors).
