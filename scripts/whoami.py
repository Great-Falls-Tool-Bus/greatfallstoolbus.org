#!/usr/bin/env python3
"""Print a Tinyland repo orientation block for cold-landing agents.

Reads `tinyland.repo.json` when present; falls back to filesystem heuristics
when absent. Exit 0 on a confident classification, exit 1 on heuristic fallback,
exit 2 on unknown.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("TINYLAND_REPO_ROOT", ".")).resolve()

ROLE_SKILLS: dict[str, list[str]] = {
    "hub": ["tinyland-repo-contract"],
    "static-spoke": [
        "tinyland-repo-contract",
        "tinyland-static-spoke",
        "tinyland-flywheel-bazel",
    ],
    "static-spoke-scaffold": [
        "tinyland-repo-contract",
        "tinyland-static-spoke",
        "tinyland-flywheel-bazel",
        "tinyland-spawn-sister-site",
        "tinyland-scaffold-doctor",
    ],
    "dynamic-spoke": ["tinyland-repo-contract"],
    "package-producer": ["tinyland-repo-contract", "tinyland-flywheel-bazel"],
    "package-authority": ["tinyland-repo-contract"],
    "infra": ["tinyland-repo-contract"],
    "tooling": ["tinyland-repo-contract"],
    "business-internal": ["tinyland-repo-contract"],
}

ROLE_RISKS: dict[str, str] = {
    "hub": "do not import static-spoke restrictions; owns auth/payments/AP delivery",
    "static-spoke": "must NOT own auth, payments, AP delivery, runtime broker fetches, or Cloudflare API creds",
    "static-spoke-scaffold": "same as static-spoke; this repo also templates new spokes",
    "dynamic-spoke": "owns its own data store; consumes hub auth only",
    "package-producer": "publishes into tinyland-inc/bazel-registry; consumers pin exact versions",
    "package-authority": "registry integrity; no consumer logic",
    "infra": "GitOps receiver; cluster authority; per-repo AGENTS.md is load-bearing",
    "tooling": "templates and validates other repos; meta-layer",
    "business-internal": "private; entity-scoped; never federate publicly",
}


def read_manifest() -> dict | None:
    path = ROOT / "tinyland.repo.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"[whoami] tinyland.repo.json is malformed: {e}", file=sys.stderr)
        return None


def heuristic_role() -> tuple[str, list[str]]:
    """Return (role, evidence-lines)."""
    evidence = []
    has_ap = (ROOT / ".activitypub" / "actors").is_dir()
    has_static_spoke_signal = False
    has_dynamic_signal = False
    has_bazel_module = (ROOT / "MODULE.bazel").is_file()
    has_bazel_registry_layout = (ROOT / "modules").is_dir() and any(
        (ROOT / "modules").glob("*/[0-9]*/MODULE.bazel")
    )
    has_kustomize = (ROOT / "deploy").is_dir() or (ROOT / "kustomize").is_dir()
    has_tofu = (ROOT / "tofu").is_dir()
    has_gnucash = any(ROOT.glob("*.gnucash"))
    has_ci_templates = (ROOT / ".github" / "actions").is_dir()

    svelte_config = ROOT / "svelte.config.js"
    if svelte_config.is_file():
        body = svelte_config.read_text()
        if "adapter-static" in body:
            has_static_spoke_signal = True
            evidence.append("svelte.config.js uses adapter-static")
        if "adapter-node" in body:
            has_dynamic_signal = True
            evidence.append("svelte.config.js uses adapter-node")

    if has_ap:
        evidence.append(".activitypub/ present")
        return "hub", evidence
    if has_static_spoke_signal and has_bazel_module:
        evidence.append("MODULE.bazel present (likely consuming tummycrypt_tinyland_*)")
        return "static-spoke", evidence
    if has_dynamic_signal:
        return "dynamic-spoke", evidence
    if has_bazel_registry_layout:
        evidence.append("BCR-shaped modules/ layout")
        return "package-authority", evidence
    if has_bazel_module:
        body = (ROOT / "MODULE.bazel").read_text()
        if 'module(name = "tummycrypt_' in body or 'module(name = "tinyland_' in body:
            evidence.append("MODULE.bazel declares a tummycrypt_/tinyland_ module")
            return "package-producer", evidence
    if has_kustomize or has_tofu:
        evidence.append("deploy/ or tofu/ present")
        return "infra", evidence
    if has_ci_templates and not (ROOT / "src").is_dir():
        evidence.append(".github/actions/ present, no src/")
        return "tooling", evidence
    if has_gnucash:
        evidence.append(".gnucash file present")
        return "business-internal", evidence

    return "unknown", evidence


def render(
    *,
    role: str,
    source: str,
    owns: list[str],
    defers_to: dict[str, str],
    skills: list[str],
    risks: str,
    evidence: list[str] | None = None,
) -> str:
    lines = [
        f"Role:        {role}    (source: {source})",
        f"Owns:        {', '.join(owns) if owns else '(nothing — read-only consumer)'}",
    ]
    if defers_to:
        lines.append(
            "Defers to:   "
            + ", ".join(f"{k}={v}" for k, v in defers_to.items())
        )
    lines.append("First read:  AGENTS.md, docs/CI-SCHEMA.md (if present), Justfile")
    lines.append("Skills:      " + ", ".join(skills) if skills else "Skills:      (none mapped)")
    lines.append(f"Risks:       {risks}")
    if evidence:
        lines.append("Evidence:    " + "; ".join(evidence))
    return "\n".join(lines)


def main() -> int:
    manifest = read_manifest()
    if manifest is not None:
        role = manifest.get("taxonomy", {}).get("primary_role", "unknown")
        boundaries = manifest.get("boundaries", {})
        owns = [k.removeprefix("owns_") for k, v in boundaries.items() if v]
        defers_to = manifest.get("authorities", {})
        skills = ROLE_SKILLS.get(role, ["tinyland-repo-contract"])
        risks = ROLE_RISKS.get(role, "(no canned risk line for this role)")
        print(
            render(
                role=role,
                source="tinyland.repo.json",
                owns=owns,
                defers_to=defers_to,
                skills=skills,
                risks=risks,
            )
        )
        return 0

    role, evidence = heuristic_role()
    skills = ROLE_SKILLS.get(role, [])
    risks = ROLE_RISKS.get(role, "(unknown — ask the user before editing)")
    print(
        render(
            role=role,
            source="heuristic",
            owns=[],
            defers_to={},
            skills=skills,
            risks=risks,
            evidence=evidence,
        )
    )
    print(
        "\n[whoami] tinyland.repo.json is absent. Consider authoring one — "
        "see docs/schemas/tinyland-repo-manifest.schema.json.",
        file=sys.stderr,
    )
    return 1 if role != "unknown" else 2


if __name__ == "__main__":
    sys.exit(main())
