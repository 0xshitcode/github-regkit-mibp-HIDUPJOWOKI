"""Configuration loading for the GitHub register toolkit (PakMail + NextProxy only)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Config:
    # PakMail temp email, server-2 only (https://pakmail.vercel.app/docs)
    pakmail_domain: str = ""  # empty = auto-pick
    pakmail_domain_whitelist: str = ""  # csv, e.g. "ozsaip.com,yzcalo.com"
    pakmail_domain_blacklist: str = ""  # csv, excluded even if service lists them
    # NextProxy live proxy source (https://console.nextproxy.site)
    nextproxy_api_key: str = ""
    nextproxy_type: str = "socks5"  # all | https | socks4 | socks5
    nextproxy_country: str = ""  # e.g. "US","DE","SG" (empty = any)
    nextproxy_limit: int = 20
    nextproxy_max_latency: int = 0  # ms, 0 = off
    # Pin known nodes: whitelist (full URLs) is tried BEFORE sweeping the
    # pool; blacklist (host:port) is skipped without probing. CSV.
    nextproxy_whitelist: str = ""  # e.g. "http://1.2.3.4:8888,http://5.6.7.8:10111"
    nextproxy_blacklist: str = ""  # e.g. "2.59.132.39:3128,207.154.201.220:3128"
    # Direct connections are FORBIDDEN: without a working pool node the run
    # fails instead of leaking the real exit IP (which gets flagged + burned).
    proxy_required: bool = True
    register_count: int = 1
    headless: bool = False
    delay_sec: float = 5.0
    max_username_tries: int = 6
    otp_timeout_sec: int = 240
    browser_profile_dir: str = ".browser-profile"
    # fresh browser per account (incognito-like, zero cached state); the
    # DataDome trust cookie is carried over via .datadome-trust.json so the
    # signup page keeps loading without hard 403s
    fresh_profile: bool = True
    proxy_hard_block_retries: int = 2
    proxy_rate_limit_retries: int = 2
    proxy_retry_attempts: int = 2  # extra tries of the SAME account with a fresh IP on IP/proxy failures
    # post-signup stages (from user recording)
    create_repo: bool = True          # stage 4: create first repository
    repo_name: str = "hello"          # repo name prefix (username-suffix appended on conflict)
    enable_2fa: bool = True           # stage 5: enable TOTP 2FA and store the secret
    set_profile_status: bool = True
    profile_status: str = "On vacation"  # blank disables custom status text
    complete_profile: bool = True
    profile_name: str = ""            # blank = Random User
    profile_bio: str = ""             # blank = ZenQuotes
    profile_location: str = ""        # blank = Random User country

    @classmethod
    def from_dict(cls, data: dict) -> "Config":
        known = set(cls.__dataclass_fields__)
        # tolerate legacy keys from pre-refactor configs (litensi/mailcx/file proxy)
        legacy = {"mail_provider", "mailcx_domain", "litensi_api_id", "litensi_api_key",
                  "litensi_site", "litensi_zone", "proxy", "proxy_file", "proxy_source",
                  "pakmail_service"}
        mapped = {k: v for k, v in data.items() if k in known and k not in legacy}
        return cls(**mapped)


def load_config(path: str | Path) -> Config:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(
            f"config not found: {p} (copy config.example.json to config.json and fill it in)"
        )
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config.from_dict(data)
