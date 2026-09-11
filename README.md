# GitHub Register

A GitHub account registration toolkit that uses Camoufox for browser automation
and [Litensi](https://litensi.id) for verification mailboxes. It can be run
from the CLI or through a local web console.

> Use this only for accounts and workflows you are authorized to manage.
> Automated account registration may violate GitHub's Terms of Service and can
> result in account or IP restrictions.

## Features

- Creates a mailbox, password, and username for GitHub signup.
- Verifies the eight-digit GitHub launch code from Litensi Mail.
- Logs in again when a newly verified account is redirected to `/login`.
- Optionally creates a first repository, enables TOTP 2FA, and stores recovery
  codes per account.
- Optionally sets a profile status and completes profile fields after 2FA.
- Provides a web console for configuration, job control, live logs, account
  export, TOTP generation, and recovery-code viewing.

![Web console screenshot](result.png)

## Requirements

- Python 3.11 or newer.
- Node.js 18 or newer, only to rebuild the frontend.
- A Litensi account with API credentials and a balance.
- Internet access. A residential proxy may be needed depending on your network.

## Installation

```bash
git clone <repository-url> github-regkit
cd github-regkit

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

# Download Camoufox once.
python -m camoufox fetch

# Create local configuration.
cp config.example.json config.json
```

On Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### Linux (Ubuntu/Debian)

Headful mode (`headless: false`) needs a display plus the Firefox system
libraries. On a desktop these are usually already installed; on a minimal
server install them and run inside a virtual display:

```bash
# Ubuntu 22.04
sudo apt update
sudo apt install -y libgtk-3-0 libdbus-glib-1-2 libxt6 libasound2 xvfb

# Ubuntu 24.04 uses libasound2t64 instead of libasound2
sudo apt install -y libgtk-3-0 libdbus-glib-1-2 libxt6 libasound2t64 xvfb

# headless VPS — wrap headful runs with a virtual display
xvfb-run -a python main.py --count 1
```

For unattended servers, `headless: true` (or `python main.py --headless`)
works without a display, though it is slightly more likely to be flagged by
DataDome.

## Configuration

Set your local values in `config.json`. This file must never be committed.

```json
{
  "mail_provider": "mailcx",
  "mailcx_domain": "",
  "litensi_api_id": "1234",
  "litensi_api_key": "your-api-key",
  "litensi_site": "github.com",
  "litensi_zone": "",
  "register_count": 1,
  "proxy": "",
  "proxy_file": "",
  "headless": false,
  "delay_sec": 5.0,
  "max_username_tries": 6,
  "otp_timeout_sec": 240,
  "browser_profile_dir": ".browser-profile",
  "fresh_profile": true,
  "proxy_hard_block_retries": 2,
  "proxy_rate_limit_retries": 2,
  "create_repo": true,
  "repo_name": "hello",
  "enable_2fa": true,
  "set_profile_status": true,
  "profile_status": "On vacation",
  "complete_profile": true,
  "profile_name": "",
  "profile_bio": "",
  "profile_location": ""
}
```

| Field | Description |
| --- | --- |
| `mail_provider` | Mail backend: `mailcx` (free, default) or `litensi` (paid, more reliable). |
| `mailcx_domain` | Mail.cx domain. Leave blank to auto-pick from available domains. |
| `litensi_api_id` / `litensi_api_key` | Litensi API credentials (used when `mail_provider` is `litensi`). |
| `litensi_site` | Sender domain in Litensi, for example `github.com`. |
| `litensi_zone` | Mailbox zone. Leave blank to choose the cheapest in-stock zone. |
| `register_count` | Accounts to process in one job. |
| `proxy` | Optional single proxy in `http://user:pass@host:port` format. |
| `proxy_file` | Optional proxy pool file in the project root (one `scheme://user:pass@host:port` per line). Each account picks a random proxy; also settable via the web console upload. Takes precedence over `proxy`. |
| `headless` | Runs without a browser window. `false` is easier to observe and often more stable. |
| `delay_sec` | Delay between accounts. |
| `max_username_tries` | Username conflict retry limit. |
| `otp_timeout_sec` | Maximum wait time for the verification email. |
| `fresh_profile` | Uses a fresh browser profile for each account while carrying trusted cookies separately. |
| `create_repo` / `repo_name` | Enables and names the first repository. |
| `enable_2fa` | Enables TOTP 2FA and captures recovery codes. |
| `set_profile_status` / `profile_status` | Enables and sets a post-2FA profile status. |
| `complete_profile` | Enables post-2FA profile completion. |
| `profile_name`, `profile_bio`, `profile_location` | Custom profile values. Blank fields use Random User or ZenQuotes data. |

## Running

### Web console

Build the UI after frontend changes:

```bash
cd frontend
npm install
npm run build
cd ..
```

Start the local server:

```bash
source .venv/bin/activate
python -m web.server
```

Open <http://127.0.0.1:8093>.

- **Status**: start or stop jobs and inspect progress.
- **Live Log**: review events in real time.
- **Config**: edit local settings and check Litensi zones.
- **Accounts**: export accounts, copy values, generate TOTP codes, and view
  recovery codes.

Protect the web console with username + password (ala n8n/WAHA) for
self-hosting/production. Copy `.env.example` to `.env` and fill it in
(`.env` is git-ignored; server auto-loads it, no extra dependency):

```bash
cp .env.example .env
python -m web.server
```

```dotenv
GITHUB_REGISTER_HOST=127.0.0.1
GITHUB_REGISTER_PORT=8093
GITHUB_REGISTER_USERNAME=admin
GITHUB_REGISTER_PASSWORD=use-a-strong-password
```

Legacy single-password mode still works (`GITHUB_REGISTER_ACCESS_PASSWORD`),
but username+password is preferred. When auth is enabled, `/docs` swagger
is disabled and all `/api/*` require login. Login attempts are rate-limited
per IP (10 failures/60s → HTTP 429), oversized login bodies are rejected
(413), credential comparison is timing-safe, security headers are set
(`nosniff`, `DENY` framing, `no-referrer`, `no-store` on APIs),
and Sign out invalidates the server-side session via `POST /api/logout`.
The server binds to `127.0.0.1` by default — only bind `0.0.0.0` behind a trusted reverse proxy with HTTPS.

### Docker

Image multi-stage: `node:20-alpine` (build frontend) + `python:3.12-slim`
(runtime, sudah termasuk Firefox Camoufox + `xvfb` untuk mode headful):

```bash
cp .env.example .env          # isi GITHUB_REGISTER_PASSWORD yang kuat
cp config.example.json config.json
touch proxies.txt
docker compose up -d --build
```

Buka <http://localhost:8093>. Compose menimpa `GITHUB_REGISTER_HOST=0.0.0.0`
di dalam container; data persisten via bind-mount (`config.json`, `accounts/`,
`.browser-profile/`, `proxies.txt`). Untuk VPS tanpa display, set
`"headless": true` di `config.json` (lebih hemat, sedikit lebih mudah
diflag DataDome).

### VPS + nginx reverse proxy (satu network docker)

Compose sudah gabung ke network eksternal `nginx-network` dan **tidak**
publish port — akses publik hanya lewat nginx. Pastikan network ada:

```bash
docker network ls | grep nginx-network || docker network create nginx-network
docker compose up -d --build
```

Contoh server block di nginx (satu network yang sama, TLS via certbot):

```nginx
server {
    listen 443 ssl;
    server_name regkit.contoh.com;

    location / {
        proxy_pass http://app:8093;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE live-log: jangan buffer + jangan putus cepat
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

`GITHUB_REGISTER_TRUST_PROXY=1` (sudah di compose) membuat rate-limit membaca
IP asli dari `X-Forwarded-For`. Jangan aktifkan bila container di-expose
langsung tanpa proxy.

### CLI

```bash
source .venv/bin/activate
python main.py
python main.py --count 3
python main.py --proxy http://user:pass@host:port
python main.py --headless
python main.py --config config.local.json --count 1
```

Press `Ctrl+C` to stop the CLI or server. A `KeyboardInterrupt` or
`asyncio.CancelledError` during Uvicorn shutdown is expected after interruption.

## Registration Flow

1. Create a Litensi mailbox. An in-stock zone is selected automatically when
   `litensi_zone` is blank.
2. Open GitHub signup and fill email, password, and a username based on the
   mailbox local part.
3. Submit the form. If an overlay intercepts pointer clicks, the runner falls
   back to a DOM click. A disabled form is refreshed and filled with the same
   data before switching browser sessions.
4. Poll the Litensi mailbox and enter the GitHub launch code.
5. Sign in again if GitHub redirects the new account to login.
6. Create the first repository when enabled.
7. Enable TOTP 2FA, capture recovery codes, and persist them per account.
8. Optionally set profile status, then complete profile name, bio, and location.

Post-signup stage failures do not discard an account that was already verified.
The reason is written to Live Log.

## Account Output

```text
accounts/
  github_accounts_<timestamp>.txt
  recovery/
    <email-hash>.txt
```

Each account file contains one line per account:

```text
email----password----username----totp_secret----has_recovery
```

Recovery codes are stored separately under `accounts/recovery/`. The Accounts
page can reveal and copy them with the **Recovery** action.

Example account output:

```text
user@example.com----example-password----example-user----EXAMPLETOTPSECRET000
```

Generate a TOTP code manually from the fourth field:

```bash
python -c "import pyotp; print(pyotp.TOTP('EXAMPLETOTPSECRET000').now())"
```

## Recording a Manual Flow

`record_camoufox.py` opens Camoufox and records clicks, inputs, and navigation.

```bash
.venv/bin/python record_camoufox.py
.venv/bin/python record_camoufox.py --url https://github.com/login
```

Its output can contain email addresses, session URLs, and selectors. Treat
`recorded_steps.json` as sensitive local data.

## Troubleshooting

| Problem | Action |
| --- | --- |
| `BAD SITE` | Use a complete domain such as `github.com` for `litensi_site`. |
| No zone or stock | Use **Check Zone**, choose an in-stock zone, or leave it blank for automatic selection. |
| No verification email | Check Litensi balance and allow the mailbox reorder retry. |
| DataDome hard block or signup 403 | Change IP/proxy, disable VPN/WARP, then retry after a delay. |
| Create account or repository will not click | Review Live Log. Native clicks fall back to DOM clicks when an overlay intercepts them. |
| Web UI does not reflect frontend changes | Run `npm run build`, then restart `python -m web.server`. |

## Security

- Never commit `config.json`, `accounts/`, `.browser-profile/`,
  `.datadome-trust.json`, recovery codes, or browser recordings.
- Account files contain full credentials, including password and TOTP secret.
- Recovery codes grant account recovery and should be stored securely.
- Before pushing, inspect `git status --short` and `git diff --cached`.

## License

Released under the [MIT License](LICENSE).
