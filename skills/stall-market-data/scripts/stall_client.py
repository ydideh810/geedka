#!/usr/bin/env python3
"""
stall_client.py v2 — STALL market-data skill client for Hermes agents.

Usage:
  python3 stall_client.py caps                                    # list all caps + prices
  python3 stall_client.py call <cap_name> [--key val ...]        # probe cap; surface 402 challenge if payment needed
  python3 stall_client.py call <cap_name> --x-payment <token> [--key val ...]  # submit payment token

Payment: This script surfaces the HTTP-402 challenge for your agent's payment skill
(stripe-link-cli or mpp-agent) to settle. No wallet key is read or stored here.
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error

STALL_URL = "https://the-stall.intuitek.ai"


def _request(method, path, params=None, headers=None):
    url = STALL_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")


def cmd_caps():
    status, data = _request("GET", "/catalog")
    if status != 200:
        _die(f"catalog fetch failed: HTTP {status}", data)
    caps = data if isinstance(data, list) else data.get("capabilities", data.get("caps", []))
    out = []
    for c in caps:
        out.append({
            "name": c.get("name"),
            "price": c.get("price"),
            "description": (c.get("description") or "")[:100],
        })
    print(json.dumps(out, indent=2))


def cmd_call(cap_name, params, x_payment=None):
    headers = {}
    if x_payment:
        headers["X-PAYMENT"] = x_payment

    status, data = _request("GET", f"/cap/{cap_name}", params=params or {}, headers=headers)

    if status == 200:
        print(json.dumps(data, indent=2))
        return

    if status == 402:
        accepts = (data.get("accepts") or [{}])
        challenge = {
            "payment_required": True,
            "cap": cap_name,
            "challenge": data,
            "instructions": (
                "Pass the challenge to your payment skill (stripe-link-cli or mpp-agent) "
                "to settle. Then re-run: python3 stall_client.py call "
                f"{cap_name} --x-payment <payment_token>"
            ),
        }
        print(json.dumps(challenge, indent=2))
        sys.exit(2)

    _die(f"HTTP {status} from cap '{cap_name}'", data)


def _die(msg, detail=None):
    err = {"error": msg}
    if detail:
        err["detail"] = detail if isinstance(detail, str) else json.dumps(detail)
    print(json.dumps(err), file=sys.stderr)
    sys.exit(1)


def _parse_args(argv):
    params = {}
    x_payment = None
    i = 0
    while i < len(argv):
        if argv[i] == "--x-payment" and i + 1 < len(argv):
            x_payment = argv[i + 1]
            i += 2
        elif argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                params[key] = argv[i + 1]
                i += 2
            else:
                params[key] = "true"
                i += 1
        else:
            i += 1
    return params, x_payment


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    if cmd == "caps":
        cmd_caps()
    elif cmd == "call":
        if len(sys.argv) < 3:
            _die("Usage: stall_client.py call <cap_name> [--key val ...] [--x-payment <token>]")
        cap_name = sys.argv[2]
        params, x_payment = _parse_args(sys.argv[3:])
        cmd_call(cap_name, params, x_payment)
    else:
        _die(f"Unknown command: {cmd}", "Use: caps | call <cap_name>")


if __name__ == "__main__":
    main()
