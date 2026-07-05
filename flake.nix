{
  description = "greatfallstoolbus.org development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # Daemonless OCI image builder (nlewo/nix2container). This is GloriousFlywheel
    # core's own image mechanism and the ecosystem-SOTA path that replaces the
    # bespoke dockerTools.streamLayeredImage + shell-skopeo build (see
    # packages.image below and nix/oci-image.nix, now the nixpkgs-only fallback).
    # It follows this flake's nixos-unstable nixpkgs (recent Go), so the n2c Go
    # binary and its patched skopeo share our pin rather than duplicating a tree.
    nix2container.url = "github:nlewo/nix2container";
    nix2container.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { self, nixpkgs, flake-utils, nix2container }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        corePackages = with pkgs; [
          # Core JS toolchain
          nodejs_22
          pnpm
          typescript
          typescript-language-server

          # Build / VCS / CLI
          just
          git
          gh
          bazelisk
          gitleaks
          syft

          # CI-schema + lane tooling (docs/CI-SCHEMA.md)
          python3
          python3Packages.jsonschema
          jq

          # Tofu + reachability probe (docs/CI-SCHEMA.md §7)
          opentofu
          terraform-ls
          tflint
          netcat-gnu

          # Changelog (cliff.toml-driven; see just changelog)
          git-cliff
        ];
        playwrightRuntimeLibraries = with pkgs; [
          alsa-lib
          at-spi2-atk
          at-spi2-core
          atk
          cairo
          cups
          dbus
          expat
          fontconfig
          freetype
          glib
          gtk3
          libdrm
          libgbm
          libxkbcommon
          mesa
          nspr
          nss
          pango
          libx11
          libxscrnsaver
          libxcomposite
          libxcursor
          libxdamage
          libxext
          libxfixes
          libxi
          libxrandr
          libxrender
          libxtst
        ];
        shellHook =
          extraHook:
          ''
            # Enable corepack so pnpm@10.13.1 (from packageManager field in
            # package.json once M0.2 lands) takes over from the nix-shipped pnpm.
            corepack enable >/dev/null 2>&1 || true

            ${extraHook}

            echo "greatfallstoolbus.org dev shell"
            echo "  node     $(node --version)"
            echo "  pnpm     $(pnpm --version 2>/dev/null || echo 'not available yet')"
            echo "  just     $(just --version)"
            echo "  bazel    $(bazelisk --version 2>&1 | head -n1)"
            echo "  gh       $(gh --version | head -n1)"
            echo "  gitleaks $(gitleaks version 2>&1 | head -n1)"
            echo "  python   $(python3 --version)"
            echo "  tofu     $(tofu --version 2>&1 | head -n1)"
            echo "  jq       $(jq --version)"
            echo "  git-cliff $(git-cliff --version 2>&1 | head -n1)"
          '';
        playwrightShellHook = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
          export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightRuntimeLibraries}:''${LD_LIBRARY_PATH:-}"
        '';

        # ─────────────────────────────────────────────
        # On-cluster container image (nix2container, TIN-2543)
        # ─────────────────────────────────────────────
        # PRIMARY daemonless OCI image path, mirroring GloriousFlywheel core's own
        # nix2container mechanism. Replaces the bespoke
        # dockerTools.streamLayeredImage build (now the nixpkgs-only fallback in
        # nix/oci-image.nix). Built + pushed via `just container-image-publish`
        # -> `nix run --impure .#image.copyToRegistry`.
        #
        # PRODUCTION default is UNCHANGED: adapter-static -> Cloudflare Pages
        # (ADR 0003, DB-less, no edge auth). This image only wraps the
        # @sveltejs/adapter-node output so great-falls-tool-bus-infra (blahaj) has a
        # concrete `node build/index.js` artifact to consume. Publishing it never
        # deploys it and never flips the live host.
        n2c = nix2container.packages.${system}.nix2container;

        # The adapter-node build/ output is produced IMPERATIVELY by
        # `ADAPTER=node pnpm run build` (kept as the GloriousFlywheel
        # cache-accelerated input, NOT a hermetic Nix build) and imported via the
        # APP_BUILD env under `--impure`. build/ is gitignored, so it cannot ride
        # the flake source tree; getEnv is the deliberate escape hatch. The commit
        # metadata rides the same impure channel. All default gates (format, lint,
        # typecheck, test-unit, build) leave `.#image` unforced, so pure eval never
        # touches these throws.
        appBuildEnv = builtins.getEnv "APP_BUILD";
        appBuild =
          if appBuildEnv == "" then
            throw "flake .#image requires APP_BUILD=$PWD/build (the ADAPTER=node output); build it via `just container-image-publish` / `just container-image-build`, which run `nix run --impure`."
          else
            builtins.path {
              name = "gftb-adapter-node-build";
              path = appBuildEnv;
            };
        envOr = name: default: let v = builtins.getEnv name; in if v == "" then default else v;
        commitSha = envOr "BUILD_COMMIT_SHA" "unknown";
        commitRef = envOr "BUILD_COMMIT_REF" "unknown";
        created = envOr "BUILD_DATE" "1970-01-01T00:00:00Z";
        # GHCR requires an all-lowercase image ref; the org owner is
        # Great-Falls-Tool-Bus. copyToRegistry derives docker://name:tag from
        # these, so `name` IS the push destination.
        imageName = pkgs.lib.toLower (envOr "IMAGE_REF" "ghcr.io/great-falls-tool-bus/greatfallstoolbus.org");

        # SLOW/stable layer: the Node runtime + certs + init. Kept separate from the
        # fast app layer so a content-only redeploy re-pushes ONLY the app layer.
        imageRoot = pkgs.buildEnv {
          name = "gftb-image-root";
          paths = [
            pkgs.nodejs_22
            pkgs.dumb-init
            pkgs.cacert
          ];
          pathsToLink = [ "/bin" "/etc" "/share" "/lib" ];
        };

        # FAST layer: the small, frequently-changing adapter-node bundle at /app.
        # adapter-node bundles the (pure-JS) production deps into build/, so the
        # runtime needs only build/ + package.json + a Node runtime; no node_modules.
        appLayer = n2c.buildLayer {
          copyToRoot = pkgs.runCommand "gftb-app" { } ''
            mkdir -p "$out/app"
            cp -a ${appBuild} "$out/app/build"
            cp -a ${./package.json} "$out/app/package.json"
          '';
        };

        image = n2c.buildImage {
          name = imageName;
          tag = "sha-${commitSha}";
          inherit created;
          copyToRoot = imageRoot;
          layers = [ appLayer ];
          config = {
            Entrypoint = [ "${pkgs.dumb-init}/bin/dumb-init" "--" ];
            Cmd = [ "${pkgs.nodejs_22}/bin/node" "/app/build/index.js" ];
            WorkingDir = "/app";
            Env = [
              "NODE_ENV=production"
              "HOST=0.0.0.0"
              "PORT=3000"
              "NODE_OPTIONS=--max-old-space-size=512"
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            ];
            ExposedPorts = {
              "3000/tcp" = { };
            };
            Labels = {
              "org.opencontainers.image.source" =
                "https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org";
              "org.opencontainers.image.revision" = commitSha;
              "org.opencontainers.image.ref.name" = commitRef;
              "org.opencontainers.image.created" = created;
              "org.opencontainers.image.description" =
                "greatfallstoolbus.org adapter-node on-cluster serve image";
            };
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = corePackages;
          shellHook = shellHook "";
        };

        devShells.playwright = pkgs.mkShell {
          buildInputs =
            corePackages
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux ([ pkgs.chromium ] ++ playwrightRuntimeLibraries);
          shellHook = shellHook playwrightShellHook;
        };

        # PRIMARY on-cluster image (nix2container). Build + push with
        # `nix run --impure .#image.copyToRegistry -- --dest-creds "$USER:$TOKEN"`
        # (wired through `just container-image-publish`). copyToRegistry /
        # copyTo / copyToDockerDaemon ride the n2c-patched skopeo. Linux-only in
        # practice (the on-cluster serve arch); local macOS builds a host-arch
        # image only, so real validation is on the tinyland-nix runner.
        packages.image = image;

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
