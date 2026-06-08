#!/usr/bin/env python3
"""
Wire-in: readme channel claim gate.

Usage: python3 custodian/wire_readme.py
       python3 custodian/wire_readme.py --dry-run

Calls assert_claim_safe('readme') — blocks if tunnel is down (liveness claim).
Reads README.md, substitutes cap count + version in the capabilities header line.
Stages (git add) and records claim only on successful write. Does NOT commit —
commit is a separate step (use wire_commit.py).

Target line format: "## Current capabilities — N live tools (vX.Y.Z)"
"""
import re
import sys
import subprocess
from pathlib import Path

_here = Path(__file__).parent
sys.path.insert(0, str(_here.parent))
from custodian.custodian import assert_claim_safe, record_claim, record_blocked  # noqa: E402

README_PATH = _here.parent / 'README.md'
CAP_LINE_RE = re.compile(
    r'^(## Current capabilities — )\d+ live tools \(v[^\)]+\)',
    re.MULTILINE,
)


def wire_readme(dry_run: bool = False) -> int:
    try:
        counts = assert_claim_safe('readme')
    except RuntimeError as e:
        print(f"❌ [wire_readme] Gate blocked: {e}", file=sys.stderr)
        return 1

    cap_count = counts['live_cap_count']
    version   = counts['live_version']
    new_line  = f"## Current capabilities — {cap_count} live tools (v{version})"

    if not README_PATH.exists():
        record_blocked('readme', f'README.md not found at {README_PATH}')
        print(f"❌ [wire_readme] README.md not found at {README_PATH}", file=sys.stderr)
        return 1

    text = README_PATH.read_text()
    if not CAP_LINE_RE.search(text):
        record_blocked('readme', 'Cap-count header line not found in README.md — pattern mismatch')
        print("❌ [wire_readme] Cap-count header line not found in README.md", file=sys.stderr)
        return 1

    new_text = CAP_LINE_RE.sub(new_line, text)
    print(f"[wire_readme] Will write: {new_line!r}")

    if dry_run:
        print("[wire_readme] DRY-RUN — file not changed, no claim recorded.")
        return 0

    README_PATH.write_text(new_text)

    git_add = subprocess.run(
        ['git', 'add', str(README_PATH)],
        capture_output=True, text=True,
        cwd=str(_here.parent),
    )
    if git_add.returncode != 0:
        record_blocked('readme', f'git add failed: {git_add.stderr.strip()}')
        print(f"❌ [wire_readme] git add failed: {git_add.stderr}", file=sys.stderr)
        return git_add.returncode

    record_claim('readme', cap_count, version, notes='README.md cap-count line updated and staged')
    print(f"✅ [wire_readme] README updated, staged, and claim recorded: {cap_count} caps v{version}")
    return 0


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    sys.exit(wire_readme(dry_run=dry))
