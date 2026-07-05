# Daemonless OCI image for the on-cluster adapter-node serve path (TIN-2543).
#
# WHY NIX (not buildx): the Great-Falls-Tool-Bus ARC pool advertises only the
# shared `tinyland-nix` GloriousFlywheel runner — there is NO `tinyland-dind` /
# Docker-daemon / buildx runner in this org (see docs/CI-SCHEMA.md §6 and the
# great-falls-tool-bus-infra *-crs.yml workflows, which all run on tinyland-nix
# via ./GloriousFlywheel/.github/actions/nix-job). So the image is assembled
# with `pkgs.dockerTools.streamLayeredImage` and pushed with `skopeo` — no
# daemon required. See `just container-image-publish`.
#
# The PRODUCTION default host is unchanged: adapter-static -> Cloudflare Pages
# (ADR 0003, DB-less, no edge auth). This image only exists so
# great-falls-tool-bus-infra (blahaj) has a concrete `node build/index.js`
# artifact to consume when a server is genuinely needed. Publishing it never
# deploys it and never flips the live host.
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
  '';
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
      appRoot
    ];
    config = {
      Entrypoint = [ "dumb-init" "--" ];
      Cmd = [ "node" "/app/build/index.js" ];
      WorkingDir = "/app";
      ExposedPorts = {
        "3000/tcp" = { };
      };
      Env = [
        "NODE_ENV=production"
        "HOST=0.0.0.0"
        "PORT=3000"
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
