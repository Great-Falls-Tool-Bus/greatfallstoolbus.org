#!/usr/bin/env python3
"""Check Bzlmod/npm version parity for Tinyland-owned packages.

The scaffold still uses pnpm/Vite for its canonical static build, so some
in-house packages must remain in package.json. The Bazel-first contract is that
those package versions match the corresponding bazel_dep entry exactly.

npm-retirement extension (TIN-3165): the npm channel for in-house @tummycrypt
packages is retired; the tinyland-inc/bazel-registry graph is the sole rail. A
package pinned to the registry source seam — the exact GitHub tag archive named
by the module's source.json — satisfies parity too. This script accepts exactly
that URL shape (repo name must match the package, tag version must match
MODULE.bazel) and holds every other specifier to the original exact-semver rule.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
MODULE_BAZEL = ROOT / "MODULE.bazel"
IN_HOUSE_SCOPES = ("@tummycrypt/", "@tinyland/")

# The only sanctioned non-registry specifier: the exact GitHub tag archive the
# tinyland-inc/bazel-registry names in the module's source.json.
REGISTRY_SOURCE_TARBALL_RE = re.compile(
    r"^https://github\.com/tinyland-inc/(?P<repo>[a-z0-9-]+)"
    r"/archive/refs/tags/v(?P<version>\d+\.\d+\.\d+)\.tar\.gz$"
)


def npm_to_bazel_module(package_name: str) -> str:
    scope, name = package_name.split("/", 1)
    return f"{scope[1:]}_{name}".replace("-", "_")


def load_inhouse_packages() -> dict[str, str]:
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    packages: dict[str, str] = {}
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        for name, version in package.get(section, {}).items():
            if name.startswith(IN_HOUSE_SCOPES):
                packages[name] = str(version)
    return packages


def load_bazel_deps() -> dict[str, str]:
    text = MODULE_BAZEL.read_text(encoding="utf-8")
    deps: dict[str, str] = {}
    for match in re.finditer(
        r'bazel_dep\(\s*name\s*=\s*"([^"]+)"\s*,\s*version\s*=\s*"([^"]+)"\s*\)',
        text,
        flags=re.MULTILINE,
    ):
        deps[match.group(1)] = match.group(2)
    return deps


def main() -> int:
    packages = load_inhouse_packages()
    bazel_deps = load_bazel_deps()
    failures: list[str] = []

    for package_name, npm_version in sorted(packages.items()):
        module_name = npm_to_bazel_module(package_name)
        bazel_version = bazel_deps.get(module_name)
        if bazel_version is None:
            failures.append(f"{package_name} has no matching bazel_dep({module_name})")
            continue

        tarball = REGISTRY_SOURCE_TARBALL_RE.match(npm_version)
        if tarball is not None:
            expected_repo = package_name.split("/", 1)[1]
            if tarball.group("repo") != expected_repo:
                failures.append(
                    f"{package_name} tarball pin names repo {tarball.group('repo')!r}, expected {expected_repo!r}"
                )
                continue
            npm_version = tarball.group("version")
        elif npm_version.startswith(("^", "~", ">", "<", "=")) or any(
            token in npm_version for token in ("*", "||", " - ")
        ):
            failures.append(f"{package_name} uses non-exact npm version {npm_version!r}")
            continue

        if npm_version != bazel_version:
            failures.append(
                f"{package_name} npm version {npm_version} != bazel module {module_name} version {bazel_version}"
            )

    if failures:
        print("In-house package parity failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"In-house package parity ok: {len(packages)} package(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
