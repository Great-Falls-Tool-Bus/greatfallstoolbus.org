#!/usr/bin/env python3
"""Validate every .agents/skills/<name>/SKILL.md against the Anthropic SKILL.md
contract: frontmatter present, required fields (name, description), name matches
directory, description length cap (1536 chars combined with when_to_use), body
under 500 lines.

Exit 0 if all skills pass, 1 otherwise. Used by `just skills-validate` and CI.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(".").resolve()
SKILLS_DIR = ROOT / ".agents" / "skills"

DESCRIPTION_CAP = 1536
BODY_LINE_CAP = 500

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    raw, body = m.group(1), m.group(2)
    fields: dict[str, str] = {}
    key, buf = None, []
    for line in raw.splitlines():
        if re.match(r"^[a-z][a-z0-9_-]*:", line):
            if key is not None:
                fields[key] = "\n".join(buf).strip()
            key, _, rest = line.partition(":")
            buf = [rest.strip()]
        elif key is not None and (line.startswith("  ") or line.startswith("\t") or line.startswith("- ") or line.startswith("|")):
            buf.append(line.strip())
        elif key is not None:
            buf.append(line.strip())
    if key is not None:
        fields[key] = "\n".join(buf).strip()
    return fields, body


def validate(skill_dir: Path) -> list[str]:
    """Return list of error strings; empty list means pass."""
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: missing SKILL.md"]
    text = skill_md.read_text()
    parsed = parse_frontmatter(text)
    if parsed is None:
        return [f"{skill_dir.name}: SKILL.md missing YAML frontmatter (--- delimited)"]
    fields, body = parsed

    if "name" not in fields:
        errors.append(f"{skill_dir.name}: frontmatter missing 'name'")
    elif fields["name"] != skill_dir.name:
        errors.append(
            f"{skill_dir.name}: frontmatter name='{fields['name']}' != directory '{skill_dir.name}'"
        )

    if "description" not in fields:
        errors.append(f"{skill_dir.name}: frontmatter missing 'description'")
    else:
        combined = fields["description"]
        if "when_to_use" in fields:
            combined += "\n" + fields["when_to_use"]
        if len(combined) > DESCRIPTION_CAP:
            errors.append(
                f"{skill_dir.name}: description+when_to_use is {len(combined)} chars (>{DESCRIPTION_CAP})"
            )

    body_lines = body.count("\n")
    if body_lines > BODY_LINE_CAP:
        errors.append(
            f"{skill_dir.name}: SKILL.md body is {body_lines} lines (>{BODY_LINE_CAP}); move detail to reference.md"
        )

    return errors


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"[skills-validate] no {SKILLS_DIR} directory found", file=sys.stderr)
        return 1

    failures: list[str] = []
    pass_count = 0
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        errors = validate(skill_dir)
        if errors:
            failures.extend(errors)
        else:
            pass_count += 1
            print(f"PASS {skill_dir.name}")

    if failures:
        print("\nFAILURES:", file=sys.stderr)
        for e in failures:
            print(f"  - {e}", file=sys.stderr)
        print(
            f"\nSUMMARY: {pass_count} passed, {len(failures)} failures",
            file=sys.stderr,
        )
        return 1

    print(f"\nSUMMARY: {pass_count} skill(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
