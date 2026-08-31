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
          # curl: scripts/production-health-probe.sh and other tinyland-nix
          # jobs need it; the minimal ARC image doesn't preinstall it the way
          # a hosted runner would (TIN-3914).
          curl
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
        # ADAPTER SELECTION (TIN-3815 S0, ADR 0010 Amendment 1 item 2): the
        # no-`ADAPTER` repository build stays adapter-static so the default gates
        # never regress against the frozen lockfile. adapter-node is selected
        # EXPLICITLY by the image recipes (`ADAPTER=node` in the
        # `container-image-*` recipes and in ContainerFile) — `svelte.config.js`
        # keeps its static default. Publishing an image never deploys it and
        # never flips a live route; the infra apply plane owns promotion.
        n2c = nix2container.packages.${system}.nix2container;

        # The adapter-node build/ output is produced imperatively by
        # ADAPTER=node pnpm run build (kept as the GloriousFlywheel
        # cache-accelerated input, not a hermetic Nix build) and imported via
        # APP_BUILD under --impure. adapter-node externalizes packages listed
        # in package.json dependencies, so the complete Node layout produced by
        # frozen pnpm plus Bazel-only _house-hydrate is separately imported via
        # APP_NODE_MODULES. Both paths are gitignored and cannot ride the flake
        # source tree. Default gates leave these attributes unforced; the
        # protected runtime-closure proof and image recipes supply both paths.
        appBuildEnv = builtins.getEnv "APP_BUILD";
        appBuild =
          if appBuildEnv == "" then
            throw "flake image/runtime proof requires APP_BUILD=$PWD/build (the ADAPTER=node output); use a container-image Just recipe, which runs nix with --impure."
          else
            builtins.path {
              name = "gftb-adapter-node-build";
              path = appBuildEnv;
            };
        appNodeModulesEnv = builtins.getEnv "APP_NODE_MODULES";
        appNodeModules =
          if appNodeModulesEnv == "" then
            throw "flake image/runtime proof requires APP_NODE_MODULES=$PWD/node_modules after frozen pnpm install and Bazel-only house hydration."
          else
            builtins.path {
              name = "gftb-adapter-node-runtime-node-modules";
              path = appNodeModulesEnv;
            };
        envOr = name: default: let v = builtins.getEnv name; in if v == "" then default else v;
        commitSha = envOr "BUILD_COMMIT_SHA" "unknown";
        commitRef = envOr "BUILD_COMMIT_REF" "unknown";
        created = envOr "BUILD_DATE" "1970-01-01T00:00:00Z";
        # GHCR requires an all-lowercase image ref; the org owner is
        # Great-Falls-Tool-Bus. copyToRegistry derives docker://name:tag from
        # these, so `name` IS the push destination.
        # NOTE (TIN-3815, ADR 0014 §0.1): the default stays the CURRENT GitHub
        # slug. The `gftb-platform` rename is an operator-gated action sequenced
        # on the private-CI / package-pull / rollback proof; do not pre-empt it
        # here. When the operator performs it, CI overrides IMAGE_REF anyway.
        imageName = pkgs.lib.toLower (envOr "IMAGE_REF" "ghcr.io/great-falls-tool-bus/greatfallstoolbus.org");

        # ONE image, THREE stable process names (spec §6, TIN-3815 S0). Each
        # wrapper is a real executable named `web` / `worker` / `migrator` so a
        # Deployment or Job selects a process boundary by name, not by a bespoke
        # argv contract. They all dispatch into the single
        # scripts/platform-entrypoint.mjs; S1 (migrator) and S3 (worker) fill in
        # the placeholders WITHOUT changing this image contract.
        #
        # WRAPPER FORM — deliberate, and NOT the same code path as ContainerFile.
        # These wrappers pass the role POSITIONALLY. ContainerFile instead
        # symlinks /usr/local/bin/<role> at the dispatcher, which exercises the
        # linked-name branch (Node keeps argv[1] as the link path). The
        # dispatcher supports both and the unit test pins linked-name-wins
        # precedence, but be honest about which ships where: CI publishes THIS
        # (nix2container) artifact, so the POSITIONAL branch is what production
        # runs; the linked-name branch is the local ContainerFile mirror's.
        #
        # The positional form is used here on purpose rather than reproducing the
        # symlink: a store symlink would re-enter the dispatcher through its
        # `#!/usr/bin/env node` shebang, making the image depend on `env` and
        # `node` resolving via PATH. Calling the interpreter by absolute store
        # path removes that assumption entirely. `just container-image-smoke`
        # executes whichever form the image under test actually ships.
        mkPlatformEntrypoint =
          role:
          pkgs.writeShellApplication {
            name = role;
            text = ''
              exec ${pkgs.nodejs_22}/bin/node ${./scripts/platform-entrypoint.mjs} ${role} "$@"
            '';
          };
        webEntrypoint = mkPlatformEntrypoint "web";
        workerEntrypoint = mkPlatformEntrypoint "worker";
        migratorEntrypoint = mkPlatformEntrypoint "migrator";
        platformEntrypoints = pkgs.buildEnv {
          name = "gftb-image-entrypoints";
          paths = [
            webEntrypoint
            workerEntrypoint
            migratorEntrypoint
          ];
          pathsToLink = [ "/bin" ];
        };

        # SLOW/stable layer: the Node runtime + certs + init. Kept separate from the
        # fast app layer so a content-only redeploy re-pushes ONLY the app layer.
        # coreutils rides along for exactly one reason: S0's acceptance row
        # proves non-root by running `id -u` INSIDE the image, and `just
        # container-image-smoke` executes that. Node cannot stand in — it would
        # report the uid of a process the row is meant to audit from outside the
        # app. Drop coreutils only together with that row.
        imageRoot = pkgs.buildEnv {
          name = "gftb-image-root";
          paths = [
            pkgs.nodejs_22
            pkgs.dumb-init
            pkgs.cacert
            pkgs.coreutils
            platformEntrypoints
          ];
          pathsToLink = [ "/bin" "/etc" "/share" "/lib" ];
        };

        # FAST layer: adapter-node build output plus its complete external runtime
        # closure at /app. adapter-node deliberately externalizes package.json
        # dependencies; in particular, tinyland-auth-pg stays external so it and
        # the app share one drizzle-orm instance. APP_NODE_MODULES is the frozen
        # third-party layout after _house-hydrate has copied the six Bzlmod :pkg
        # outputs into it. Copying that exact layout preserves Bazel/BCR authority
        # without restoring any first-party npm source edge.
        #
        # drizzle/ rides along (TIN-3817 S1) because /bin/migrator reads the
        # checked-in migration SQL and hashes its exact bytes against the ledger.
        appRoot = pkgs.runCommand "gftb-app" { } ''
          mkdir -p "$out/app"
          cp -a ${appBuild} "$out/app/build"
          cp -a ${appNodeModules} "$out/app/node_modules"
          cp -a ${./package.json} "$out/app/package.json"
          cp -a ${./server.js} "$out/app/server.js"
          cp -a ${./drizzle} "$out/app/drizzle"
          test -f "$out/app/build/migrator.mjs" || {
            echo "flake .#image: build/migrator.mjs is missing from APP_BUILD." >&2
            echo "  /bin/migrator would exit 70 (malformed image) at runtime." >&2
            echo "  Run 'just db-migrator-bundle' before importing APP_BUILD." >&2
            exit 1
          }
          test -f "$out/app/build/worker.mjs" || {
            echo "flake .#image: build/worker.mjs is missing from APP_BUILD." >&2
            echo "  /bin/worker would exit 70 (malformed image) at runtime." >&2
            echo "  Run 'just worker-bundle' before importing APP_BUILD." >&2
            exit 1
          }
          for required_package in \
            @tummycrypt/tinyland-auth \
            @tummycrypt/tinyland-auth-pg \
            drizzle-orm \
            pg; do
            test -f "$out/app/node_modules/$required_package/package.json" || {
              echo "flake .#image: external runtime package is missing: $required_package" >&2
              exit 1
            }
          done
        '';

        # A real startup/import proof over the same appRoot used by the image.
        # It imports the external auth/DB closure, starts the custom adapter-node
        # server, and fetches localhost. It never assembles or pushes an image and
        # is intentionally a Nix/Just proof, not an RBE-eligible Bazel action.
        runtimeImportProof = pkgs.writeText "gftb-runtime-import-proof.mjs" ''
          import { createRequire } from "node:module";
          const require = createRequire("${appRoot}/app/package.json");
          await import(require.resolve("@tummycrypt/tinyland-auth"));
          await import(require.resolve("@tummycrypt/tinyland-auth-pg"));
          await import(require.resolve("drizzle-orm"));
          await import(require.resolve("pg"));
        '';
        runtimeClosureProof = pkgs.writeShellApplication {
          name = "gftb-runtime-closure-proof";
          runtimeInputs = [
            pkgs.coreutils
            pkgs.curl
          ];
          text = ''
            app_root="${appRoot}/app"
            ${pkgs.nodejs_22}/bin/node ${runtimeImportProof}

            export HOST=127.0.0.1
            export PORT="$((20000 + ($$ % 20000)))"
            export NODE_ENV=production
            ${pkgs.nodejs_22}/bin/node "$app_root/server.js" &
            server_pid=$!

            cleanup() {
              if kill -0 "$server_pid" 2>/dev/null; then
                kill "$server_pid" 2>/dev/null || true
              fi
              wait "$server_pid" 2>/dev/null || true
            }
            trap cleanup EXIT INT TERM

            ready=0
            for attempt in $(seq 1 100); do
              if ! kill -0 "$server_pid" 2>/dev/null; then
                if wait "$server_pid"; then status=0; else status=$?; fi
                if [[ "$status" == "0" ]]; then status=1; fi
                echo "runtime closure proof: adapter-node server exited before readiness (status $status)." >&2
                exit "$status"
              fi
              if curl --connect-timeout 1 --max-time 2 --silent --output /dev/null \
                "http://$HOST:$PORT/"; then
                ready=1
                break
              fi
              sleep 0.1
            done
            if [[ "$ready" != "1" ]]; then
              echo "runtime closure proof: adapter-node server did not answer localhost." >&2
              exit 1
            fi

            cleanup
            trap - EXIT INT TERM
            echo "runtime closure proof OK: imports resolved and adapter-node answered localhost."
          '';
        };

        appLayer = n2c.buildLayer {
          copyToRoot = appRoot;
        };

        image = n2c.buildImage {
          name = imageName;
          tag = "sha-${commitSha}";
          inherit created;
          copyToRoot = imageRoot;
          layers = [ appLayer ];
          config = {
            Entrypoint = [ "${pkgs.dumb-init}/bin/dumb-init" "--" ];
            # Default process is `web`; `worker` and `migrator` are selected by
            # overriding the command, not by building a different image.
            Cmd = [ "/bin/web" ];
            # Non-root by uid:gid (ADR 0008 §3). Numeric on purpose — the image
            # carries no /etc/passwd entry and none is required.
            User = "1001:1001";
            WorkingDir = "/app";
            Env = [
              "PATH=/bin"
              "NODE_ENV=production"
              "HOST=0.0.0.0"
              "PORT=3000"
              # The dispatcher lives in the Nix store, so it cannot infer a
              # repo-relative build/. Hand it the absolute in-image path. This
              # is server.js, NOT adapter-node's own generated build/index.js
              # (TIN-3959): server.js wraps the generated build/handler.js
              # with the cache-header fix documented at its top —
              # build/index.js's stock sirv layers ship prerendered HTML with
              # no Cache-Control and an epoch Last-Modified (mtimes are
              # zeroed for reproducible builds), so returning visitors never
              # revalidate.
              "GFTB_WEB_ENTRYPOINT=/app/server.js"
              # Same reason, for the migrator (TIN-3817 S1): the applier bundle
              # and the migration SQL it hashes are both addressed absolutely.
              "GFTB_MIGRATOR_ENTRYPOINT=/app/build/migrator.mjs"
              "GFTB_MIGRATIONS_DIR=/app/drizzle"
              # Same reason, for the worker (TIN-3817 S3). DATABASE_URL and
              # GFTB_TENANT_ID stay runtime NAMES owned by the apply plane.
              "GFTB_WORKER_ENTRYPOINT=/app/build/worker.mjs"
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
                "Great Falls Tool Bus platform image — adapter-node web, worker, and migrator entrypoints";
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
        #
        # `.#web`, `.#worker`, and `.#migrator` are the SAME derivations the
        # image installs at /bin/<role>. `just platform-entrypoints-check` runs
        # each one, which proves the per-entrypoint contract on a machine with
        # no container daemon at all.
        packages = {
          inherit image;
          web = webEntrypoint;
          worker = workerEntrypoint;
          migrator = migratorEntrypoint;
          "runtime-closure-proof" = runtimeClosureProof;
        };

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
