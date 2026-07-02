# Spoke-specific inputs. Rewritten by scripts/rebrand.sh on template
# instantiation. Schema: docs/CI-SCHEMA.md §7.

spoke_slug              = "greatfallstoolbus"
brand_domain            = "greatfallstoolbus.org"
github_org   = "tinyland-inc"

# Blahaj GitHub App installation ID. Obtain from the Blahaj App owner
# account via: gh api /app/installations
# Set to 0 to skip the blahaj_app_install module on first `tofu plan`.
blahaj_installation_id = 0

# Subset of the master runner-class enum the spoke may dispatch to. See
# docs/CI-SCHEMA.md §6 for the full list. Hard-deny enforcement.
allowed_runner_classes = ["tinyland-nix"]

# Lane names this spoke pre-creates stable DNS for (merge_main /
# release_tag lanes). Per-PR lanes use the wildcard CNAME.
lane_allowlist = []

# Aggregate cache quota in GiB (Attic + Bazel combined). Default 50.
cache_quota_gib = 50

# Cluster ingress CNAME target for wildcard / per-lane DNS.
ingress_target = "ingress.cluster.tinyland.dev"
