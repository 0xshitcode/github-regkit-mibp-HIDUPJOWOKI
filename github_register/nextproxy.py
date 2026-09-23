"""NextProxy live proxy source (https://console.nextproxy.site).

Guest pool on nextproxy.site works without a key but fast nodes are masked
(isProOnly/masked=true) and bulk txt export is Pro-only. The console host
with X-API-Key returns the same JSON plus Free-Starter quota headers.

Use the JSON pool (not /api/random — random often returns a locked node on
free tiers) and filter client-side to unmasked nodes only:

  client = NextProxyClient(api_key="nex_live_...")
  urls = client.fetch_urls(type="socks5", limit=20)  # ["socks5://ip:port", ...]

Output URLs are directly consumable by runner.load_proxy_pool/_pick_proxy_url
(no auth — public pools have no user:pass).
"""
from __future__ import annotations

import time
from typing import Any, Optional

import requests

CONSOLE_BASE = "https://console.nextproxy.site"
FALLBACK_BASE = "https://nextproxy.site"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

SCHEMES = ("http", "https", "socks4", "socks5")


class NextProxyError(RuntimeError):
    pass


_DIRECT_IP: Optional[str] = None


def direct_exit_ip(timeout: float = 8.0) -> Optional[str]:
    """This host's real exit IP (bare lookup, no proxy) — cached per process.

    Used to reject transparent proxies whose exit IP equals ours: such a
    node "works" but leaks the real IP, which defeats proxy_required.
    """
    global _DIRECT_IP
    if _DIRECT_IP is None:
        try:
            import requests as _requests

            txt = (_requests.get("https://api.ipify.org", timeout=timeout).text or "").strip()
            _DIRECT_IP = txt or ""
        except Exception:
            _DIRECT_IP = ""
    return _DIRECT_IP or None


class NextProxyClient:
    def __init__(self, api_key: str = "", base: str = CONSOLE_BASE, timeout: int = 20):
        self.api_key = (api_key or "").strip()
        self.base = (base or CONSOLE_BASE).rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": BROWSER_UA, "Accept": "application/json"})
        if self.api_key:
            self.session.headers.update({"X-API-Key": self.api_key})
        self._credits_remaining: Optional[str] = None

    @property
    def credits_remaining(self) -> Optional[str]:
        return self._credits_remaining

    def _get(self, path: str, params: dict) -> dict:
        last_exc: Exception | None = None
        bases = [self.base] if self.base == CONSOLE_BASE else [self.base, CONSOLE_BASE]
        # free-tier keys live on console; guest pool on either host
        if self.base == CONSOLE_BASE:
            bases = [CONSOLE_BASE, FALLBACK_BASE]
        for b in bases:
            try:
                resp = self.session.get(f"{b}{path}", params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                last_exc = exc
                continue
            self._credits_remaining = resp.headers.get("X-Credits-Remaining", self._credits_remaining)
            try:
                data = resp.json()
            except ValueError:
                # e.g. HTTP 504 HTML from one host — try the next base
                last_exc = NextProxyError(f"nextproxy bad json (HTTP {resp.status_code})")
                continue
            if isinstance(data, dict) and data.get("status") == "error":
                msg = f"{data.get('code')}: {data.get('message')}"
                # 401 with a key = bad/revoked key; drop the key and retry as
                # guest so the job keeps running on the free pool instead of
                # dying. Keys have been observed to flip 200 -> 401 mid-day.
                if data.get("code") == 401 and self.api_key and "X-API-Key" in self.session.headers:
                    del self.session.headers["X-API-Key"]
                    self.api_key = ""
                    last_exc = NextProxyError(f"nextproxy unauthorized ({msg}) — falling back to guest pool")
                    continue
                last_exc = NextProxyError(f"nextproxy: {msg}")
                continue
            return data if isinstance(data, dict) else {}
        raise NextProxyError(f"nextproxy request failed: {last_exc}")

    def fetch(
        self,
        limit: int = 20,
        proxy_type: str = "socks5",
        country: str = "",
        max_latency: int = 0,
        sort: str = "",
        allow_transparent: bool = False,
    ) -> list[dict]:
        """Raw node dicts, unmasked+unlocked only, sorted fastest-first.

        Transparent proxies are excluded by default: they forward the real
        exit IP in headers, which defeats proxy_required (worse than failing).
        (The API's `anonymity=` filter returns zero rows on the free tier, so
        filter client-side on the node's `anonymity` field.)
        """
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if proxy_type and proxy_type != "all":
            params["type"] = proxy_type
        if country:
            params["country"] = country.upper()
        if max_latency and max_latency > 0:
            params["max_latency"] = int(max_latency)
        if sort:
            params["sort"] = sort
        data = self._get("/api/proxies", params)
        nodes = data.get("proxies") or []
        usable = [
            n for n in nodes
            if isinstance(n, dict) and not n.get("masked") and not n.get("isLocked") and n.get("ip") and n.get("port")
            and "•" not in str(n.get("ip", "")) and "•" not in str(n.get("port", ""))
            and (allow_transparent or str(n.get("anonymity") or "").lower() != "transparent")
        ]
        usable.sort(key=lambda n: float(n.get("latency") or n.get("rawLatency") or 9e9))
        return usable

    @staticmethod
    def to_url(node: dict, scheme: str = "") -> str:
        proto = (scheme or node.get("protocol") or node.get("type") or "http").lower()
        if proto not in SCHEMES:
            proto = "http"
        # socks -> socks5h for remote DNS (avoids gateway ruleset rejects)
        if proto == "socks5":
            proto = "socks5h"
        return f"{proto}://{node['ip']}:{node['port']}"

    @staticmethod
    def probe(url: str, timeout: float = 5.0) -> float:
        """Local TCP connectivity check. Returns connect seconds, or -1 if dead."""
        import socket
        from urllib.parse import urlsplit

        p = urlsplit(url)
        try:
            start = time.time()
            with socket.create_connection((p.hostname or "", p.port or 1080), timeout=timeout):
                return time.time() - start
        except Exception:
            return -1.0

    def fetch_urls(self, limit: int = 20, proxy_type: str = "socks5", **kw) -> list[str]:
        return [self.to_url(n) for n in self.fetch(limit=limit, proxy_type=proxy_type, **kw)]

    def pick_fast(self, limit: int = 20, proxy_type: str = "socks5",
                  max_probes: int = 5, timeout: float = 5.0, **kw) -> str:
        """First genuinely-working URL from the pool (already latency-sorted).

        TCP connect alone is not enough — transparent/filtering proxies accept
        the socket then reset on real traffic. So each candidate must also pass
        a real HTTPS GET through itself. The returned URL uses the WORKING
        scheme (http fallback for https-labeled nodes), and nodes whose exit
        IP equals ours (transparent, identity-leaking) are rejected. '' if none.
        """
        import concurrent.futures as _fut
        import re

        import requests as _requests

        def _check(url: str) -> str:
            # Pool "https" means "relays HTTPS targets", not "speaks TLS":
            # live nodes are plain-HTTP forward proxies (CONNECT for HTTPS
            # targets). Try http FIRST — https-scheme checks produce false
            # positives on flapping nodes (TLS passes once, dies at launch).
            cands = [url]
            if url.startswith("https://"):
                cands.insert(0, "http://" + url[len("https://"):])
            mine = direct_exit_ip()
            for cand in cands:
                if self.probe(cand, timeout=timeout) < 0:
                    continue
                try:
                    resp = _requests.get("https://api.ipify.org", proxies={"http": cand, "https": cand},
                                         timeout=10)
                    exit_ip = (resp.text or "").strip()
                    if resp.ok and re.match(r"^\d+\.\d+\.\d+\.\d+\s*$", exit_ip or ""):
                        if mine and exit_ip == mine:
                            continue  # transparent: exit == our real IP, leaks identity
                        return cand  # return the WORKING scheme, not the labeled one
                except Exception:
                    continue
            return ""

        cands = self.fetch_urls(limit=limit, proxy_type=proxy_type, **kw)[: max(1, max_probes)]
        with _fut.ThreadPoolExecutor(max_workers=min(len(cands), max_probes)) as ex:
            # dict preserves submission order: first URL in pool order that works wins
            results = dict(zip(cands, ex.map(_check, cands)))
        for url in cands:
            if results.get(url):
                return url
        return ""

    def verify(self, target: str) -> dict:
        """Live TCP probe: {'alive': bool, 'latency': ms}."""
        ipport = target.split("://", 1)[-1]
        return self._get("/api/verify-proxy", {"target": ipport})
