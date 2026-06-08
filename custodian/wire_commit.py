#!/usr/bin/env python3
"""
Wire-in: commit channel claim gate.

Usage: python3 custodian/wire_commit.py <cap_name>
       python3 custodian/wire_commit.py <cap_name> --dry-run

Gets live cap_count from custodian (no tunnel gate — commit messages don't assert
liveness, only count). Builds commit message, runs git commit, records claim on
exit 0 only. Does NOT push — push is a separate, explicit step.
"""
import sys
import subprocess
from pathlib import Path

_here = Path(__file__).parent
sys.path.insert(0, str(_here.parent))
from custodian.custodian import get_live_counts, record_claim  # noqa: E402


def wire_commit(cap_name: str, dry_run: bool = False, extra_notes: str = '') -> int:
    counts = get_live_counts()
    cap_count = counts['live_cap_count']
    version   = counts['live_version']
    msg       = f"feat: add {cap_name} ({cap_count} caps total)"

    print(f"[wire_commit] Live counts: {cap_count} caps / v{version}")
    print(f"[wire_commit] Commit message: {msg!r}")

    if dry_run:
        print("[wire_commit] DRY-RUN — no commit made, no record written.")
        return 0

    result = subprocess.run(
        ['git', 'commit', '-m', msg],
        capture_output=True, text=True,
        cwd=str(_here.parent),
    )
    if result.returncode == 0:
        record_claim('commit', cap_count, version, notes=f'cap: {cap_name}' + (f' | {extra_notes}' if extra_notes else ''))
        print(f"✅ [wire_commit] Committed and recorded: {msg}")
        return 0
    else:
        print(f"❌ [wire_commit] git commit failed (exit {result.returncode}):", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return result.returncode


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    dry = '--dry-run' in args
    name_args = [a for a in args if not a.startswith('--')]
    if not name_args:
        print("Error: cap_name required.", file=sys.stderr)
        sys.exit(1)
    sys.exit(wire_commit(name_args[0], dry_run=dry))
