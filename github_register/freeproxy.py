"""Free proxy sources (GitHub lists + ProxyScrape) — no key, no auth.

Each source returns bare ip:port lines; the runner validates every candidate
with real traffic (exit IP != ours, relay within nextproxy_max_ping_ms)
before use. Lists rotate constantly, so always re-validate — never trust.
"""
from __future__ import annotations

import re

SOURCES: dict[str, tuple[str, str]] = {
    # name: (url, protocol) — protocol is the scheme to speak TO the proxy
    "proxyscrape-http": (
        "https://api.proxyscrape.com/v4/free-proxy-list/get"
        "?request=get_proxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
        "http",
    ),
    "monosans-http": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "http",
    ),
    "monosans-socks4": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt",
        "socks4",
    ),
    "monosans-socks5": (
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
        "socks5",
    ),
    "thespeedx-http": (
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
        "http",
    ),
    "thespeedx-socks5": (
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
        "socks5",
    ),
}

_IPPORT = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$")


def fetch_all(timeout: int = 25) -> dict[str, list[str]]:
    """{source_name: [proxy urls]}. Failures yield [] (never raise)."""
    import requests as _requests

    out: dict[str, list[str]] = {}
    for name, (url, proto) in SOURCES.items():
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
        except Exception:
            pass
        out[name] = urls
    return out


def fetch_urls() -> list[str]:
    """Deduped candidate URLs across all sources (unvalidated)."""
    seen: set[str] = set()
    out: list[str] = []
    for urls in fetch_all().values():
        for u in urls:
            if u not in seen:
                seen.add(u)
                out.append(u)
    return out
