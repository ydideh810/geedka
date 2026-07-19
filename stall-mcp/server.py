#!/usr/bin/env python3
"""
stall-mcp — FastMCP server wrapping MYRIAD market-data caps.

Runs as stdio MCP server. Adds to Hermes mcp_servers config:
  {"stall-mcp": {"command": "python3", "args": ["/path/to/stall-mcp/server.py"]}}

All caps accessible as MCP tools. Payment via standard HTTP-402 — no secret stored here.
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    raise SystemExit("pip install mcp")

MYRIAD_URL = os.environ.get("MYRIAD_ENDPOINT", "https://myriad.synaptiic.org")

mcp = FastMCP("stall-mcp")


def _get(path, params=None, headers=None):
    url = MYRIAD_URL + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw.decode(errors="replace")}


@mcp.tool()
def list_caps() -> str:
    """List all available MYRIAD market-data caps with names and prices."""
    status, data = _get("/catalog")
    if status != 200:
        return json.dumps({"error": f"HTTP {status}", "detail": data})
    caps = data if isinstance(data, list) else data.get("capabilities", data.get("caps", []))
    out = [{"name": c.get("name"), "price": c.get("price"),
            "description": (c.get("description") or "")[:120]} for c in caps]
    return json.dumps(out, indent=2)


@mcp.tool()
def call_cap(
    cap_name: str,
    x_payment: str = "",
    ticker: str = "",
    tickers: str = "",
    query: str = "",
    week: str = "",
    address: str = "",
    period: str = "",
    extra_params: str = "",
) -> str:
    """
    Call a MYRIAD market-data cap. Returns data on success or a 402 payment challenge.

    Args:
        cap_name: Cap identifier (e.g. us-stock-price, earnings-calendar)
        x_payment: Payment token from your payment skill (stripe-link-cli / mpp-agent). Leave empty for probe.
        ticker: Single ticker symbol (e.g. AAPL)
        tickers: Comma-separated tickers for batch caps
        query: Research query string
        week: Week specification (e.g. current, next)
        address: Wallet or contract address for on-chain caps
        period: Period specification (annual, quarterly)
        extra_params: JSON string of additional key=value params
    """
    params = {}
    if ticker:
        params["ticker"] = ticker
    if tickers:
        params["tickers"] = tickers
    if query:
        params["query"] = query
    if week:
        params["week"] = week
    if address:
        params["address"] = address
    if period:
        params["period"] = period
    if extra_params:
        try:
            params.update(json.loads(extra_params))
        except Exception:
            pass

    headers = {}
    if x_payment:
        headers["X-PAYMENT"] = x_payment

    status, data = _get(f"/cap/{cap_name}", params=params, headers=headers)

    if status == 200:
        return json.dumps(data, indent=2)

    if status == 402:
        return json.dumps({
            "payment_required": True,
            "cap": cap_name,
            "challenge": data,
            "instructions": (
                f"Pass this challenge to stripe-link-cli or mpp-agent to settle payment. "
                f"Then re-call with x_payment=<token>."
            ),
        }, indent=2)

    return json.dumps({"error": f"HTTP {status}", "detail": data})


@mcp.tool()
def get_cap_info(cap_name: str) -> str:
    """Get metadata for a specific MYRIAD cap including price and description."""
    status, data = _get("/catalog")
    if status != 200:
        return json.dumps({"error": f"HTTP {status}"})
    caps = data if isinstance(data, list) else data.get("capabilities", data.get("caps", []))
    match = next((c for c in caps if c.get("name") == cap_name), None)
    if not match:
        return json.dumps({"error": f"Cap '{cap_name}' not found"})
    return json.dumps(match, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
