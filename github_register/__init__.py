"""Automated GitHub sign-up toolkit (Camoufox + PakMail + NextProxy)."""

from .config import Config, load_config

__all__ = ["Config", "load_config", "register_one", "run_job"]


def __getattr__(name: str):
    # Lazy so `import github_register.config` doesn't pull camoufox/playwright.
    if name in ("register_one", "run_job"):
        from . import runner as _runner

        return getattr(_runner, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
