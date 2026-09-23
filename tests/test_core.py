"""Self-check for non-network logic. Run: python -m pytest tests/ -q"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from github_register.profiles import (
    extract_github_code,
    generate_password,
    generate_username,
    is_valid_username,
    parse_public_profile,
)


def test_extract_code():
    assert extract_github_code("Here's your GitHub verification code: 1234 5678") == "12345678"
    assert extract_github_code("Your verification code is 12345678. It expires soon.") == "12345678"
    assert extract_github_code("verification code: 9876 5432") == "98765432"
    assert extract_github_code("no code here") is None
    assert extract_github_code("") is None


def test_password():
    for _ in range(50):
        pw = generate_password()
        assert len(pw) >= 12
        assert any(c.islower() for c in pw)
        assert any(c.isupper() for c in pw)
        assert any(c.isdigit() for c in pw)


def test_username():
    for _ in range(100):
        name = generate_username()
        assert is_valid_username(name), name


def test_pakmail_share_url():
    from github_register.pakmail import PakMailClient

    url = PakMailClient.share_url(order_id="a%40b.com|tok123|server-1")
    assert url == "https://pakmail.vercel.app/share/b.com/a?t=tok123"
    assert PakMailClient.share_url(order_id="no-token-here") == ""
    mid, token, svc = PakMailClient._parse_order("a%40b.com|tok123|server-2")
    assert (mid, token, svc) == ("a%40b.com", "tok123", "server-2")


def test_pakmail_domain_filters():
    from github_register.pakmail import PakMailClient

    c = PakMailClient(domain_whitelist="ozsaip.com, yzcalo.com")
    c._domains["server-2"] = ["ozsaip.com", "bad.com"]
    assert c._pick_domain() == "ozsaip.com"
    c2 = PakMailClient(domain_blacklist="bad.com")
    c2._domains["server-2"] = ["ozsaip.com", "bad.com"]
    assert c2._pick_domain() == "ozsaip.com"


def test_nextproxy_to_url_and_probe_shape():
    from github_register.nextproxy import NextProxyClient

    assert NextProxyClient.to_url({"ip": "1.2.3.4", "port": "1080", "protocol": "socks5"}) == "socks5h://1.2.3.4:1080"
    assert NextProxyClient.to_url({"ip": "1.2.3.4", "port": "8080", "protocol": "https"}) == "https://1.2.3.4:8080"
    assert NextProxyClient.probe("socks5h://192.0.2.1:1080", timeout=0.5) == -1.0  # TEST-NET-1, unroutable


def test_parse_public_profile():
    random_user = {
        "results": [{
            "name": {"title": "Mr", "first": "Caleb", "last": "Harvey"},
            "location": {"country": "Ireland"},
            # These must not be included in the resulting profile data.
            "email": "caleb.harvey@example.com",
            "login": {"password": "shop"},
        }]
    }
    quote = [{"q": "A public quote."}]
    assert parse_public_profile(random_user, quote) == {
        "name": "Mr Caleb Harvey", "location": "Ireland", "bio": "A public quote.",
    }
    try:
        parse_public_profile({}, [])
    except ValueError:
        pass
    else:
        raise AssertionError("invalid profile payload must fail")


def test_mailbox_timeout_is_not_fatal_provider_error():
    """A per-mailbox 'no code' timeout must NOT abort the whole job."""
    from github_register.pakmail import PakMailError
    from github_register.mail_errors import MailboxTimeoutError

    assert not issubclass(MailboxTimeoutError, PakMailError)


def test_pakmail_wait_for_code_raises_mailbox_timeout():
    """wait_for_code timeout raises MailboxTimeoutError, not PakMailError."""
    from github_register.pakmail import PakMailClient, PakMailError
    from github_register.mail_errors import MailboxTimeoutError

    cli = PakMailClient()
    cli.get_messages = lambda order_id: []

    try:
        cli.wait_for_code("a%40b.com|tok|server-1", timeout=0, poll_interval=8)
    except MailboxTimeoutError:
        pass
    except PakMailError as exc:  # the bug: a timeout looked like a fatal error
        raise AssertionError(f"timeout raised fatal PakMailError instead: {exc}")
    else:
        raise AssertionError("wait_for_code must raise on timeout")


def test_register_one_continues_after_mailbox_timeout():
    """register_one returns None (one failed account) on a mailbox timeout."""
    from github_register import runner
    from github_register.config import Config
    from github_register.mail_errors import MailboxTimeoutError

    cfg = Config()

    def _boom(*args, **kwargs):
        raise MailboxTimeoutError("no GitHub code after 240s")

    orig = runner._run_signup
    runner._run_signup = _boom
    try:
        result = runner.register_one(cfg, log=lambda m: None)
    finally:
        runner._run_signup = orig
    assert result is None, f"mailbox timeout must fail one account, got {result!r}"


def test_run_job_continues_after_mailbox_timeout():
    """run_job keeps going after mailbox timeouts (real register_one path)."""
    from github_register import runner
    from github_register.config import Config
    from github_register.mail_errors import MailboxTimeoutError

    cfg = Config(register_count=3, delay_sec=0)
    calls = {"n": 0}

    def _signup(*args, **kwargs):
        # Every account times out waiting for the GitHub code.
        calls["n"] += 1
        raise MailboxTimeoutError("no GitHub code after 240s")

    orig = runner._run_signup
    runner._run_signup = _signup
    try:
        ok, fail, out = runner.run_job(cfg, log=lambda m: None)
    finally:
        runner._run_signup = orig
        out.unlink(missing_ok=True)
    # The job must attempt ALL accounts instead of aborting on the first one.
    assert calls["n"] == 3, f"job stopped early after mailbox timeout (ran {calls['n']}/3)"
    assert fail == 3 and ok == 0, f"expected 3 fail / 0 ok, got {fail}/{ok}"


def test_run_job_aborts_on_fatal_provider_error():
    """A genuine provider error still aborts the job."""
    from github_register import runner
    from github_register.config import Config
    from github_register.pakmail import PakMailError

    cfg = Config(register_count=3, delay_sec=0)
    calls = {"n": 0}

    def _one(cfg, log, stop):
        calls["n"] += 1
        raise PakMailError("pakmail create failed: RATE_LIMITED")

    orig = runner.register_one
    runner.register_one = _one
    try:
        ok, fail, out = runner.run_job(cfg, log=lambda m: None)
    finally:
        runner.register_one = orig
        out.unlink(missing_ok=True)
    assert calls["n"] == 1, f"fatal provider error must abort after 1 attempt (ran {calls['n']})"


def test_register_one_retries_same_account_with_fresh_ip(monkeypatch):
    """IP-ish SignupError rotates the IP and retries the same account."""
    from github_register import runner
    from github_register.config import Config

    monkeypatch.setattr(runner, "_sleep_with_cancel", lambda *a, **k: None)

    cfg = Config(proxy_retry_attempts=2)
    calls = {"n": 0}
    rotated = {"n": 0}
    orig_signup = runner._run_signup
    orig_rotate = runner._rotate_sticky_proxy

    def _flaky(cfg, password, mail, provider, pending, log, stop):
        calls["n"] += 1
        if calls["n"] < 3:
            raise runner.SignupError("email form did not appear (no challenge marker)")
        pending["email"] = "t@x.com"
        pending["order_id"] = "t%40x.com|tok|server-1"
        return ("user1", "TOTPA", "RECOVERY")

    runner._run_signup = _flaky
    runner._rotate_sticky_proxy = lambda: rotated.__setitem__("n", rotated["n"] + 1)
    try:
        result = runner.register_one(cfg, log=lambda m: None)
    finally:
        runner._run_signup = orig_signup
        runner._rotate_sticky_proxy = orig_rotate
    assert result is not None and result.split("----")[2] == "user1", result
    assert calls["n"] == 3, f"expected 3 attempts, got {calls['n']}"
    assert rotated["n"] == 2, f"expected 2 rotations, got {rotated['n']}"


def test_register_one_gives_up_after_ip_retries(monkeypatch):
    """Persistent IP failures fail the account (None), not hang/test forever."""
    from github_register import runner
    from github_register.config import Config

    monkeypatch.setattr(runner, "_sleep_with_cancel", lambda *a, **k: None)

    cfg = Config(proxy_retry_attempts=1)

    def _always_blocked(*args, **kwargs):
        raise runner.SignupError("Page.goto: Timeout 60000ms exceeded")

    orig = runner._run_signup
    runner._run_signup = _always_blocked
    try:
        result = runner.register_one(cfg, log=lambda m: None)
    finally:
        runner._run_signup = orig
    assert result is None


def test_non_ip_signup_error_does_not_rotate():
    """Non-IP errors (e.g. bad credentials state) fail fast without burning retries."""
    from github_register import runner
    from github_register.config import Config

    cfg = Config(proxy_retry_attempts=2)
    calls = {"n": 0}
    orig = runner._run_signup

    def _bad(*args, **kwargs):
        calls["n"] += 1
        raise runner.SignupError("unexpected page layout v42")

    runner._run_signup = _bad
    try:
        result = runner.register_one(cfg, log=lambda m: None)
    finally:
        runner._run_signup = orig
    assert result is None
    assert calls["n"] == 1, f"non-IP error must not retry, ran {calls['n']}x"


if __name__ == "__main__":
    for name, fn in sorted((n, f) for n, f in globals().items() if n.startswith("test_")):
        fn()
        print(f"[OK] {name}")
    print("[*] all tests passed")


class _FakeLocator:
    def __init__(self, visible):
        self._visible = visible() if callable(visible) else visible

    @property
    def first(self):
        return self

    def is_visible(self):
        v = self._visible() if callable(self._visible) else self._visible
        return v

    def count(self):
        return 1


class _FakePage:
    def __init__(self, url, visible=True):
        self.url = url
        self._visible = visible
        self.ready_polls = 0

    def locator(self, sel):
        self.ready_polls += 1
        return _FakeLocator(self._visible)


def test_form_ready_rejects_homepage_hero():
    """github.com homepage hero email field must not count as the signup form."""
    from github_register import runner

    home = _FakePage("https://github.com/", visible=True)
    assert runner._form_ready(home) is False
    signup = _FakePage("https://github.com/signup", visible=True)
    assert runner._form_ready(signup) is True
    hidden = _FakePage("https://github.com/signup", visible=False)
    assert runner._form_ready(hidden) is False


def test_vanished_form_error_is_ip_related():
    """The exact fill-time failure must route to IP rotation, not instant FAIL."""
    from github_register import runner

    msg = ("no visible element matching ['#email', \"input[name='email']\", "
           "\"input[type='email']\"]")
    assert runner._looks_ip_related(runner.SignupError(msg)) is True


def test_fill_signup_form_rewaits_stale_form(monkeypatch):
    """Form vanishing between ready-check and fill is re-waited, not fatal."""
    from github_register import runner
    from github_register.config import Config

    states = [False, False, True]  # page settles on the 3rd poll
    page = _FakePage("https://github.com/signup", visible=lambda: states.pop(0) if states else True)
    monkeypatch.setattr(runner, "_sleep_with_cancel", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_human_fill", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_fill_and_create_account",
                        lambda page, base, tries, log, stop=None: "someuser")
    got = runner._fill_signup_form(page, Config(), "a@b.com", "Pw12345678!", lambda m: None, lambda: False)
    assert got == "someuser"
    assert page.ready_polls >= 3


class _StagePage:
    """Minimal page double: only .url matters to the re-auth wrapper."""

    def __init__(self, url):
        self.url = url


def _stage_cfg(**kw):
    from github_register.config import Config

    return Config(**kw)


def test_reauth_stage_retries_after_bounce(monkeypatch):
    """Login bounce -> re-login -> stage retried once."""
    from github_register import runner

    page = _StagePage("https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fnew")
    calls = {"stage": 0, "login": 0}

    def _ok_login(*a, **k):
        calls["login"] += 1
        page.url = "https://github.com/new"
        return True

    def _flaky():
        calls["stage"] += 1
        if calls["stage"] == 1:
            raise runner.SignupError("session bounced to login during repo create")
        return "hello"

    monkeypatch.setattr(runner, "_try_login", _ok_login)
    got = runner._with_reauth_stage(
        page, object(), _stage_cfg(), "a@b.com", "Pw12345678!",
        None, "oid", set(), lambda m: None, lambda: False,
        "create repo", _flaky,
    )
    assert got == "hello"
    assert calls == {"stage": 2, "login": 1}


def test_reauth_stage_no_bounce_propagates(monkeypatch):
    """No bounce -> original error propagates, no re-login attempted."""
    from github_register import runner

    page = _StagePage("https://github.com/new")
    calls = {"login": 0}

    def _no_login(*a, **k):
        calls["login"] += 1
        return True

    def _bad():
        raise runner.SignupError("Create repository stayed disabled")

    monkeypatch.setattr(runner, "_try_login", _no_login)
    try:
        runner._with_reauth_stage(
            page, object(), _stage_cfg(), "a@b.com", "Pw12345678!",
            None, "oid", set(), lambda m: None, lambda: False,
            "create repo", _bad,
        )
    except runner.SignupError as exc:
        assert "stayed disabled" in str(exc)
    else:
        raise AssertionError("expected SignupError")
    assert calls["login"] == 0


def test_reauth_stage_failed_relogin_raises(monkeypatch):
    """Bounce + failed re-login -> SignupError mentioning the stage."""
    from github_register import runner

    page = _StagePage("https://github.com/login?return_to=%2Fsettings%2Fsecurity")
    monkeypatch.setattr(runner, "_try_login", lambda *a, **k: False)
    try:
        runner._with_reauth_stage(
            page, object(), _stage_cfg(), "a@b.com", "Pw12345678!",
            None, "oid", set(), lambda m: None, lambda: False,
            "2FA", lambda: (_ for _ in ()).throw(runner.SignupError("bounced")),
        )
    except runner.SignupError as exc:
        assert "2FA" in str(exc) and "re-login failed" in str(exc)
    else:
        raise AssertionError("expected SignupError")


def test_reauth_stage_suspended_fails_fast(monkeypatch):
    """Suspended bounce -> immediate SignupError, no 30s re-login burn."""
    from github_register import runner

    page = _StagePage("https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fsuspended")
    calls = {"login": 0}
    monkeypatch.setattr(runner, "_try_login",
                        lambda *a, **k: (calls.__setitem__("login", 1), True)[1])
    try:
        runner._with_reauth_stage(
            page, object(), _stage_cfg(), "a@b.com", "Pw12345678!",
            None, "oid", set(), lambda m: None, lambda: False,
            "create repo", lambda: (_ for _ in ()).throw(runner.SignupError("bounced")),
        )
    except runner.SignupError as exc:
        assert "suspended" in str(exc).lower()
    else:
        raise AssertionError("expected SignupError")
    assert calls["login"] == 0, "suspended accounts must not attempt re-login"


def test_proxy_required_refuses_direct(monkeypatch):
    """proxy_required=True: empty pool fails instead of leaking the real IP."""
    from github_register import runner
    from github_register.config import Config

    monkeypatch.setattr(runner, "_pick_proxy_url", lambda cfg, log=None: "")
    cfg = Config(proxy_required=True)
    try:
        runner._browser_ctx_options(cfg, log=lambda m: None)
    except runner.SignupError as exc:
        assert "proxy_required" in str(exc)
        # must match the IP-retry policy so the pool is re-fetched, not instant FAIL
        assert runner._looks_ip_related(exc) is True
    else:
        raise AssertionError("expected SignupError, direct must be refused")


def test_generic_launch_failure_with_proxy_marker_retries(monkeypatch):
    """Non-SignupError launch failures (Camoufox geoip) rotate when IP-marked."""
    from github_register import runner
    from github_register.config import Config

    cfg = Config(proxy_retry_attempts=2)
    calls = {"n": 0}

    def _flaky(*args, **kwargs):
        calls["n"] += 1
        raise RuntimeError("Failed to get IP address: Unable to connect to proxy (timeout)")

    monkeypatch.setattr(runner, "_run_signup", _flaky)
    monkeypatch.setattr(runner, "_sleep_with_cancel", lambda *a, **k: None)
    result = runner.register_one(cfg, log=lambda m: None)
    # initial + 2 IP-retries, then gives up (None) instead of instant FAIL
    assert calls["n"] == 3, f"expected 3 attempts, ran {calls['n']}x"
    assert result is None
