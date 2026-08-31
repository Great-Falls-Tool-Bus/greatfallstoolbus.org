#!/usr/bin/env python3
"""Assert Bazel-only ingestion of every first-party package.

TIN-2881 removes the npm-shadow rail. @tummycrypt/@tinyland packages must carry
no package.json specifier or pnpm lockfile edge and must be linked from the
tinyland-inc/bazel-registry Bzlmod graph through each producer's public :pkg
target.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
PNPM_LOCK = ROOT / "pnpm-lock.yaml"
MODULE_BAZEL = ROOT / "MODULE.bazel"
BUILD_BAZEL = ROOT / "BUILD.bazel"
IN_HOUSE_SCOPES = ("@tummycrypt/", "@tinyland/")
IN_HOUSE_MODULE_PREFIXES = ("tummycrypt_", "tinyland_")
CONTAINER_IMAGE_GRAPH_INPUTS = frozenset(
    {
        ".bazelrc",
        "BUILD.bazel",
        "Justfile",
        "MODULE.bazel",
        "MODULE.bazel.lock",
    }
)


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


def load_inhouse_lock_references() -> list[int]:
    """Return line numbers for any first-party edge retained in pnpm's lock."""
    return [
        line_number
        for line_number, line in enumerate(
            PNPM_LOCK.read_text(encoding="utf-8").splitlines(),
            start=1,
        )
        if any(scope in line for scope in IN_HOUSE_SCOPES)
    ]


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


def load_container_image_context_srcs(build_text: str) -> tuple[set[str], bool]:
    """Return direct source labels and whether house package outputs are inputs."""
    target = re.search(
        r'pkg_tar\(\s*name\s*=\s*"container_image_context"\s*,'
        r'(?P<body>.*?)^\)',
        build_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if target is None:
        return set(), False

    srcs = re.search(
        r"srcs\s*=\s*\[(?P<labels>.*?)\]\s*"
        r"(?P<house>\+\s*TINYLAND_HOUSE_PACKAGES)?\s*,",
        target.group("body"),
        flags=re.DOTALL,
    )
    if srcs is None:
        return set(), False

    labels = set(re.findall(r'"([^"\n]+)"', srcs.group("labels")))
    return labels, srcs.group("house") is not None


def container_image_context_failures(build_text: str) -> list[str]:
    """Require every first-party resolution/output edge in the image action key."""
    labels, has_house_packages = load_container_image_context_srcs(build_text)
    failures = [
        f"container_image_context omits Bazel image input {label}"
        for label in sorted(CONTAINER_IMAGE_GRAPH_INPUTS - labels)
    ]
    if not has_house_packages:
        failures.append(
            "container_image_context omits TINYLAND_HOUSE_PACKAGES; "
            "first-party payload changes would not invalidate its action"
        )
    return failures


def container_image_context_negative_controls(build_text: str) -> list[str]:
    """Prove the contract gate discriminates a missing carrier and payload set."""
    failures: list[str] = []
    without_lock = build_text.replace('        "MODULE.bazel.lock",\n', "", 1)
    if not any(
        "MODULE.bazel.lock" in failure
        for failure in container_image_context_failures(without_lock)
    ):
        failures.append(
            "container image input self-test failed: removing MODULE.bazel.lock "
            "did not trip the gate"
        )

    target = re.search(
        r'pkg_tar\(\s*name\s*=\s*"container_image_context"\s*,'
        r'(?P<body>.*?)^\)',
        build_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if target is None:
        failures.append("container image input self-test cannot find its target")
        return failures

    target_without_packages = target.group(0).replace(
        "] + TINYLAND_HOUSE_PACKAGES,",
        "],",
        1,
    )
    without_packages = (
        build_text[: target.start()]
        + target_without_packages
        + build_text[target.end() :]
    )
    if not any(
        "TINYLAND_HOUSE_PACKAGES" in failure
        for failure in container_image_context_failures(without_packages)
    ):
        failures.append(
            "container image input self-test failed: removing house payloads "
            "did not trip the gate"
        )
    return failures


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
    build_text = BUILD_BAZEL.read_text(encoding="utf-8")

    for name, version in sorted(load_inhouse_npm_specifiers().items()):
        failures.append(
            f"{name} remains an npm source specifier ({version!r}); "
            "first-party packages are Bazel-only"
        )

    for line_number in load_inhouse_lock_references():
        failures.append(
            f"pnpm-lock.yaml:{line_number} retains a first-party npm edge; "
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

    failures.extend(container_image_context_failures(build_text))
    failures.extend(container_image_context_negative_controls(build_text))

    if failures:
        print("Bazel-only ingestion check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        f"Bazel-only ingestion ok: {len(links)} first-party package(s), "
        "0 package/lock sources, complete bazel_dep/:pkg links, "
        "image context keyed by graph + payloads"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
