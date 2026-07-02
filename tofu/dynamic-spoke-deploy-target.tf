# dynamic-spoke deploy target — DESIGN-STAGE STUB (TIN-2228).
#
# This file is intentionally a comment-only placeholder. It declares NO
# resources, variables, modules, or outputs, so it does not affect `tofu plan`
# and stays fmt-clean. It marks where the adapter-node (dynamic-spoke) deploy
# target will be composed once the blue/green lane moves from design to
# implementation.
#
# Design authority:
#   - docs/decisions/dynamic-spoke-adapter-mode.md  (flagged adapter mode)
#   - docs/decisions/dynamic-canary-blue-green.md   (blue/green via Blahaj)
#
# When implemented, this module will:
#   - request (NOT own) a blue/green server deployment from the Blahaj GitOps
#     receiver (tinyland-inc/blahaj); Blahaj owns DNS, Access, Tunnel ingress,
#     traffic cut-over, and reap. The spoke only emits a dispatch payload.
#   - reuse the existing ephemeral-env / runner-binding modules already
#     composed in main.tf rather than introducing a parallel controller.
#   - select itself only when the spoke was spawned with
#     `scripts/rebrand.sh --adapter=node` (spawned_repo_role = app-stateful-spoke).
#
# Hard invariants carried from CI-SCHEMA §5 still apply: SemVer-pinned module
# refs, no OpenTofu in Flywheel REAPI, and RustFS-only operator-provisioned
# state (never Garage, never MinIO).
#
# Until implemented, the static-spoke modules in main.tf remain the only active
# tofu wiring; a dynamic spoke's deploy is orchestrated by Blahaj, not by this
# directory.
