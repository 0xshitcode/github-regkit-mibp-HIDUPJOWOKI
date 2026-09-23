#!/usr/bin/env python3
"""Sweep the NextProxy pool, classify every node, fill whitelist/blacklist.

    python3 scan_proxies.py [--limit 500] [--types https,socks5,socks4]
                            [--max-ping 2000] [--apply] [--report proxies_scan.json]

    --apply writes the results into config.json (nextproxy_whitelist /
    nextproxy_blacklist). Without --apply it only prints + saves the report.
    Working = real HTTPS traffic, exit IP != ours. The pick-time
    nextproxy_max_ping_ms gate still applies on top at run time.
"""
from __future__ import annotations

import argparse
import concurrent.futures as fut
import json
import socket
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from github_register.nextproxy import NextProxyClient, _hostport  # noqa: E402


def tcp_alive(url: str, timeout: float = 4.0) -> float:
    p = urlsplit(url)
    try:
        t0 = time.time()
        s = socket.create_connection((p.hostname, p.port or 1080), timeout=timeout)
        dt = time.time() - t0
        s.close()
        return dt
    except Exception:
        return -1.0


def traffic_check(url: str, timeout: float = 10.0) -> tuple:
    """(exit_ip | '', relay_ms, note). Tries http scheme first for https labels."""
    import requests as _rq

    cands = [url]
    if url.startswith("https://"):
        cands.insert(0, "http://" + url[len("https://"):])
    errs = []
    for cand in cands:
        if tcp_alive(cand, timeout=4.0) < 0:
            errs.append("tcp-dead")
            continue
        try:
            t0 = time.time()
            r = _rq.get("https://api.ipify.org", proxies={"http": cand, "https": cand},
                        timeout=timeout)
            ms = (time.time() - t0) * 1000.0
            ip = (r.text or "").strip()
            if r.ok and ip and ip[0].isdigit():
                return ip, ms, cand
            errs.append(f"http-{r.status_code}")
        except Exception as exc:
            errs.append(_short_err(exc))
    return "", 0.0, errs[-1] if errs else "dead"


def _short_err(exc: Exception) -> str:
    s = str(exc)
    for marker in ("407", "403", "405"):
        if marker in s:
            return f"{marker}-auth-required"
    low = s.lower()
    if "timeout" in low or "timed out" in low:
        return "timeout"
    if "certificate" in low:
        return "bad-cert"
    if "wrong version" in low.lower():
        return "tls-mismatch"
    if "closed" in low or "reset" in low or "refused" in low:
        return "conn-reset"
    return type(exc).__name__


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--types", default="https,socks5,socks4")
    ap.add_argument("--max-ping", type=float, default=2000.0,
                    help="whitelist cutoff for relay ms (pick-time gate may be stricter)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--report", default="proxies_scan.json")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    client = NextProxyClient(api_key=cfg.get("nextproxy_api_key", ""))
    mine = ""
    try:
        import requests as _rq

        mine = (_rq.get("https://api.ipify.org", timeout=10).text or "").strip()
    except Exception:
        pass
    print(f"[*] direct IP: {mine or '?'}")

    urls: list[str] = []
    for ptype in [t.strip() for t in args.types.split(",") if t.strip()]:
        nodes = client.fetch(limit=args.limit, proxy_type=ptype)
        urls += [client.to_url(n) for n in nodes]
        print(f"[*] fetched {ptype}: {len(nodes)} unmasked")
    print(f"[*] credits: {client.credits_remaining}")

    with fut.ThreadPoolExecutor(max_workers=200) as ex:
        alive = [(u, t) for u, t in zip(urls, ex.map(tcp_alive, urls)) if t >= 0]
    print(f"[*] TCP alive: {len(alive)}/{len(urls)}")

    whitelist: list[dict] = []
    blacklist: list[str] = []
    with fut.ThreadPoolExecutor(max_workers=20) as ex:
        for (u, tcp_ms), (ip, relay_ms, note) in zip(alive, ex.map(traffic_check, [u for u, _ in alive])):
            hp = _hostport(u)
            if ip and ip != mine:
                entry = {"url": note if note.startswith("http") else u, "exit": ip,
                         "tcp_ms": round(tcp_ms * 1000), "relay_ms": round(relay_ms)}
                if relay_ms <= args.max_ping:
                    whitelist.append(entry)
                    print(f"  [OK {relay_ms:6.0f}ms] {u} exit={ip}")
                else:
                    print(f"  [SLOW {relay_ms:6.0f}ms] {u} exit={ip}")
                    blacklist.append(hp)
            else:
                print(f"  [BAD {note}] {u}")
                blacklist.append(hp)

    # nodes that never passed TCP at all are dead weight too — but the pool
    # rotates every 10s, so only blacklist traffic-proven failures, not TCP misses.
    report = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "direct_ip": mine,
              "scanned": len(urls), "tcp_alive": len(alive),
              "whitelist": whitelist, "blacklist": sorted(set(blacklist))}
    (ROOT / args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[*] whitelist={len(whitelist)} blacklist={len(set(blacklist))} -> {args.report}")

    if args.apply:
        cfg["nextproxy_whitelist"] = ",".join(w["url"] for w in whitelist)
        old_bl = {b.strip() for b in (cfg.get("nextproxy_blacklist") or "").split(",") if b.strip()}
        cfg["nextproxy_blacklist"] = ",".join(sorted(old_bl | set(blacklist)))
        (ROOT / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        print("[*] config.json whitelist/blacklist updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
