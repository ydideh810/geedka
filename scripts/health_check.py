#!/usr/bin/env python3
"""
health_check.py — End-to-end capability health check for The Stall.

For each capability registered in /health:
  1. Verify it returns 402 (registered, x402-gated) on GET /cap/<name>
  2. Call it via the free MCP interface with a generic test payload
  3. Confirm the handler returns without error

Reports pass/fail per cap. Sends Telegram on any failure.

Run: python3 ~/intuitek/the-stall/scripts/health_check.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

BASE_URL = os.environ.get("STALL_BASE_URL", "http://localhost:4021")

# Minimal test inputs per cap — fall through to empty {} for caps with no required fields
CAP_TEST_INPUTS = {
    "ping":                  {"msg": "health-check"},
    "weather":               {"location": "New York, NY"},
    "geocode":               {"location": "San Francisco, CA"},
    "crypto-fiat-price":     {"symbol": "BTC"},
    "us-stock-price":        {"ticker": "AAPL"},
    "eth-block":             {},
    "gas-prices":            {},
    "dns-lookup":            {"domain": "google.com"},
    "timezone":              {"timezone": "America/Chicago"},
    "country-info":          {"country": "US"},
    "unit-converter":        {"value": 1, "from_unit": "kg", "to_unit": "lb"},
    "regex-tester":          {"pattern": r"\d+", "text": "hello 42 world"},
    "ip-intel":              {"ip": "8.8.8.8"},
    "http-headers":          {"url": "https://httpbin.org/get"},
    "ssl-cert":              {"domain": "google.com"},
    "domain-whois":          {"domain": "google.com"},
    "email-verify":          {"email": "test@gmail.com"},
    "web-change-monitor":    {"url": "https://httpbin.org/get"},
    "research-paper-search": {"query": "machine learning"},
    "rss-reader":            {"url": "https://feeds.bbci.co.uk/news/rss.xml"},
    "hn-search":             {"query": "AI agents"},
    "reddit-intel":          {"query": "bitcoin", "subreddit": "cryptocurrency"},
    "npm-lookup":            {"package": "express"},
    "pypi-lookup":           {"package": "requests"},
    "github-repo-intel":     {"repo": "anthropics/anthropic-sdk-python"},
    "city-lookup":           {"query": "Chicago"},
    "classic-novels":        {"query": "great expectations"},
    "unit-converter":        {"value": 100, "from_unit": "F", "to_unit": "C"},
    "chromatic-dispersion":  {"fiber_type": "SMF-28", "wavelength_nm": 1550, "length_km": 10},
    "breadcrumb-extractor":  {"url": "https://docs.anthropic.com/en/api/getting-started"},
    "json-extract":          {"text": '{"name": "test", "value": 42}', "query": "name"},
    "page-intel":            {"url": "https://httpbin.org/get"},
    "readable-content":      {"url": "https://httpbin.org/get"},
    "web-company-intel":     {"url": "https://anthropic.com"},
    "agent-access-check":    {"url": "https://anthropic.com"},
    "web-scrape-links":      {"url": "https://httpbin.org/get"},
    "meme-generator":        {"topic": "AI taking over"},
    "generate-meme":         {"template": "drake", "top": "debugging code at 3am"},
    "roast":                 {"target": "Python developers who don't use type hints"},
    "policy-impact-mapper":  {"policy_text": "Congress passed a new tax bill."},
    "portfolio-rebalance":   {"holdings": [{"ticker": "BTC", "value": 500}, {"ticker": "ETH", "value": 300}], "target_allocation": {"BTC": 60, "ETH": 40}},
    "document-qa-prep":      {"text": "The quick brown fox jumps over the lazy dog."},
    "code-api-surface":      {"code": "app.get('/users', (req, res) => res.json([]))"},
    "code-test-detector":    {"repo": "anthropics/anthropic-sdk-python"},
    "research-synthesis":    {"topic": "x402 payment protocol"},
    "evm-token-security":    {"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "chain": "base"},
    "global-news-intel":     {"query": "AI technology"},
    "solar-intel":           {"location": "Phoenix, AZ"},
    "sports-prediction":     {"sport": "NBA"},
    "erc20-snapshot":        {"contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "network": "base"},
}


def call_mcp_cap(cap_name: str, inputs: dict) -> tuple[bool, str]:
    """Call a capability via the free MCP interface. Returns (ok, message)."""
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": cap_name, "arguments": inputs},
        "id": 1
    }).encode()

    req = urllib.request.Request(
        f"{BASE_URL}/mcp",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
    except Exception as e:
        return False, f"request_error: {e}"

    # SSE format: "event: message\ndata: {...}\n\n"
    for line in raw.split("\n"):
        if line.startswith("data: "):
            try:
                d = json.loads(line[6:])
                if "error" in d:
                    return False, f"rpc_error: {d['error']}"
                result = d.get("result", {})
                content = result.get("content", [])
                if result.get("isError"):
                    text = content[0]["text"] if content else "unknown error"
                    return False, f"handler_error: {text[:120]}"
                return True, "ok"
            except Exception as e:
                return False, f"parse_error: {e} | raw: {line[:100]}"

    return False, f"no_data_in_response: {raw[:200]}"


def check_x402_gate(cap_name: str) -> tuple[bool, str]:
    """Verify cap returns 402 (properly registered) not 404/500."""
    req = urllib.request.Request(f"{BASE_URL}/cap/{cap_name}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return False, f"expected_402_got_{resp.status}"
    except urllib.error.HTTPError as e:
        if e.code == 402:
            return True, "402_gated"
        return False, f"http_{e.code}"
    except Exception as e:
        return False, f"error: {e}"


def main():
    start = datetime.utcnow()
    print(f"[{start.isoformat()}Z] Starting STALL health check against {BASE_URL}")

    # Fetch cap list
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=10) as r:
            health = json.loads(r.read())
    except Exception as e:
        print(f"FATAL: Cannot reach /health: {e}")
        sys.exit(1)

    caps = health.get("capabilities", [])
    print(f"Caps registered: {len(caps)}")

    gate_failures = []
    handler_failures = []
    handler_successes = 0

    # Caps too expensive or slow to test via handler — just check 402 gate
    GATE_ONLY = {
        "ai-image-gen",      # external AI, slow
        "image-detect",      # binary input
        "fact-check",        # expensive LLM
        "research-synthesis",# expensive LLM
        "intel-pack",        # bundle, slow
        "defi-state-pack",   # multi-call, slow
        "prediction-stock-pulse",  # LLM
        "market-intelligence",     # LLM
        "market-overview",         # multi-call
    }

    for cap in caps:
        # 1. Gate check
        gate_ok, gate_msg = check_x402_gate(cap)
        if not gate_ok:
            gate_failures.append((cap, gate_msg))
            print(f"  [GATE FAIL] {cap}: {gate_msg}")
            continue

        if cap in GATE_ONLY:
            print(f"  [GATE OK / SKIP_HANDLER] {cap}")
            continue

        # 2. Handler check
        inputs = CAP_TEST_INPUTS.get(cap, {})
        handler_ok, handler_msg = call_mcp_cap(cap, inputs)
        if handler_ok:
            handler_successes += 1
            print(f"  [OK] {cap}")
        else:
            handler_failures.append((cap, handler_msg))
            print(f"  [HANDLER FAIL] {cap}: {handler_msg}")

        time.sleep(0.2)  # gentle pacing

    elapsed = (datetime.utcnow() - start).total_seconds()
    total_tested = len(caps)
    total_failed = len(gate_failures) + len(handler_failures)
    total_passed = total_tested - total_failed

    print(f"\n=== HEALTH CHECK COMPLETE ===")
    print(f"Caps: {total_tested} | Passed: {total_passed} | Failed: {total_failed}")
    print(f"  Gate failures: {len(gate_failures)}")
    print(f"  Handler failures: {len(handler_failures)}")
    print(f"Elapsed: {elapsed:.1f}s")

    # Telegram notification
    notify_path = os.path.expanduser("~/intuitek/notify.sh")
    if total_failed == 0:
        msg = f"✅ [STALL Health] {total_passed}/{total_tested} caps healthy ({elapsed:.0f}s)"
    else:
        fail_list = ", ".join([c for c, _ in gate_failures[:3]] + [c for c, _ in handler_failures[:3]])
        msg = f"⚠️ [STALL Health] {total_failed} caps failing: {fail_list}"

    subprocess.run(["bash", notify_path, msg], check=False)

    # Write results
    output = {
        "ts": start.isoformat() + "Z",
        "caps_total": total_tested,
        "caps_passed": total_passed,
        "caps_failed": total_failed,
        "elapsed_s": round(elapsed, 1),
        "gate_failures": gate_failures,
        "handler_failures": handler_failures,
    }
    output_path = os.path.expanduser(f"~/intuitek/outputs/stall_health_{start.strftime('%Y%m%dT%H%MZ')}.json")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults: {output_path}")

    sys.exit(0 if total_failed == 0 else 1)


if __name__ == "__main__":
    main()
