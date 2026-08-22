# Tailnet preview lane

An operator-run, single-host preview for the member-v0 web/worker/Postgres
stack, fronted by `tailscale serve` (tailnet-identity-gated HTTPS — never
`tailscale funnel`, never public).

## Status: interim

This is the **interim** preview lane (operator ratification, 2026-08-21,
sitting-3 Q1: "Tailnet now, staging as the target"). The **ratified target**
is `staging.greatfallstoolbus.org` with promote-on-PR, once the infra apply
sitting lands (`great-falls-tool-bus-infra`). This lane exists so the S4-S7
member-v0 routes (application intake, keyholder review, assent/activation,
contribution offer) have something runnable against real Postgres + RLS in
the meantime — it is not meant to outlive that sitting.

## Up / down

```bash
just preview-tailnet        # one command: PG + migrations + web + worker + tailscale serve
just preview-tailnet-down   # tear it all down
```

The first run prints instructions (and a ready-to-paste `psql` command) for
seeding a minimal tenant + keyholder grant — there is no committed seed
script in this repo yet, so the recipe does not invent one silently. Export
`GFTB_TENANT_ID` after seeding and re-run; the worker only dispatches once a
real tenant exists (it self-probes on startup and exits rather than idling
against a nonexistent tenant).

`just preview-tailnet` is re-runnable: it kills its own stale web/worker
processes and restarts, but keeps the same on-disk Postgres cluster between
runs, so a seeded tenant survives a rebuild-and-relaunch. `just
preview-tailnet-down` is what actually deletes the cluster.

## What it is

- A throwaway local PostgreSQL 16 cluster (`nix-shell -p postgresql_16`;
  `initdb` + `pg_ctl` under a tempdir), with the same migrator/`gftb_app`
  runtime-role split the integration suite's external-server fixture uses
  (`src/lib/server/db/integration-support.ts`) — so this preview exercises
  the real RLS policies, not a superuser bypassing them.
- The checked-in migrations applied through the real applier
  (`src/lib/server/db/migrate.ts`, same as `just db-migrate`).
- The adapter-node web server via `server.js` (not adapter-node's generated
  `build/index.js` directly — `server.js` carries the TIN-3959
  Cache-Control/ETag fix that `build/index.js` alone lacks).
- The outbox worker (`src/lib/server/worker.ts`), run the same source-level
  way `just db-migrate` runs the migrator.
- `tailscale serve --https=8443 http://127.0.0.1:8443` in front of it —
  `serve`, never `funnel`. Tailnet identity is the entire access-control
  story.

## Security point

Every process this lane starts binds **loopback only**
(`127.0.0.1`/`listen_addresses=127.0.0.1` for Postgres, `HOST=127.0.0.1` for
the web server). The single network exposure is `tailscale serve`'s HTTPS
endpoint, reachable only to devices on the operator's tailnet. Nothing here
opens a port to the public internet. `just preview-tailnet` also refuses to
start if `:8443` already carries an unrelated `tailscale serve` handler,
rather than silently overwriting it — check `tailscale serve status` if you
hit that refusal.

Postgres runs with `--auth=trust`: the generated `gftb_migrator`/`gftb_app`
role passwords buy **no local isolation** on this cluster (any local user
can connect to `127.0.0.1:55446` as `postgres` and bypass RLS entirely).
That is an acceptable trade because Postgres itself never leaves loopback —
the role split's real, correctly-scoped job is only to make the `web` and
`worker` processes themselves run as `gftb_app`, so the RLS policies the
migrations ship actually bind them. The printed seed command connects with
no password in it, for the same reason: trust auth doesn't check one, so
nothing credential-shaped needs to appear in your terminal scrollback.

Both recipes kill web/worker by whole **process group**, not by trusting a
bare pidfile pid: `pnpm exec tsx <file>` is several processes deep, and an
earlier revision of this lane's teardown left the real worker process
orphaned and reparented to PID 1 (found by adversarial review). The pidfile
pgid is validated against the launched command before being trusted, and a
`pgrep -f` pass backstops it regardless of pidfile state — but a marker
substring match alone is not enough to kill something on: an earlier
revision's backstop `kill -9`'d an innocent `tail -f server.js` process
because its argv happened to contain the marker. Every backstop candidate
is now re-validated against the actual launched command shape (`node
<path>` for web; `tsx`+`worker.ts`+the marker for worker) before it is
killed, not just matched by `pgrep -f`.

## Honest limits

- **Single host.** One operator, one machine, one running preview at a time
  — fixed ports (`8443` for web/tailscale-serve, `55446` for Postgres), no
  concurrency handling. State lives under `${TMPDIR:-/tmp}`; on this
  project's macOS operator hosts `TMPDIR` is per-user private, but the
  `/tmp` fallback is a predictable, shared path on other OSes, so the
  recipe refuses outright if its Postgres data directory or state directory
  is ever a symlink rather than a plain directory.
- **Serializes PRs.** Two branches cannot be previewed simultaneously on the
  same host; switch branches, rebuild, relaunch.
- **No tunnel/Access parity with production.** Production sits behind
  Cloudflare Access on the shared honey-ingress tunnel
  (`docs/deploy/oncluster-container-readiness.md`); this lane's access
  control is tailnet membership only, via `tailscale serve`.
- **No real-Postgres-fleet parity, and no production Postgres cluster exists
  yet to have parity with.** This is a local, single-node, trust-auth
  Postgres 16.14 (whatever `nixpkgs` currently pins). It is not the
  CNPG-managed cluster production will run against once the infra apply
  sitting lands (TIN-3817, infra PR #118, unmerged, blocked on an
  object-store ruling) — there is no such cluster live today; production is
  currently a DB-less `adapter-node` image
  (`docs/deploy/oncluster-container-readiness.md`). 16.15 is the version the
  integration test suite's testcontainer pins to
  (`src/lib/server/db/integration-support.ts`) — a target for that future
  cluster, not a running one. This lane proves the SQL and the RLS policies
  against a real Postgres; it proves nothing about cluster behavior
  (failover, backups, connection pooling) because no such cluster exists to
  compare against.
- **Cookie note:** `src/lib/server/auth/session.ts` documents that the
  session cookie carries `HttpOnly`/`Secure`/`SameSite` attributes "set at
  write time" — but no write site exists in this tree yet (`grep -rn
  "cookies.set(" src/` returns nothing), so there is no live cookie behavior
  in this lane, or in production, to evaluate today. When that write path
  lands: `tailscale serve` terminates real HTTPS with a valid tailnet
  certificate, so a `Secure` cookie set over it will work the same way it
  will in production; it would not work over a direct, unproxied
  `http://127.0.0.1:8443` request.
- **Building the preview poisons `just check`.** Like `just build`, an
  `ADAPTER=node` build populates `.svelte-kit/` in a way `just check`'s
  gitleaks pass then flags. Run `just check` before `just preview-tailnet`,
  not after, in the same working tree.
- **Not the CI-driven per-PR tailnet lanes.** `docs/CI-SCHEMA.md` describes a
  separate mechanism — Blahaj-provisioned, per-PR, cluster-side environments
  joined to the tailnet by CI (`lane-env.yml` → Blahaj → `tailnet-qa`). This
  recipe is unrelated to that: it is a same-host, operator-run alternative
  for local iteration, not a CI-driven ephemeral environment.

## Debt closed alongside this lane

`.github/workflows/lane-env.yml` was deleted: it still declared
`spoke: site-scaffold` (never rebranded to match `.github/lanes.json`'s
`"name": "greatfallstoolbus"`), called `ci-templates`'
`spoke-lane-env.yml@v2.10.0` — deprecated 2026-08-05 with no receiver behind
it (the Blahaj receiver was evicted) — and shipped `enable_tailnet_qa:
false`. Nothing else in this repo referenced the file (confirmed by grep
across `.github/`, `docs/`, and `.github/lanes.json` before deletion); the
generic "lane-env" mentions remaining in `docs/CI-SCHEMA.md` and
`docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md` describe
the shared scaffold-contract mechanism other spokes still use, not this
file.
