#!/usr/bin/env python3
"""
Wire-in: telegram channel claim gate.

Usage: python3 custodian/wire_telegram.py <message_template>
       python3 custodian/wire_telegram.py --dry-run <message_template>

Only for Telegram messages that assert a specific cap count or version.
Templates may contain {count} and {version} — both are substituted from custodian.
Routine heartbeat messages without count assertions do NOT use this gate.

Calls get_live_counts() (not assert_claim_safe — Telegram is Kyle-only, low blast
radius even if tunnel is down; tunnel state is included in the message so Kyle can see it).

Records claim only on confirmed Telegram send (notify.sh exit 0).
"""
import os
import sys
import subprocess
from pathlib import Path

_here = Path(__file__).parent
sys.path.insert(0, str(_here.parent))
from custodian.custodian import get_live_counts, record_claim  # noqa: E402

NOTIFY_SH = os.path.expanduser('~/intuitek/notify.sh')


def wire_telegram(template: str, dry_run: bool = False) -> int:
    counts = get_live_counts()
    cap_count = counts['live_cap_count']
    version   = counts['live_version']
    tunnel    = counts['tunnel_alive']

    msg = template.format(
        count=cap_count,
        version=version,
        tunnel='UP' if tunnel else 'DOWN',
    )

    print(f"[wire_telegram] Live counts: {cap_count} caps / v{version} / tunnel={'UP' if tunnel else 'DOWN'}")
    print(f"[wire_telegram] Message: {msg!r}")

    if dry_run:
        print("[wire_telegram] DRY-RUN — message not sent, no claim recorded.")
        return 0

    result = subprocess.run(
        ['bash', NOTIFY_SH, msg],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        record_claim('telegram', cap_count, version, notes=f'msg: {msg[:80]}')
        print(f"✅ [wire_telegram] Sent and recorded.")
        return 0
    else:
        print(f"❌ [wire_telegram] notify.sh failed (exit {result.returncode}): {result.stderr}", file=sys.stderr)
        return result.returncode


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    dry = '--dry-run' in args
    tmpl_args = [a for a in args if not a.startswith('--')]
    if not tmpl_args:
        print("Error: message_template required.", file=sys.stderr)
        sys.exit(1)
    sys.exit(wire_telegram(tmpl_args[0], dry_run=dry))
