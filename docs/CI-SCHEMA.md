# GFTB v4 action-fabric contract

Status: source canary under TIN-4251. Source presence, merge, or a GitHub job
pickup is not v4 activation or remote-execution evidence.

## Ownership

`greatfallstoolbus.org` owns product source, finite Bazel targets, and the
checked-in ActionPlan. `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` owns
the signed `OwnerInstallation/v1` and `TenantOverlay/v1` consumer instances.
GloriousFlywheel owns interface types, verification, the controller contract,
the compiled action client, scheduling, and measurement semantics. Provider
repositories own concrete endpoints, workers, storage, and placement.

GF core does not own Great-Falls-Tool-Bus tenant or repository rows. This
consumer does not name a provider, cluster, node, pool, runner, endpoint,
instance, credential, or placement decision.

## ActionPlan

`.github/lanes.json` validates against `docs/schemas/lanes.schema.json` and is
the only application-side execution declaration:

```json
{
  "schema_version": 3,
  "actions": {
    "build": {
      "command": "build",
      "targets": ["//:deployment_bundle"],
      "capability": "rbe-linux-x86_64",
      "result": {
        "mode": "export-regular-files",
        "output_groups": ["default"]
      }
    },
    "validate": {
      "command": "test",
      "targets": [
        "//:current_source_secret_scan_test",
        "//:deployment_app_root_test",
        "//:eslint_test",
        "//:inhouse_package_parity_test",
        "//:prettier_check_test",
        "//:svelte_check_test",
        "//:unit_tests"
      ],
      "capability": "rbe-linux-x86_64",
      "result": {"mode": "status-only"}
    }
  }
}
```

It contains only named `build` or `test` commands, finite workspace-local Bazel
labels, one provider-blind abstract capability, and one closed result
disposition. `status-only` exposes no output claim and forbids output groups.
`export-regular-files` requires exact non-pattern targets and a non-empty list
of output groups; the compiled client emits one bounded `ActionOutputSet/v1`
only after the complete Bazel event graph and selected blobs are verified
against the resolved tenant CAS. There is no omitted/default disposition.
The schema admits Linux and Darwin demand without claiming either has live
provider supply; unavailable supply fails during resolution. The plan carries
no runner, endpoint, target-class, lifecycle, free-form artifact description,
publication, repository, tenant, or provider field.

`//:deployment_bundle` produces one reproducible `tar.gz` rooted at `app/`.
That application root contains the adapter-node `build/`, the custom
`server.js`, the Node 24 package manifest, the checked-in `drizzle/`
migrations, the worker and migrator ESM payloads, and the single three-role
dispatcher. Its relative `node_modules` link points into a self-contained
rules_js `js_image_layer` runfiles tree carrying the production-only
third-party package-store closure and both BCR-sourced first-party runtime
packages. The Node toolchain layer is omitted because the owner image supplies
the pinned Node 24 executable; no host, Nix, registry, or local bridge supplies
application packages. `//:deployment_app_root_test` extracts the exact
uncompressed archive that the bundle wraps, proves representative direct and
transitive bare imports from that root, invokes the bundled dispatcher as each
of `web`, `worker`, and `migrator` with `--help`, and starts its adapter-node
server. This proves the application-owned role boundaries, not `/bin/*`
wrappers, an image UID, OCI config, or an interpreter closure; those are GF-I09
owner-materializer output proofs. The bundle is a runnable publication input,
not an OCI image, a registry write, a publication request, or a deployment
transaction.

## GitHub edge

`.github/workflows/ci.yml` calls
`tinyland-inc/ci-templates/.github/workflows/spoke-ci-v4.yml@32e39ced0008edf4564ebeb173a5e8fbf069e28f`
(`v5.1.0`, carrying ActionPlan/v4 schema 3) once for the exact deployment
bundle and once for validation. ARC admits each thin
GitHub job and runs the image-custodied
`/usr/local/bin/gf-action-client`; ARC is not the compute scheduler. The client
binds the exact plan bytes, action, and source SHA to the controller-resolved
catalog and submits the Bazel action to REAPI.

There is no v4 path through a vendored wrapper, local Bazel execution,
cache-only execution, a hosted or repo-shaped runner, a direct endpoint,
`.env` profile, port-forward, v1 token exchange, or producer-held consumer
registry. Missing authority is a refusal to repair, never a downgrade signal.

The application stops at the verified `ActionOutputSet/v1` for
`//:deployment_bundle`. GF-I07/v5 must first qualify those bytes against
independent execution/cache observation; only the GF-I09 owner
materializer/publisher/controller may then construct and publish an OCI image
and converge it through the consumer overlay. ci-templates v5.1.0 invokes the
actions but does not yet expose that qualified output to a publication job, and
GFTB has no remote action producing its publishable OCI payload. Publication
and production convergence therefore remain blocked rather than falling back
to an application-owned workflow.

The same boundary currently leaves application source provenance unavailable:
ci-templates authenticates the source SHA to `gf-action-client`, but the v4
execution sandbox does not expose that value to Vite as `PUBLIC_BUILD_SHA`.
Consequently the current bundle renders an empty `/health.sha` and no footer
SHA. Only a typed GF-I07/GF-I09 provenance carrier may bind that authenticated
revision into the qualified artifact; this consumer must not recover it from
ambient Git state or introduce an application-specific execution channel.

## Activation gates

Keep the source carrier Draft until all of these exist for the same immutable
tuple:

1. the GF GitHub App observes this organization and repository;
2. the consumer-owned infra repo publishes signed `OwnerInstallation/v1` and
   `TenantOverlay/v1` instances using the ratified controller schema;
3. the controller publishes an immutable resolved catalog containing the exact
   raw ActionPlan digest and source identity;
4. the dispatcher image contains the protected `gf-action-client`;
5. GitHub OIDC and REAPI admission accept the exact tuple; and
6. LGTM attributes a remote Execute or same-tenant CAS/AC withdrawal; and
7. GF-I07/GF-I09 bind the authenticated source revision into the qualified
   artifact and prove the final owner-image wrappers/config for all three roles.

No consumer overlay instance is added here before the controller schema lands;
inventing a parallel JSON wire would fork the product interface.

## Non-action transactions

Browser LOOK, image publication, PR-environment lifecycle, reap, OpenTofu,
production apply, and edge mutation are not Bazel actions. They require their
own controller result and owner-overlay transaction. A local preview or direct
cluster command cannot stand in for those receipts.

## Validation

Use existing registered entrypoints:

```text
just lanes-validate
just repo-manifest-validate
just conformance
```

Graph formatting and schema validation prove only the source contract. They do
not prove activation, execution, cache attribution, publication, or production.
