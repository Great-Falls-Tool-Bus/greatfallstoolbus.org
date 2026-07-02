#!/usr/bin/env python3
"""Construct + (optionally) dispatch the Blahaj `<spoke>-lane-env` payload.

Reads .github/lanes.json, builds a payload conforming to
docs/schemas/blahaj-dispatch.schema.json, and prints it to stdout. With
--dispatch, also POSTs via `gh api` (requires gh CLI auth).

Used by `just lane-dispatch <pr>` and `just lane-reap <pr>`. Production
dispatch in CI uses the equivalent composite action
tinyland-inc/ci-templates/.github/actions/lane-dispatch.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


def load_lanes(path: Path) -> dict[str, Any]:
    if not path.exists():
        print(f"error: lanes.json not found at {path}", file=sys.stderr)
        sys.exit(2)
    return json.loads(path.read_text())


def filter_lanes(lanes: list[dict[str, Any]], filter_spec: str) -> list[dict[str, Any]]:
    """Filter lanes by comma-separated name list, or `all` (default)."""
    if not filter_spec or filter_spec.lower() == "all":
        return lanes
    wanted = {s.strip() for s in filter_spec.split(",") if s.strip()}
    selected = [ln for ln in lanes if ln["name"] in wanted]
    missing = wanted - {ln["name"] for ln in selected}
    if missing:
        print(f"error: unknown lane name(s): {sorted(missing)}", file=sys.stderr)
        sys.exit(2)
    return selected


def resolve_ttl(defaults: dict[str, Any], lane: dict[str, Any], label_override_hours: int | None) -> int:
    """Apply lane > defaults > schema default. Per-PR label override raises (never lowers)."""
    base = lane.get("ttl_hours") or defaults.get("ttl_hours", 72)
    if label_override_hours is None:
        return base
    if label_override_hours < base:
        print(
            f"warning: per-PR label TTL {label_override_hours}h is lower than base {base}h; "
            "TTL is a floor, ignoring override.",
            file=sys.stderr,
        )
        return base
    return min(label_override_hours, 720)


def build_payload(
    config: dict[str, Any],
    *,
    pr_number: int,
    commit_sha: str,
    operation: str,
    image_ref: str,
    selected_lanes: list[dict[str, Any]],
    ttl_override_hours: int | None,
) -> dict[str, Any]:
    spoke = config["spoke"]
    defaults = config.get("defaults", {})

    event_type = f"{spoke['name']}-lane-env"

    payload_lanes: list[dict[str, Any]] = []
    for lane in selected_lanes:
        fqdn = lane.get("domain") or f"pr-{pr_number}-{lane['name']}.{spoke['domain']}"
        ln: dict[str, Any] = {"name": lane["name"], "fqdn": fqdn}
        for k in ("theme", "snapshot_source", "tofu_state_suffix", "e2e", "extra"):
            if k in lane:
                ln[k] = lane[k]
        ln["ttl_hours"] = resolve_ttl(defaults, lane, ttl_override_hours)
        payload_lanes.append(ln)

    # Aggregate TTL: max of per-lane TTL (Blahaj uses payload top-level as default).
    top_ttl = max((ln["ttl_hours"] for ln in payload_lanes), default=72)

    client_payload: dict[str, Any] = {
        "schema_version": 1,
        "operation": operation,
        "spoke": spoke["name"],
        "pr_number": pr_number,
        "source_ref": f"refs/pull/{pr_number}/head",
        "commit_sha": commit_sha,
        "image_ref": image_ref,
        "ttl_hours": 1 if operation == "destroy" else top_ttl,
        "tofu_state_prefix": f"{spoke['name']}/{pr_number}",
        "lanes": payload_lanes,
    }
    if "domain" in spoke:
        client_payload["domain"] = spoke["domain"]

    return {"event_type": event_type, "client_payload": client_payload}


def parse_ttl_label(label: str | None) -> int | None:
    """Parse `lane-ttl/<N>d` or `lane-ttl/keep` → hours, or None."""
    if not label:
        return None
    m = re.match(r"^lane-ttl/(\d+)d$", label)
    if m:
        return int(m.group(1)) * 24
    if label == "lane-ttl/keep":
        return 720
    print(f"warning: unrecognized TTL label '{label}', ignoring", file=sys.stderr)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", type=int, required=True, help="PR number")
    parser.add_argument("--lanes-file", type=Path, default=Path(".github/lanes.json"))
    parser.add_argument("--filter", default="all", help="Comma-separated lane names, or `all`")
    parser.add_argument("--commit-sha", default="0" * 40, help="Full commit SHA (40 hex chars)")
    parser.add_argument("--image-ref", default="", help="Full GHCR image ref")
    parser.add_argument("--reap", action="store_true", help="Emit destroy payload instead of provision")
    parser.add_argument("--ttl-label", default=None, help="Per-PR TTL label, e.g. lane-ttl/7d")
    parser.add_argument("--blahaj-repo", default="tinyland-inc/blahaj")
    parser.add_argument(
        "--dispatch",
        action="store_true",
        help="Actually POST via `gh api` (default: dry-run, print only)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Alias for the default; explicitly print only.",
    )
    args = parser.parse_args()

    if args.dispatch and args.dry_run:
        print("error: --dispatch and --dry-run are mutually exclusive", file=sys.stderr)
        return 2

    config = load_lanes(args.lanes_file)
    selected = filter_lanes(config["lanes"], args.filter)

    operation = "destroy" if args.reap else "provision"
    image_ref = args.image_ref or (
        "expired-destroy"
        if args.reap
        else f"ghcr.io/<owner>/{config['spoke']['name']}:pr-{args.pr}-sha-{args.commit_sha[:12]}"
    )

    payload = build_payload(
        config,
        pr_number=args.pr,
        commit_sha=args.commit_sha,
        operation=operation,
        image_ref=image_ref,
        selected_lanes=selected,
        ttl_override_hours=parse_ttl_label(args.ttl_label),
    )

    print(json.dumps(payload, indent=2))

    if args.dispatch:
        confirm = os.environ.get("REAP_CONFIRM") if args.reap else "1"
        if not confirm:
            print(
                "\nrefuse: --reap --dispatch requires REAP_CONFIRM=1 in env",
                file=sys.stderr,
            )
            return 2
        cmd = [
            "gh",
            "api",
            f"/repos/{args.blahaj_repo}/dispatches",
            "-X",
            "POST",
            "--input",
            "-",
        ]
        proc = subprocess.run(cmd, input=json.dumps(payload), text=True, check=False)
        return proc.returncode

    return 0


if __name__ == "__main__":
    sys.exit(main())
