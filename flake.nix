{
  description = "site.scaffold development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
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

            echo "site.scaffold dev shell"
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

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
