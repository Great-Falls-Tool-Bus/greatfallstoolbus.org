#!/usr/bin/env python3
"""Validate .github/lanes.json against docs/schemas/lanes.schema.json.

Used by `just lanes-validate`. Exits 0 on valid, non-zero with a
human-readable error path on invalid. Requires the `jsonschema` package
(shipped via the nix devShell's python3Packages.jsonschema input).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("docs/schemas/lanes.schema.json"),
        help="Path to the JSON Schema (default: docs/schemas/lanes.schema.json)",
    )
    parser.add_argument(
        "--instance",
        type=Path,
        default=Path(".github/lanes.json"),
        help="Path to the lanes.json file to validate (default: .github/lanes.json)",
    )
    args = parser.parse_args()

    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        print(
            "error: `jsonschema` not installed. Run inside `nix develop`.",
            file=sys.stderr,
        )
        return 2

    if not args.schema.exists():
        print(f"error: schema not found at {args.schema}", file=sys.stderr)
        return 2
    if not args.instance.exists():
        print(f"error: instance not found at {args.instance}", file=sys.stderr)
        return 2

    schema = json.loads(args.schema.read_text())
    instance = json.loads(args.instance.read_text())

    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))

    if not errors:
        print(f"{args.instance}: valid against {args.schema}")
        return 0

    for err in errors:
        path = "/" + "/".join(str(p) for p in err.absolute_path) if err.absolute_path else "/"
        print(f"  at {path}: {err.message}", file=sys.stderr)
    print(f"{args.instance}: {len(errors)} validation error(s)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
