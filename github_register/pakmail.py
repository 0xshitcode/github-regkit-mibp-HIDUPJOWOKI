"""PakMail temporary email API client (https://pakmail.vercel.app/docs).

Stateless proxy: identity is the address itself, token is per-mailbox.
Flow: POST /api/mailboxes -> (address, token) -> GET .../messages?service=&token=

Interface mirrors MailCxClient/LitensiClient so runner.py needs no changes:
  create_mailbox() -> (email, order_id)
  wait_for_code(order_id, ...) -> code
  mark_success/set_status -> no-op
  last_order_id

order_id encodes everything wait_for_code needs:
  "<urlencoded_id>|<token>|<service>"
"""
from __future__ import annotations

import random
import string
import time
from typing import Callable, Iterable, Optional
from urllib.parse import quote, unquote

import requests

from .mail_errors import MailboxCancelled, MailboxTimeoutError

API_BASE = "https://pakmail.vercel.app/api"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

_SERVICE = "server-2"  # locked: only server-2 is used

_LOCAL_CHARS = string.ascii_lowercase + string.digits


class PakMailError(RuntimeError):
    pass


def _split_csv(value: str) -> list[str]:
    return [p.strip().lower() for p in (value or "").replace(";", ",").split(",") if p.strip()]


class PakMailClient:
    """PakMail client. No global key — token is per-mailbox from create."""

    def __init__(
        self,
        service: str = "server-2",
        domain: str = "",
        domain_whitelist: str = "",
        domain_blacklist: str = "",
    ):
        # Only server-2 is used (proven: full bodies via detail endpoint,
        # custom domains supported). Anything else is coerced.
        self.service = _SERVICE
        self.domain = (domain or "").strip().lower()
        self.whitelist = set(_split_csv(domain_whitelist))
        self.blacklist = set(_split_csv(domain_blacklist))
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": BROWSER_UA, "Accept": "application/json"})
        self._domains: dict[str, list[str]] = {}
        self._last_email = ""
        self._last_order = ""

    # -- domains -----------------------------------------------------------
    def _get_domains(self, service: str = "") -> list[str]:
        svc = service or self.service
        if svc in self._domains:
            return self._domains[svc]
        try:
            resp = self.session.get(f"{API_BASE}/domains", params={"service": svc}, timeout=15)
            data = resp.json()
            domains = data.get("domains") if isinstance(data, dict) else None
            domains = [str(d).lower() for d in (domains or []) if d]
        except Exception:
            domains = []
        self._domains[svc] = domains
        return domains

    def _pick_domain(self) -> str:
        if self.domain:
            return self.domain
        domains = self._get_domains()
        if self.whitelist:
            filtered = [d for d in domains if d in self.whitelist]
            if filtered:
                return random.choice(filtered)
            # whitelist names a domain the service doesn't list (stale cache?)
            # fall back to the whitelist itself so custom domains still work
            return random.choice(sorted(self.whitelist))
        if self.blacklist:
            filtered = [d for d in domains if d not in self.blacklist]
            if filtered:
                return random.choice(filtered)
        if domains:
            return random.choice(domains)
        return ""

    @staticmethod
    def _random_localpart(n: int = 10) -> str:
        return "".join(random.choices(_LOCAL_CHARS, k=n))

    # -- mailbox -----------------------------------------------------------
    def create_mailbox(self, name: str = "") -> tuple[str, str]:
        """Create mailbox. Returns (email, order_id)."""
        svc = self.service
        body: dict = {"service": svc}
        body["name"] = (name or self._random_localpart()).lower()
        domain = self._pick_domain()
        if domain:
            body["domain"] = domain
        try:
            resp = self.session.post(f"{API_BASE}/mailboxes", json=body, timeout=20)
            data = resp.json()
        except requests.RequestException as exc:
            raise PakMailError(f"pakmail create failed (network): {exc}")
        except ValueError:
            raise PakMailError(f"pakmail create failed (bad json, HTTP {resp.status_code})")
        if not data.get("ok"):
            err = data.get("error", {})
            raise PakMailError(f"pakmail create failed: {err.get('code', '?')}: {err.get('message', data)}")
        mb = data.get("mailbox") or {}
        address = mb.get("address") or ""
        mid = mb.get("id") or quote(address, safe="")
        token = mb.get("token") or ""
        if not address:
            raise PakMailError(f"pakmail create bad response: {mb}")
        self._last_email = address
        order_id = f"{mid}|{token}|{svc}"
        self._last_order = order_id
        return address, order_id

    @staticmethod
    def _parse_order(order_id: str) -> tuple[str, str, str]:
        parts = (order_id or "").split("|")
        mid = parts[0] if len(parts) > 0 else ""
        token = parts[1] if len(parts) > 1 else ""
        svc = parts[2] if len(parts) > 2 else _SERVICE
        return mid, token, svc

    @staticmethod
    def share_url(order_id: str = "", email: str = "", token: str = "") -> str:
        """Public inbox access link: https://pakmail.vercel.app/share/<domain>/<name>?t=<token>."""
        mid, tok, _svc = PakMailClient._parse_order(order_id) if order_id else ("", "", "")
        token = token or tok
        address = email or unquote(mid)
        if "@" not in address or not token:
            return ""
        name, domain = address.split("@", 1)
        return f"https://pakmail.vercel.app/share/{domain}/{name}?t={token}"

    def get_messages(self, order_id: str) -> list[dict]:
        mid, token, svc = self._parse_order(order_id)
        if not mid:
            # backward-compat: caller passed a raw email address
            mid = quote(order_id, safe="")
        params = {"service": svc}
        if token:
            params["token"] = token
        try:
            resp = self.session.get(f"{API_BASE}/mailboxes/{mid}/messages", params=params, timeout=20)
            data = resp.json()
        except requests.RequestException as exc:
            raise PakMailError(f"pakmail read failed (network): {exc}")
        except ValueError:
            raise PakMailError(f"pakmail read failed (bad json, HTTP {resp.status_code})")
        if not data.get("ok"):
            err = data.get("error", {}) if isinstance(data, dict) else {}
            code = err.get("code", "?") if isinstance(err, dict) else "?"
            if code in ("MAILBOX_NOT_FOUND",):
                return []  # expired -> keep polling until timeout, like mailcx
            raise PakMailError(f"pakmail read failed: {code}: {err.get('message', data) if isinstance(err, dict) else data}")
        msgs = data.get("messages") or []
        return msgs if isinstance(msgs, list) else []

    def get_message_detail(self, order_id: str, message_id: str) -> dict:
        """Full body of one message (server-2/3 lists carry metadata only)."""
        mid, token, svc = self._parse_order(order_id)
        if not mid:
            mid = quote(order_id, safe="")
        params = {"service": svc}
        if token:
            params["token"] = token
        try:
            resp = self.session.get(
                f"{API_BASE}/mailboxes/{mid}/messages/{message_id}",
                params=params, timeout=20,
            )
            data = resp.json()
        except requests.RequestException as exc:
            raise PakMailError(f"pakmail detail failed (network): {exc}")
        except ValueError:
            raise PakMailError("pakmail detail failed (bad json)")
        if not data.get("ok"):
            raise PakMailError(f"pakmail detail failed: {data.get('error')}")
        msg = data.get("message") or {}
        return msg if isinstance(msg, dict) else {}

    def wait_for_code(
        self,
        order_id: str,
        timeout: int = 240,
        poll_interval: int = 10,
        log: Optional[Callable[[str], None]] = None,
        cancel_cb: Optional[Callable[[], bool]] = None,
        email: str = "",
        exclude_codes: Optional[Iterable[str]] = None,
    ) -> str:
        """Poll until the GitHub code arrives. 10s default: kind to rate limits."""
        from .profiles import extract_github_code

        poll_interval = max(8, poll_interval)  # read limit 120/min, but be nice
        skip = {str(c).strip() for c in (exclude_codes or ()) if str(c).strip()}
        started = time.time()
        attempts = 0
        seen_detail: set = set()  # message ids whose detail was already fetched
        while time.time() - started < timeout:
            if cancel_cb and cancel_cb():
                raise MailboxCancelled("cancelled while waiting for mail")
            messages = self.get_messages(order_id)
            attempts += 1
            for msg in messages:
                if not isinstance(msg, dict):
                    continue
                blob = "\n".join(
                    str(msg.get(k) or "")
                    for k in ("subject", "bodyText", "bodyPreview", "bodyHtml", "from", "fromEmail")
                )
                code = extract_github_code(blob) or self._fallback_code(blob)
                if not code and msg.get("id"):
                    # server-2/3 lists carry metadata only — pull the full body
                    # when the message looks GitHub-relevant.
                    head = f"{msg.get('subject', '')} {msg.get('from', '')} {msg.get('fromEmail', '')}".lower()
                    if "github" in head or "launch" in head or "verif" in head or "code" in head:
                        if str(msg["id"]) in seen_detail:
                            continue
                        seen_detail.add(str(msg["id"]))
                        try:
                            detail = self.get_message_detail(order_id, str(msg["id"]))
                        except PakMailError as exc:
                            if log:
                                log(f"[i] pakmail detail fetch failed: {exc}")
                            detail = {}
                        if detail:
                            blob = "\n".join(
                                str(detail.get(k) or "")
                                for k in ("subject", "bodyText", "bodyPreview", "bodyHtml")
                            )
                            code = extract_github_code(blob) or self._fallback_code(blob)
                if not code:
                    continue
                if code in skip:
                    if log:
                        log(f"[*] pakmail skipped already-used code {code}")
                    continue
                self._last_order = order_id
                return code
            if log:
                el = int(time.time() - started)
                log(f"[*] pakmail poll #{attempts} — no code yet ({el}s/{timeout}s)")
            # sleep in 1s slices so Stop cancels fast
            deadline = time.time() + min(poll_interval, 10)
            while time.time() < deadline:
                if cancel_cb and cancel_cb():
                    raise MailboxCancelled("cancelled while waiting for mail")
                time.sleep(1)
        raise MailboxTimeoutError(f"no GitHub code after {timeout}s ({attempts} polls)")

    @staticmethod
    def _fallback_code(blob: str) -> str | None:
        import re

        m = re.search(r"\b(\d{6,8})\b", re.sub(r"<[^>]+>", " ", blob))
        return m.group(1) if m else None

    def mark_success(self, order_id: str) -> dict:
        return {"status": "ok", "note": "pakmail has no order-confirm system"}

    def set_status(self, order_id: str, status: str) -> dict:
        return self.mark_success(order_id)

    @property
    def last_order_id(self) -> str:
        return self._last_order or self._last_email
