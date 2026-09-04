#!/usr/bin/env python3
"""Validate the sole supported Tinyland repository manifest schema (v2)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

EXIT_VALID = 0
EXIT_INVALID = 1
EXIT_VALIDATOR_UNAVAILABLE = 2
EXIT_UNSUPPORTED_VERSION = 3
EXIT_MISSING_INPUT = 4

SCHEMA_VERSION = 2
SCHEMA_REL = "docs/schemas/tinyland-repo-manifest.v2.schema.json"


class UnsupportedSchemaVersion(Exception):
    """Raised when a document is not the v4-only repository manifest."""


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def resolve_schema(document: object) -> str:
    if not isinstance(document, dict):
        raise UnsupportedSchemaVersion("repo manifest must be a JSON object")
    declared = document.get("schema_version")
    if isinstance(declared, bool) or not isinstance(declared, (int, float)):
        raise UnsupportedSchemaVersion(
            f"schema_version must be the integer {SCHEMA_VERSION}; got {json.dumps(declared)}"
        )
    if declared != SCHEMA_VERSION:
        raise UnsupportedSchemaVersion(
            f"schema_version {declared!r} is retired; only {SCHEMA_VERSION} is supported"
        )
    return SCHEMA_REL


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("tinyland.repo.json"),
        help="Path to the repo manifest (default: tinyland.repo.json)",
    )
    parser.add_argument(
        "--print-schema",
        action="store_true",
        help="Print the sole schema path and exit without validation",
    )
    args = parser.parse_args(argv)

    manifest = args.manifest
    if not manifest.exists():
        print(f"error: repo manifest not found at {manifest}", file=sys.stderr)
        return EXIT_MISSING_INPUT
    try:
        document = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        print(f"error: {manifest} is not valid JSON: {err}", file=sys.stderr)
        return EXIT_INVALID
    try:
        schema_rel = resolve_schema(document)
    except UnsupportedSchemaVersion as err:
        print(f"error: {manifest}: {err}", file=sys.stderr)
        return EXIT_UNSUPPORTED_VERSION

    if args.print_schema:
        print(schema_rel)
        return EXIT_VALID

    root = repo_root()
    schema_path = root / schema_rel
    if not schema_path.is_file():
        print(f"error: v4 manifest schema is missing at {schema_path}", file=sys.stderr)
        return EXIT_MISSING_INPUT

    completed = subprocess.run(
        [
            sys.executable,
            str(root / "scripts" / "validate-lanes.py"),
            "--schema",
            str(schema_path),
            "--instance",
            str(manifest),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode == EXIT_VALID:
        print(f"{manifest}: valid against {schema_path.name} (schema_version=2)")
    else:
        sys.stdout.write(completed.stdout)
        sys.stderr.write(completed.stderr)
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
