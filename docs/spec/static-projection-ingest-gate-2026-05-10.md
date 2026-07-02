# Static Projection Ingest Gate - 2026-05-10

Linear: `TIN-1028`, `TIN-1024`, `TIN-731`

`site.scaffold` provides the house static-site ingestion gate for reviewed
Tinyland snapshots. This spec covers the checked-in snapshot mode only. The gate
exists so generated sister sites can consume Tinyland hub projections without
becoming brokers, mutation APIs, checkout owners, media authorities, or
ActivityPub delivery workers.

Runtime broker-display spokes are covered separately in
[`runtime-broker-display-2026-05-19.md`](./runtime-broker-display-2026-05-19.md).
They are still read-only static spokes, but they fetch reviewed public content
from the Tinyland broker at browser runtime instead of committing content
payloads into the spoke repo.

## Commands

```bash
just validate-static-projection path/to/public-snapshot.v1.json
just sync-static-projection https://tinyland.dev/projections/<spoke>/public-snapshot.v1.json path/to/public-snapshot.v1.json
just pulse-ingest https://tinyland.dev/projections/<spoke>/pulse/public-snapshot.v1.json static/data/pulse/public-snapshot.v1.json
```

`sync-static-projection` and `pulse-ingest` validate before writing. Remote
sources must be HTTPS URLs without credentials, query parameters, or fragments.
Targets must be local checked-in JSON files.

The commands accept optional spoke-target and actor-document checks:

```bash
just sync-static-projection \
  https://tinyland.dev/projections/software-tinyland-dev/public-snapshot.v1.json \
  src/lib/data/public-snapshot.v1.json \
  software.tinyland.dev \
  https://tinyland.dev/ap/actors/brand/software-tinyland-dev
```

Actor document validation confirms the expected Tinyland brand actor and
published public key are present before a static spoke accepts a refreshed
snapshot. Passing `--require-signature` additionally requires an HTTPS source
response with a valid Tinyland HTTP Signature over the fetched snapshot body.

## Workflow

`.github/workflows/pulse-ingest.yml` is the propagatable automation layer for
generated sister sites. It runs on schedule and `workflow_dispatch`, validates a
reviewed Tinyland snapshot, runs `just check`, and opens a PR with the changed
checked-in JSON file. The scaffold repo skips scheduled runs because it is the
template, not a live spoke; propagated repos can rely on default repo-name
slugging or set these repository variables:

- `TINYLAND_PROJECTION_SPOKE_SLUG`
- `TINYLAND_PROJECTION_SPOKE_TARGET`
- `TINYLAND_PROJECTION_SOURCE_URL`
- `TINYLAND_PROJECTION_TARGET_PATH`
- `TINYLAND_PROJECTION_ACTOR_URL`
- `TINYLAND_PROJECTION_REQUIRE_SIGNATURE`

## Validated Shapes

`tinyland.static-spoke.snapshot.v1`:

- `sourceAuthority`;
- `sourceAuthorityUrl`;
- `contentHash`;
- `itemCount`;
- `projectionKind`;
- `spokeTarget`;
- `routePath`;
- `publicSnapshotUrl`;
- no secret-shaped public fields;
- no ActivityPub status that claims public federation launch.

`tinyland.pulse.v1.PublicPulseSnapshot`:

- manifest schema version;
- manifest content hash over canonical public `items`;
- manifest item count;
- M1 public kinds only: `note` and `bird_sighting`;
- no exact location, storage-key, credential, or private-media fields.

## Boundaries

Allowed:

- checked-in static JSON snapshots;
- optional Tinyland HTTP Signature verification for remote HTTPS snapshots;
- reviewed Tinyland post, product, service, event, profile, or Pulse
  projections;
- build-time validation and deterministic copy into generated sister-site repos.

Blocked:

- sister-site mutation APIs;
- auth or payment secret custody;
- checkout sessions, webhooks, settlement, or marketplace automation;
- ActivityPub delivery, inbox, follower, retry, tombstone, or moderation claims.

Out of scope for this static-ingest spec:

- browser or edge runtime fetches from a live broker.

Public Fediverse federation remains a Tinyland broker responsibility. Static
snapshot ingestion is not federation.
