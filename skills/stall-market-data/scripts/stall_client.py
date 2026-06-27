#!/usr/bin/env python3
"""
stall_client.py — STALL x402 capability client for Hermes agents.

Usage:
  python3 stall_client.py caps                              # list all caps
  python3 stall_client.py call <cap_name> [--key val ...]  # call a paid cap

Environment:
  STALL_WALLET_KEY  — agent wallet private key (Base/USDC) for x402 settlement
                      Required only for `call`. Set via Hermes required_environment_variables.

Payment: pip install eth-account (one-time, if not already present)
Security: credentials never written to stdout; only declared env vars used.
"""

import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.parse
import urllib.error

STALL_URL = "https://the-stall.intuitek.ai"
USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
CHAIN_ID = 8453  # Base mainnet
MAX_SPEND_USDC = 0.50  # per-call ceiling; refuse if 402 asks for more


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------

def _request(method, path, params=None, headers=None, body=None):
    url = STALL_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    if body:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")


# ---------------------------------------------------------------------------
# caps command — pure stdlib, no wallet needed
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# EIP-3009 signing (requires eth-account)
# ---------------------------------------------------------------------------

def _load_signer():
    try:
        from eth_account import Account  # type: ignore
        return Account
    except ImportError:
        _die(
            "eth-account required for paid calls",
            "Run: pip install eth-account\nThen retry.",
        )


def _sign_eip3009(wallet_key, from_addr, pay_to, amount_units, valid_before):
    Account = _load_signer()
    nonce = "0x" + uuid.uuid4().hex.zfill(64)
    typed_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": "USD Coin",
            "version": "2",
            "chainId": CHAIN_ID,
            "verifyingContract": USDC_CONTRACT,
        },
        "message": {
            "from": from_addr,
            "to": pay_to,
            "value": amount_units,
            "validAfter": 0,
            "validBefore": valid_before,
            "nonce": nonce,
        },
    }
    acct = Account.from_key(wallet_key)
    signed = acct.sign_typed_data(typed_data)
    return {
        "from": from_addr,
        "to": pay_to,
        "value": amount_units,
        "validAfter": 0,
        "validBefore": valid_before,
        "nonce": nonce,
        "signature": signed.signature.hex(),
    }


# ---------------------------------------------------------------------------
# call command — x402 payment flow
# ---------------------------------------------------------------------------

def cmd_call(cap_name, params):
    # Step 1: probe — GET without payment → 402
    status, data = _request("GET", f"/cap/{cap_name}", params=params or {})
    if status == 200:
        print(json.dumps(data, indent=2))
        return
    if status != 402:
        _die(f"Unexpected HTTP {status} from cap '{cap_name}'", data)

    # Step 2: parse payment requirements
    accepts = (data.get("accepts") or [{}])[0]
    amount_str = (accepts.get("maxAmountRequired") or accepts.get("amount") or "0")
    amount_units = int(amount_str)  # USDC atomic units (6 decimals)
    amount_usdc = amount_units / 1_000_000

    if amount_usdc > MAX_SPEND_USDC:
        _die(
            f"Cap '{cap_name}' costs ${amount_usdc:.6f} — exceeds ceiling ${MAX_SPEND_USDC:.2f}",
            "Raise MAX_SPEND_USDC in the script if you intend this spend.",
        )

    pay_to = accepts.get("payTo") or accepts.get("extra", {}).get("payTo")
    if not pay_to:
        _die("402 response missing payTo address", data)

    network = accepts.get("network", "")
    if "8453" not in network and "base" not in network.lower():
        _die(f"Unexpected network in 402: {network} (expected Base/8453)", data)

    # Step 3: sign EIP-3009 authorization
    wallet_key = os.environ.get("STALL_WALLET_KEY", "")
    if not wallet_key:
        _die("STALL_WALLET_KEY not set", "Set it via Hermes required_environment_variables.")

    Account = _load_signer()
    acct = Account.from_key(wallet_key)
    from_addr = acct.address
    valid_before = int(time.time()) + 300  # 5-minute window

    auth = _sign_eip3009(wallet_key, from_addr, pay_to, amount_units, valid_before)

    # Step 4: build x402 payment payload and submit to facilitator
    facilitator_url = "https://api.cdp.coinbase.com/platform/v2/x402/settle"
    payment_payload = {
        "x402Version": 2,
        "payload": {
            "authorization": auth,
            "signature": auth["signature"],
        },
        "resource": f"{STALL_URL}/cap/{cap_name}",
        "accepted": accepts,
    }

    import base64 as _b64
    encoded_payment = _b64.b64encode(json.dumps(payment_payload).encode()).decode()

    # Step 5: re-request with X-PAYMENT header
    status2, data2 = _request(
        "GET",
        f"/cap/{cap_name}",
        params=params or {},
        headers={"X-PAYMENT": encoded_payment},
    )

    if status2 == 200:
        print(json.dumps(data2, indent=2))
    else:
        _die(f"Payment failed: HTTP {status2}", data2)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _die(msg, detail=None):
    err = {"error": msg}
    if detail:
        err["detail"] = detail if isinstance(detail, str) else json.dumps(detail)
    print(json.dumps(err), file=sys.stderr)
    sys.exit(1)


def _parse_args(argv):
    """Parse --key value pairs into a dict."""
    params = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                params[key] = argv[i + 1]
                i += 2
            else:
                params[key] = "true"
                i += 1
        else:
            i += 1
    return params


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    if cmd == "caps":
        cmd_caps()
    elif cmd == "call":
        if len(sys.argv) < 3:
            _die("Usage: stall_client.py call <cap_name> [--key val ...]")
        cap_name = sys.argv[2]
        params = _parse_args(sys.argv[3:])
        cmd_call(cap_name, params)
    else:
        _die(f"Unknown command: {cmd}", "Use: caps | call <cap_name>")


if __name__ == "__main__":
    main()
