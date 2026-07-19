#!/usr/bin/env python3
"""
STALL Custodian — authoritative live state + claim gate
Built per Cowork/Kyle directive 2026-06-08.

INVARIANT (non-negotiable, from Cowork):
  No outbound claim may emit without first reading current state from this
  module. Every claim-channel (PR body, README, Smithery, MCP-registry,
  Telegram, commit message) calls read_state() at emit time and uses the
  returned values, or it does not fire.

This is the first floor of OPERATION_MIND: ground truth, not a routing
kernel. Kernel routing is explicitly deferred until actuator surface grows
enough to justify it.

State schema
------------
{
  "live_cap_count": int,
  "live_version":   str,   # semver, e.g. "4.28.0"
  "last_deploy_ts": str,   # ISO-8601 UTC
  "last_updated":   str,   # ISO-8601 UTC (when this file was last written)
  "tunnel_alive":   bool,  # is cloudflared tunnel responding? updated on read
  "claim_registry": {
      "<channel_id>": {
          "cap_count":    int,
          "version":      str,
          "published_at": str,
          "notes":        str   # optional
      },
      ...
  }
}

Channel IDs
-----------
  punkpeye_pr        awesome-mcp-servers PR #7481
  smithery           Smithery registry listing
  mcp_registry       MCP registry (synaptiic.org namespace)
  readme             myriad/README.md
  telegram           Telegram heartbeat cap-count claims
  glama              Glama listing (read via PR)
  ai4finance_pr      georgezouq/awesome-ai-in-finance PR
"""
import json
import os
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NOTIFY_SH = os.path.expanduser('~/intuitek/notify.sh')

STATE_FILE = Path(__file__).parent / 'state.json'
STALL_URL  = 'https://myriad.synaptiic.org'


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_state() -> dict:
    """
    Return current custodian state. Always reads from disk so callers
    get live values, not a cached snapshot.
    Refreshes tunnel_alive on every read.
    """
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text())
        except Exception:
            state = _default_state()
    else:
        state = _default_state()

    state['tunnel_alive'] = _probe_tunnel()
    state.setdefault('claim_registry', {})
    return state


def write_state(updates: dict) -> dict:
    """
    Merge updates into current state and persist.
    Always stamps last_updated. Returns the new state.
    """
    state = read_state()
    for k, v in updates.items():
        if k == 'claim_registry' and isinstance(v, dict):
            state.setdefault('claim_registry', {}).update(v)
        else:
            state[k] = v
    state['last_updated'] = _now_iso()
    STATE_FILE.write_text(json.dumps(state, indent=2))
    return state


def record_claim(channel_id: str, cap_count: int, version: str, notes: str = '') -> dict:
    """
    Record that a claim was published to a specific channel.
    Must be called AFTER the claim is confirmed sent, not before.
    Returns the full state so callers can log what was recorded.
    """
    entry = {
        'cap_count':    cap_count,
        'version':      version,
        'published_at': _now_iso(),
        'notes':        notes,
    }
    return write_state({'claim_registry': {channel_id: entry}})


def get_live_counts() -> dict:
    """
    Return (live_cap_count, live_version, tunnel_alive) from custodian state.
    This is the single call every claim-channel must make before emitting.
    """
    s = read_state()
    return {
        'live_cap_count': s['live_cap_count'],
        'live_version':   s['live_version'],
        'last_deploy_ts': s['last_deploy_ts'],
        'tunnel_alive':   s['tunnel_alive'],
    }


def record_blocked(channel_id: str, reason: str) -> dict:
    """
    Record that a claim was blocked before emission.
    Written to custodian state so suppressed claims are visible, not silent.
    Fires best-effort Telegram. Never raises.
    """
    entry = {'blocked_at': _now_iso(), 'reason': reason}
    state = read_state()
    blocked = state.setdefault('blocked_claims', {})
    blocked.setdefault(channel_id, []).append(entry)
    result = write_state({'blocked_claims': blocked})
    try:
        msg = f'⚠️ [STALL gate] Blocked claim to {channel_id}: {reason}'
        subprocess.run(
            ['bash', NOTIFY_SH, msg],
            timeout=10,
            capture_output=True,
        )
    except Exception:
        pass
    return result


def assert_claim_safe(channel_id: str) -> dict:
    """
    Gate function: return live counts if it's safe to emit a claim to channel_id.
    Raises RuntimeError if tunnel is down (a claim of 'live' would be false).
    Logs the block to custodian state + Telegram before raising — gate failures
    are never silent.
    Returns the live counts dict so callers don't need a second call.
    """
    counts = get_live_counts()
    if not counts['tunnel_alive']:
        reason = 'STALL tunnel is DOWN — liveness claim would be false'
        record_blocked(channel_id, reason)
        raise RuntimeError(
            f'{reason}. Tunnel must be alive before emitting any liveness claim. '
            f'(channel: {channel_id})'
        )
    return counts


def refresh_cap_count() -> int:
    """
    Recount live caps from the capabilities directory and update state.
    Call this after every cap install or service restart.
    Returns the new count.
    """
    cap_dir = Path(__file__).parent.parent / 'capabilities'
    count = sum(
        1 for f in cap_dir.iterdir()
        if f.suffix == '.js' and f.name != '_TEMPLATE.js'
    )
    pkg = _read_package_version()
    write_state({
        'live_cap_count': count,
        'live_version':   pkg,
        'last_deploy_ts': _now_iso(),
    })
    return count


def _probe_tunnel() -> bool:
    """Return True if STALL tunnel responds to /health within 5 seconds."""
    try:
        req = urllib.request.Request(
            f'{STALL_URL}/health',
            headers={'User-Agent': 'aegis-custodian/1.0'},
        )
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.status == 200
    except Exception:
        return False


def _read_package_version() -> str:
    pkg_path = Path(__file__).parent.parent / 'package.json'
    try:
        return json.loads(pkg_path.read_text()).get('version', 'unknown')
    except Exception:
        return 'unknown'


def _default_state() -> dict:
    return {
        'live_cap_count': 0,
        'live_version':   'unknown',
        'last_deploy_ts': _now_iso(),
        'last_updated':   _now_iso(),
        'tunnel_alive':   False,
        'claim_registry': {},
    }


def init_state() -> dict:
    """
    One-time initialization: count caps, read version, probe tunnel, write state.
    Idempotent — safe to call on every startup.
    """
    cap_count = 0
    cap_dir = Path(__file__).parent.parent / 'capabilities'
    if cap_dir.exists():
        cap_count = sum(
            1 for f in cap_dir.iterdir()
            if f.suffix == '.js' and f.name != '_TEMPLATE.js'
        )
    version = _read_package_version()
    tunnel = _probe_tunnel()

    # Preserve existing claim_registry and last_deploy_ts if state already exists
    existing = {}
    if STATE_FILE.exists():
        try:
            existing = json.loads(STATE_FILE.read_text())
        except Exception:
            pass

    state = {
        'live_cap_count': cap_count,
        'live_version':   version,
        'last_deploy_ts': existing.get('last_deploy_ts', _now_iso()),
        'last_updated':   _now_iso(),
        'tunnel_alive':   tunnel,
        'claim_registry': existing.get('claim_registry', {}),
    }
    STATE_FILE.write_text(json.dumps(state, indent=2))
    return state


if __name__ == '__main__':
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'

    if cmd == 'init':
        s = init_state()
        print(json.dumps(s, indent=2))
    elif cmd == 'refresh':
        count = refresh_cap_count()
        print(f'Cap count refreshed: {count}')
        print(json.dumps(read_state(), indent=2))
    elif cmd == 'status':
        print(json.dumps(read_state(), indent=2))
    elif cmd == 'gate':
        channel = sys.argv[2] if len(sys.argv) > 2 else 'unknown'
        try:
            counts = assert_claim_safe(channel)
            print(json.dumps(counts))
        except RuntimeError as e:
            print(f'GATE_BLOCKED: {e}', file=sys.stderr)
            sys.exit(1)
    elif cmd == 'blocked':
        s = read_state()
        print(json.dumps(s.get('blocked_claims', {}), indent=2))
    else:
        print(f'Unknown command: {cmd}. Use: init | refresh | status | gate <channel> | blocked', file=sys.stderr)
        sys.exit(1)
