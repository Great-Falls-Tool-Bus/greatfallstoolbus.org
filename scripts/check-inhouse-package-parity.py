#!/usr/bin/env python3
"""Assert Bazel-only ingestion of every first-party package.

TIN-2881 removes the npm-shadow rail. @tummycrypt/@tinyland packages must carry
no package.json specifier and must be linked from the tinyland-inc/bazel-registry
Bzlmod graph through each producer's public :pkg target.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
MODULE_BAZEL = ROOT / "MODULE.bazel"
BUILD_BAZEL = ROOT / "BUILD.bazel"
IN_HOUSE_SCOPES = ("@tummycrypt/", "@tinyland/")
IN_HOUSE_MODULE_PREFIXES = ("tummycrypt_", "tinyland_")


def npm_to_bazel_module(package_name: str) -> str:
    scope, name = package_name.split("/", 1)
    return f"{scope[1:]}_{name}".replace("-", "_")


def load_inhouse_npm_specifiers() -> dict[str, str]:
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    specifiers: dict[str, str] = {}
    sections = (
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    )
    for section in sections:
        for name, version in package.get(section, {}).items():
            if name.startswith(IN_HOUSE_SCOPES):
                specifiers[name] = str(version)
    return specifiers


def load_graph_links() -> dict[str, str]:
    """Return npm package name -> Bzlmod repository for public :pkg links."""
    text = BUILD_BAZEL.read_text(encoding="utf-8")
    links: dict[str, str] = {}
    pattern = re.compile(
        r'npm_link_package\(\s*'
        r'name\s*=\s*"node_modules/(@[^"]+)"\s*,\s*'
        r'src\s*=\s*"@([^/"]+)//:pkg"\s*,?\s*\)',
        flags=re.MULTILINE,
    )
    for package_name, module_name in pattern.findall(text):
        if package_name.startswith(IN_HOUSE_SCOPES):
            links[package_name] = module_name
    return links


def load_inhouse_bazel_deps() -> set[str]:
    text = MODULE_BAZEL.read_text(encoding="utf-8")
    deps = {
        match.group(1)
        for match in re.finditer(
            r'bazel_dep\(\s*name\s*=\s*"([^"]+)"',
            text,
            flags=re.MULTILINE,
        )
    }
    return {
        name
        for name in deps
        if name.startswith(IN_HOUSE_MODULE_PREFIXES)
    }


def main() -> int:
    failures: list[str] = []

    for name, version in sorted(load_inhouse_npm_specifiers().items()):
        failures.append(
            f"{name} remains an npm source specifier ({version!r}); "
            "first-party packages are Bazel-only"
        )

    links = load_graph_links()
    bazel_deps = load_inhouse_bazel_deps()
    linked_modules = set(links.values())

    if not links:
        failures.append("no first-party npm_link_package :pkg edges found")

    for package_name, linked_module in sorted(links.items()):
        expected_module = npm_to_bazel_module(package_name)
        if linked_module != expected_module:
            failures.append(
                f"{package_name} links @{linked_module}//:pkg, "
                f"expected @{expected_module}//:pkg"
            )
        if linked_module not in bazel_deps:
            failures.append(
                f"{package_name} links @{linked_module}//:pkg without a "
                "matching bazel_dep"
            )

    for module_name in sorted(bazel_deps - linked_modules):
        failures.append(
            f"bazel_dep({module_name}) has no first-party "
            "npm_link_package :pkg edge"
        )

    if failures:
        print("Bazel-only ingestion check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        f"Bazel-only ingestion ok: {len(links)} first-party package(s), "
        "0 npm specifiers, complete bazel_dep/:pkg links"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
