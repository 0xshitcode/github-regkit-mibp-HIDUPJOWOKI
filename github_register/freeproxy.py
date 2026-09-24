"""Free proxy sources — validated lists first, raw scrapes last.

Validated repos (entries passed a real traffic check minutes/hours ago):
  monosans/proxy-list   hourly, sorted fastest-first, has per-node timeout
  proxifly/free-proxy-list  every 5 min, 116 countries, json + txt
  relayglass/free-proxy-list every 5 min, elite-only folders
Backup raw API:
  proxyscrape free list (no key)

Every candidate is re-validated locally with real traffic before use —
never trust a list. See nextproxy.check rules (exit != ours, ping gates).
"""
from __future__ import annotations

import re
import time

# name: (url, scheme to speak TO the proxy, validated?)
SOURCES: dict[str, tuple[str, str, bool]] = {
    "monosans-http": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "http", True,
    ),
    "monosans-socks4": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt",
        "socks4", True,
    ),
    "monosans-socks5": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
        "socks5", True,
    ),
    "proxifly-https": (
        "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt",
        "http", True,
    ),
    "proxifly-http": (
        "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
        "http", True,
    ),
    "relayglass-elite-https": (
        "https://raw.githubusercontent.com/relayglass/free-proxy-list/main/anonymity/elite/https/https.txt",
        "http", True,
    ),
    "relayglass-elite-socks5": (
        "https://raw.githubusercontent.com/relayglass/free-proxy-list/main/anonymity/elite/socks5/socks5.txt",
        "socks5", True,
    ),
    "proxyscrape-http": (
        "https://api.proxyscrape.com/v4/free-proxy-list/get"
        "?request=get_proxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
        "http", False,
    ),
}

_IPPORT = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$")

_CACHE: dict = {"at": 0.0, "urls": []}
CACHE_TTL = 600.0  # lists update every 5-60 min; refetch at most every 10 min


def fetch_all(timeout: int = 25, per_source_cap: int = 400) -> dict[str, list[str]]:
    """{source_name: [proxy urls]}. Failures yield [] (never raise)."""
    import requests as _requests

    out: dict[str, list[str]] = {}
    for name, (url, proto, _validated) in SOURCES.items():
        urls: list[str] = []
        try:
            resp = _requests.get(url, timeout=timeout,
                                 headers={"User-Agent": "Mozilla/5.0"})
            if resp.ok:
                seen: set[str] = set()
                for line in resp.text.splitlines():
                    m = _IPPORT.match(line.strip())
                    if not m:
                        continue
                    scheme = "socks5h" if proto == "socks5" else proto
                    full = f"{scheme}://{m.group(1)}:{m.group(2)}"
                    if full not in seen:
                        seen.add(full)
                        urls.append(full)
                    if len(urls) >= per_source_cap:
                        break
        except Exception:
            pass
        out[name] = urls
    return out


def fetch_urls(per_source_cap: int = 400) -> list[str]:
    """Deduped candidate URLs across all sources (unvalidated)."""
    seen: set[str] = set()
    out: list[str] = []
    for urls in fetch_all(per_source_cap=per_source_cap).values():
        for u in urls:
            if u not in seen:
                seen.add(u)
                out.append(u)
    return out


def get_candidates() -> list[str]:
    """Cached candidate list (10-min TTL) — never raises, [] on failure."""
    now = time.time()
    if _CACHE["urls"] and now - float(_CACHE.get("at") or 0) < CACHE_TTL:
        return list(_CACHE["urls"])
    try:
        urls = fetch_urls()
    except Exception:
        return list(_CACHE["urls"])
    _CACHE.update({"at": now, "urls": urls})
    return list(urls)
