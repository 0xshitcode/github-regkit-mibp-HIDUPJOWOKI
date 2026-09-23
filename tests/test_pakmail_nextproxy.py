"""Unit + live E2E for PakMail / NextProxy providers (fast, no browser).

Run unit only:  python -m pytest tests/test_pakmail_nextproxy.py -q
Run live E2E:   PAKMAIL_E2E=1 NEXTPROXY_E2E=1 NEXTPROXY_KEY=nex_live_... python -m pytest tests/test_pakmail_nextproxy.py -q
"""
from __future__ import annotations

import os

from github_register.config import Config  # noqa: E402 (no runner import -> no camoufox needed)
from github_register.nextproxy import NextProxyClient
from github_register.pakmail import PakMailClient


def test_pakmail_order_id_roundtrip():
    c = PakMailClient(service="server-1")
    mid, token, svc = c._parse_order("abc%40x.com|tok123|server-2")
    assert (mid, token, svc) == ("abc%40x.com", "tok123", "server-2")


def test_pakmail_whitelist_blacklist():
    c = PakMailClient(service="server-1", domain_whitelist="ozsaip.com, yzcalo.com")
    c._domains["server-1"] = ["ozsaip.com", "bad.com"]
    assert c._pick_domain() == "ozsaip.com"
    c2 = PakMailClient(service="server-1", domain_blacklist="bad.com")
    c2._domains["server-1"] = ["ozsaip.com", "bad.com"]
    assert c2._pick_domain() == "ozsaip.com"


def test_nextproxy_to_url_filters_masked():
    n = {"ip": "1.2.3.4", "port": "1080", "protocol": "socks5"}
    assert NextProxyClient.to_url(n) == "socks5h://1.2.3.4:1080"
    assert NextProxyClient.to_url({"ip": "1.2.3.4", "port": "8080", "protocol": "https"}) == "https://1.2.3.4:8080"


def test_config_loads_new_fields(tmp_path):
    import json

    p = tmp_path / "config.json"
    p.write_text(json.dumps({"pakmail_service": "server-2", "pakmail_domain_whitelist": "ozsaip.com",
                             "nextproxy_type": "socks5", "nextproxy_api_key": "k"}))
    from github_register.config import load_config
    cfg = load_config(p)
    assert cfg.pakmail_service == "server-2"
    assert cfg.pakmail_domain_whitelist == "ozsaip.com"
    assert cfg.nextproxy_api_key == "k"
    # legacy keys are tolerated, not stored
    p.write_text(json.dumps({"mail_provider": "mailcx", "proxy_file": "proxies.txt",
                             "litensi_api_key": "x", "pakmail_service": "server-1"}))
    cfg2 = load_config(p)
    assert cfg2.pakmail_service == "server-1"
    assert not hasattr(cfg2, "mail_provider")


def test_runner_picks_nextproxy(monkeypatch):
    import importlib.util
    spec = importlib.util.find_spec("camoufox")
    if spec is None:
        return  # runner needs camoufox; covered in full env
    from github_register import runner
    cfg = Config(nextproxy_api_key="k", nextproxy_type="socks5")
    monkeypatch.setattr(runner, "_pick_nextproxy_url", lambda cfg, log=None: "socks5h://1.2.3.4:1080")
    assert runner._pick_proxy_url(cfg) == "socks5h://1.2.3.4:1080"


# ---- live E2E (opt-in) ----------------------------------------------------
def test_e2e_pakmail_servers():
    if os.getenv("PAKMAIL_E2E") != "1":
        return
    for svc in ("server-1", "server-2", "server-3", "gmail"):
        c = PakMailClient(service=svc)
        email, order = c.create_mailbox()
        assert "@" in email, svc
        msgs = c.get_messages(order)
        assert isinstance(msgs, list), svc
        print(f"E2E pakmail {svc}: {email} msgs={len(msgs)}")


def test_e2e_nextproxy_pool():
    if os.getenv("NEXTPROXY_E2E") != "1":
        return
    key = os.getenv("NEXTPROXY_KEY", "")
    c = NextProxyClient(api_key=key)
    urls = c.fetch_urls(limit=10, proxy_type="socks5")
    assert urls, "empty usable pool"
    assert all(u.startswith(("socks5h://", "socks5://", "http://", "https://")) for u in urls)
    print(f"E2E nextproxy: {len(urls)} usable, e.g. {urls[0]}")
