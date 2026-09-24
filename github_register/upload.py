"""Upload result files to a free permanent file host (catbox.moe).

catbox.moe keeps files permanently (200 MB max, no account) — unlike
temp.sh/0x0.st/transfer.sh which expire. API: POST multipart
reqtype=fileupload + fileToUpload -> plain-text URL on success.
"""
from __future__ import annotations

CATBOX_API = "https://catbox.moe/user/api.php"


class UploadError(RuntimeError):
    pass


def upload_text(filename: str, content: str, timeout: int = 60) -> str:
    """Upload text content as a file; returns the permanent public URL."""
    import requests as _requests

    try:
        resp = _requests.post(
            CATBOX_API,
            data={"reqtype": "fileupload"},
            files={"fileToUpload": (filename, content.encode("utf-8"), "text/plain")},
            timeout=timeout,
        )
    except Exception as exc:
        raise UploadError(f"upload request failed: {exc}")
    url = (resp.text or "").strip()
    if not resp.ok or not url.startswith("https://"):
        raise UploadError(f"upload rejected (HTTP {resp.status_code}): {url[:120]}")
    return url
