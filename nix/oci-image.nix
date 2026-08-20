# FALLBACK daemonless OCI image for the on-cluster adapter-node serve path
# (TIN-2543). This is the nixpkgs-only fallback, kept for a single-audited-
# dependency policy (no extra flake input): it builds the same image with
# pkgs.dockerTools.streamLayeredImage + nixpkgs skopeo and no third-party
# builder. The PRIMARY, ecosystem-SOTA path is the flake `.#image` attribute
# (nlewo/nix2container, GloriousFlywheel core's own image mechanism) invoked by
# `just container-image-publish` -> `nix run --impure .#image.copyToRegistry`.
# This file is intentionally retained, NOT deleted; it is not wired into the
# default recipes, but a `-A image` / `-A skopeo` build still works if the n2c
# input must be dropped.
#
# WHY NIX (not buildx): the Great-Falls-Tool-Bus ARC pool advertises only the
# shared `tinyland-nix` GloriousFlywheel runner — there is NO `tinyland-dind` /
# Docker-daemon / buildx runner in this org (see docs/CI-SCHEMA.md §6 and the
# great-falls-tool-bus-infra *-crs.yml workflows, which all run on tinyland-nix
# via ./GloriousFlywheel/.github/actions/nix-job). So the image is assembled
# with `pkgs.dockerTools.streamLayeredImage` and pushed with `skopeo` — no
# daemon required. See `just container-image-publish`.
#
# ADAPTER SELECTION (TIN-3815 S0, ADR 0010 Amendment 1 item 2): the no-`ADAPTER`
# repository build stays adapter-static as the local/CI fallback, so the default
# gates never regress. adapter-node is selected EXPLICITLY by the image recipes;
# `svelte.config.js` keeps its static default. This file packages the resulting
# adapter-node output for great-falls-tool-bus-infra (blahaj) to consume.
# Publishing an image never deploys it and never flips a live route.
#
# `appBuild` is the @sveltejs/adapter-node output directory (build/), produced
# imperatively by `ADAPTER=node pnpm run build` BEFORE this file is evaluated.
# Passing it as a path arg keeps the SvelteKit build the cache-accelerated
# GloriousFlywheel input; this file only PACKAGES + the recipe PUSHES, and image
# packaging/push is never remote-execution eligible (skill rule 8;
# `container-image-and-push` is blocked at the GF manifest layer).
#
# adapter-node bundles the project's (pure-JS) production dependencies into the
# server output, so the runtime image needs only build/ + package.json + a Node
# runtime — it does not ship node_modules (unlike the belt-and-suspenders local
# ContainerFile). If a future native runtime dependency appears, add the
# production node_modules here.
#
# nixpkgs resolves from the ambient GloriousFlywheel `#ci` devshell (`<nixpkgs>`
# on NIX_PATH); no endpoint, token, or cache authority is embedded here.
{
  # `throw` defaults (not bare required args) so that `-A skopeo` — which resolves
  # skopeo from this file's pinned pkgs and does NOT reference the app layers —
  # can be evaluated WITHOUT `--arg appBuild/appPackageJson`. Nix is lazy: these
  # throws only fire if the `image` attr is forced (via appRoot) without the args
  # being supplied, giving a clear message instead of the opaque "argument without
  # a value" error. `-A image` passes both via `--arg`, overriding these defaults.
  appBuild ? throw "nix/oci-image.nix: building the 'image' attr requires --arg appBuild \"$PWD/build\" (the ADAPTER=node output); it is not needed for -A skopeo.",
  appPackageJson ? throw "nix/oci-image.nix: building the 'image' attr requires --arg appPackageJson \"$PWD/package.json\"; it is not needed for -A skopeo.",
  # The checked-in migration tree (TIN-3817 S1). /bin/migrator hashes these
  # files' EXACT bytes against the ledger, so they ship with the image.
  appMigrations ? throw "nix/oci-image.nix: building the 'image' attr requires --arg appMigrations \"$PWD/drizzle\"; it is not needed for -A skopeo.",
  commitSha ? "unknown",
  commitRef ? "unknown",
  created ? "1970-01-01T00:00:00Z",
  pkgs ? import <nixpkgs> { },
}:
let
  appRoot = pkgs.runCommand "greatfallstoolbus-app" { } ''
    mkdir -p "$out/app"
    cp -a ${appBuild} "$out/app/build"
    cp -a ${appPackageJson} "$out/app/package.json"
    cp -a ${appMigrations} "$out/app/drizzle"
    test -f "$out/app/build/migrator.mjs" || {
      echo "nix/oci-image.nix: build/migrator.mjs is missing from appBuild." >&2
      echo "  /bin/migrator would exit 70 (malformed image) at runtime." >&2
      echo "  Run 'just db-migrator-bundle' before building the image." >&2
      exit 1
    }
  '';

  # ONE image, THREE stable process names (spec §6, TIN-3815 S0) — mirrors the
  # PRIMARY nix2container path in flake.nix so the fallback cannot drift into a
  # different image contract. That mirroring is the whole reason this file is in
  # the S0 diff: nothing imports it (CI never evaluates it; see the header), but
  # leaving it behind would strand a second, silently divergent image contract
  # for whoever reaches for the escape hatch. Same positional-wrapper rationale
  # as flake.nix — see the WRAPPER FORM note there.
  mkPlatformEntrypoint =
    role:
    pkgs.writeShellApplication {
      name = role;
      text = ''
        exec ${pkgs.nodejs_22}/bin/node ${../scripts/platform-entrypoint.mjs} ${role} "$@"
      '';
    };
  platformEntrypoints = pkgs.buildEnv {
    name = "gftb-image-entrypoints";
    paths = [
      (mkPlatformEntrypoint "web")
      (mkPlatformEntrypoint "worker")
      (mkPlatformEntrypoint "migrator")
    ];
    pathsToLink = [ "/bin" ];
  };
in
{
  # Exposed so `just container-image-publish` can resolve skopeo from the same
  # pinned nixpkgs as the image, independent of what the #ci shell ships.
  skopeo = pkgs.skopeo;

  # A streamer script: running it writes a docker-archive tar to stdout, which
  # `skopeo copy docker-archive:/dev/stdin docker://…` pushes straight to GHCR.
  image = pkgs.dockerTools.streamLayeredImage {
    name = "greatfallstoolbus.org";
    tag = "sha-${commitSha}";
    inherit created;
    contents = [
      pkgs.nodejs_22
      pkgs.dumb-init
      pkgs.cacert
      # coreutils supplies `id`, which S0's acceptance row runs INSIDE the image
      # to prove non-root (uid/gid 1001); `just container-image-smoke` executes
      # it. Drop coreutils only together with that row.
      pkgs.coreutils
      platformEntrypoints
      appRoot
    ];
    config = {
      Entrypoint = [ "dumb-init" "--" ];
      # Default process is `web`; `worker` and `migrator` are selected by
      # overriding the command, not by building a different image.
      Cmd = [ "/bin/web" ];
      # Non-root by uid:gid (ADR 0008 §3). Numeric on purpose — the image carries
      # no /etc/passwd entry and none is required.
      User = "1001:1001";
      WorkingDir = "/app";
      ExposedPorts = {
        "3000/tcp" = { };
      };
      Env = [
        "PATH=/bin"
        "NODE_ENV=production"
        "HOST=0.0.0.0"
        "PORT=3000"
        # The dispatcher lives in the Nix store, so it cannot infer a
        # repo-relative build/. Hand it the absolute in-image path.
        "GFTB_WEB_ENTRYPOINT=/app/build/index.js"
        # Same reason, for the migrator (TIN-3817 S1).
        "GFTB_MIGRATOR_ENTRYPOINT=/app/build/migrator.mjs"
        "GFTB_MIGRATIONS_DIR=/app/drizzle"
        "NODE_OPTIONS=--max-old-space-size=512"
        "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
      ];
      Labels = {
        "org.opencontainers.image.source" =
          "https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org";
        "org.opencontainers.image.revision" = commitSha;
        "org.opencontainers.image.ref.name" = commitRef;
        "org.opencontainers.image.created" = created;
      };
    };
  };
}
