# Runtime Broker Display - 2026-05-19

Linear: `TIN-1437`, `TIN-1436`, `TIN-1487`

`site.scaffold` can also seed read-only spokes whose content is displayed from a
Tinyland broker route at runtime. This is the house pattern for
Cloudflare-Pages-hosted blog and Pulse sites, including the TransScend Survival
blog lane.

## Intended Flow

```
tinyland.dev editor/admin/content authority
  -> hub.tinyland.dev public broker route
  -> Cloudflare Pages static spoke client fetch
  -> rendered posts, notes, media, or Pulse items
```

The spoke does not commit raw post payloads, does not run a mutation API, and
does not become an ActivityPub authority. It renders reviewed public broker data.

## Allowed

- Static SvelteKit/Cloudflare Pages shell.
- Browser runtime fetches from a reviewed `hub.tinyland.dev` broker route.
- CORS-readable public broker JSON with explicit schema version, content hash,
  content authority, and policy fields.
- Graceful unavailable state when the broker route is down or returns a shape
  mismatch.
- Report-only remote smoke or CI checks against protected preview URLs.

## Required Contract

Runtime broker-display payloads must make these boundaries machine-readable:

- `contentAuthority: "tinyland.dev"`;
- `runtimeBrokerFetch: true`;
- `consumerContract.mode: "cf-pages-runtime-broker-fetch"`;
- `consumerContract.checkedInPostPayloads: false`;
- `consumerContract.spokeMutationApi: false`;
- `consumerContract.spokeActivityPubWorker: false`;
- `policy.contentTransport: "dynamic-broker-stream"`;
- `policy.draftContentIncluded: false`;
- `policy.unreviewedContentIncluded: false`;

`publicFediverseDelivery` is not the display-membership gate. It is an
item-level Tinyland outbound-delivery flag: a broker-display spoke may render
reviewed public content whose flag is `false`, and if Tinyland later marks an
item `true`, the spoke still only renders that state. It must not deliver,
redeliver, fan out, or maintain followers.

## Blocked

- Checked-in blog post markdown as the primary production feed.
- CI jobs that "materialize" posts into the spoke and call that federation.
- Spoke-side writes, admin forms, auth, private media handling, checkout, or
  payment custody.
- Spoke-side ActivityPub actors, inboxes, delivery workers, follower ledgers,
  retry queues, tombstone propagation, or moderation workflow.
- Fetching from the `tinyland.dev` public apex app leak as the broker origin.

## Current Reference

The current reference implementation is `Jesssullivan/jesssullivan.github.io`
PR #131, which makes `/blog` and `/blog/[slug]` hydrate from:

```
https://hub.tinyland.dev/projections/jesssullivan-github-io/blog/broker-stream.v1.json
```

That blog spoke is only complete when the hub route returns live reviewed
Tinyland-managed content. A green CF Pages build proves the display client, not
the broker stream itself.
