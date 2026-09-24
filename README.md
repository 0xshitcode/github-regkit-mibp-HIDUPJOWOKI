# GitHub Register

Register GitHub accounts automatically with a stealth browser, free temp mail, and a live proxy pool. You get a web console for jobs, logs, and accounts, or a CLI for single runs.

> Use this only for accounts and workflows you are authorized to manage. Automated registration may violate GitHub Terms of Service and can trigger account or IP restrictions.

## Run it

```bash
git clone <repository-url> github-regkit
cd github-regkit
./run.sh
```

`run.sh` checks every dependency and skips what exists: system libraries, `.venv`, Python packages, the Camoufox browser (1.3 GB, once), the frontend build, `config.json`, and `.env`. Then it starts the console at `http://127.0.0.1:8093`.

```bash
./run.sh --cli --count 3   # register from the terminal instead
./run.sh --rebuild         # rebuild the frontend, then start the console
```

## How it works

1. The runner picks a healthy proxy (free-proxy pool + NextProxy; TCP plus HTTPS traffic checked, relay timed). With **Use proxy** on and no working node, the run FAILS instead of leaking the real IP; with it off, the run goes direct
2. Camoufox (anti-detect Firefox) opens the signup page and waits out DataDome
3. Only then it creates a PakMail inbox on server-2, so no mailbox time burns during bot checks
4. It fills email, password, and username, submits, and reads the 8-digit launch code from the inbox (list plus detail endpoint)
5. It logs in again when GitHub redirects to `/login`
6. It runs your post-signup stages: first repo, TOTP two-factor/authentication (2FA), profile status, and profile fields

Post-signup failures never discard a verified account. The reason lands in the live log.

## Features

- **Automatic IP rotation**: DataDome blocks, rate limits, and proxy failures trigger a fresh IP plus a retry of the same account (`proxy_retry_attempts`, default 2)
- **Use proxy checkbox**: on means proxy-only (empty pool fails and retries re-fetch); off means direct without proxy
- **Whitelist / blacklist**: pin known-good URLs (tried first, no sweep) or skip known-bad `ip:port`
- **Ping gates**: TCP handshake and relayed traffic must both fit `nextproxy_max_ping_ms` (default 3000)
- **Result upload**: account lines upload to a permanent free host (catbox.moe, no expiry) instead of local `.txt`; the link prints in logs, CLI, and job status, with `accounts/result_links.json` as index. Upload failure falls back to local `.txt`
- **Inbox access links**: every account saves a shareable PakMail link in `accounts/email_links.json`; copy or open it from **Accounts**
- **Re-poll inbox code**: re-read the same inbox for a new code (2 minute cap, manual stop), no reorder bookkeeping
- **Account management**: groups, merge files, export TXT/CSV/JSON, TOTP codes, recovery codes
- **Auth**: username plus password sessions, 10 failed logins per 60s per IP returns HTTP 429
- **Mobile layout**: bottom navigation plus drawer under 820 px width

## Requirements

- Linux (tested on Debian 13/WSL), macOS, or Windows with WSL
- Internet access
- A NextProxy API key (optional; the guest pool works without one and the client falls back to it when a key returns 401)
- Node.js 18 or newer (only to build the frontend; `run.sh` installs it when missing)

## Configuration

Edit `config.json` (never commit this file):

```json
{
  "pakmail_domain": "",
  "pakmail_domain_whitelist": "",
  "pakmail_domain_blacklist": "",
  "nextproxy_api_key": "",
  "nextproxy_type": "https",
  "nextproxy_country": "",
  "nextproxy_limit": 100,
  "use_proxy": true,
  "result_upload": true,
  "nextproxy_max_latency": 0,
  "register_count": 1,
  "headless": false,
  "otp_timeout_sec": 240,
  "proxy_retry_attempts": 2
}
```

| Field | Description |
| --- | --- |
| `pakmail_domain` | Fixed inbox domain; blank means auto-pick from server-2 |
| `pakmail_domain_whitelist` | CSV of preferred domains, for example `catchmail.io,ozsaip.com` |
| `pakmail_domain_blacklist` | CSV of excluded domains |
| `nextproxy_api_key` | Console API key; blank means guest pool |
| `nextproxy_type` | `https`, `socks5`, `socks4`, or `all` (`https` connects most reliably from filtered networks) |
| `nextproxy_country` | Two-letter filter such as `DE`; blank means any country |
| `nextproxy_limit` | Pool size per fetch (max 100 for guests) |
| `nextproxy_max_latency` | Drop nodes slower than this in ms; `0` means no filter |
| `use_proxy` | `false` means direct without proxy; `true` (default) fails instead of leaking the real IP |
| `freeproxy_enabled` | Auto-fetch free proxy lists (validated GitHub repos, 10-min cache) as candidates between whitelist and pool sweep |
| `result_upload` | Upload results to a permanent link instead of writing local `.txt` |
| `register_count` | Accounts per job |
| `headless` | Hide the browser window; visible mode passes bot checks more often |
| `otp_timeout_sec` | Seconds to wait for the verification mail per account |
| `proxy_retry_attempts` | Retries of the same account with a fresh IP after IP or proxy failures |
| `proxy_hard_block_retries` | Retries after a DataDome hard block |
| `proxy_rate_limit_retries` | Retries after a GitHub rate limit |
| `delay_sec` | Pause between accounts |
| `create_repo`, `repo_name` | First repository stage and name prefix |
| `enable_2fa` | TOTP 2FA stage; the secret lands in the account line |
| `complete_profile`, `profile_name`, `profile_bio`, `profile_location` | Profile stage; blanks pull Random User or ZenQuotes data |

## Web console

```bash
./run.sh
```

Open `http://127.0.0.1:8093`:

- **Status**: start or stop jobs, watch progress
- **Live Log**: stream runner events
- **Config**: edit settings, test the live proxy pool, browse PakMail domains
- **Accounts**: copy or export, TOTP codes, recovery codes, inbox links, resend code, groups, merge, delete

Protect the console before exposing it. Copy `.env.example` to `.env` (done by `run.sh`) and set strong values:

```bash
GITHUB_REGISTER_HOST=127.0.0.1
GITHUB_REGISTER_PORT=8093
GITHUB_REGISTER_USERNAME=admin
GITHUB_REGISTER_PASSWORD=admin
```

The server binds `127.0.0.1` by default. Bind `0.0.0.0` only behind a trusted HTTPS reverse proxy, and only on a network you trust: `config.json` holds real credentials.

## CLI

```bash
./run.sh --cli --count 1
.venv/bin/python main.py --count 3 --headless
```

Press `Ctrl+C` to stop. A `KeyboardInterrupt` traceback during shutdown is normal.

## Account output

```text
accounts/
  github_accounts_<timestamp>.txt
  email_links.json
  recovery/
    <email-hash>.txt
```

Each account line uses this shape:

```text
email----password----username----totp_secret----has_recovery
```

Print a login code from the fourth field:

```bash
.venv/bin/python -c "import pyotp; print(pyotp.TOTP('EXAMPLETOTPSECRET000').now())"
```

## Docker

```bash
cp .env.example .env
cp config.example.json config.json
touch .datadome-trust.json
docker compose up -d --build
```

The compose file publishes no ports; traffic enters through nginx on the external `nginx-network`. Create it once with `docker network create nginx-network`. For a local check, add a `ports` entry.

Bind-mounted files (do not delete): `config.json`, `accounts/`, `.browser-profile/`, `.datadome-trust.json`. Sessions live in memory, so log in again after each restart.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Pool has no connectable node | With Use proxy on, the account fails and the retry re-fetches; check the pool test in Config — `407` means the nodes need proxy credentials the API does not provide |
| API key returns 401 | The client falls back to the guest pool and logs it; generate a fresh key in the console when you need quota |
| No verification code in time | The account counts as FAIL and the batch continues; lengthen `otp_timeout_sec` or retry the account later |
| DataDome hard block or 403 | The runner rotates IP and retries (`proxy_retry_attempts`); when blocks persist, wait before the next batch |
| Form never appears after reloads | Same as above; datacenter IPs fail this check most, residential IPs pass it most |
| `config.json` became a directory | Docker created a folder because the file was missing before `up`; remove it, copy the example, and run `up` again |
| Console shows 403 after redeploy | Sessions die on restart while the browser keeps the old token; reload the page and log in again |
| UI ignores frontend changes | Run `./run.sh --rebuild`, then restart the server |


## Deploy to Railway

Push this repo to GitHub, then **New Project → Deploy from Repo** in Railway — no other setup:

- Build: `nixpacks.toml` installs Python + Node, system libs for Firefox, `requirements.txt`, frontend (`npm ci` + `npm run build`), and the Camoufox browser (`python -m camoufox fetch`)
- Start: `railway_start.sh` creates `config.json` from the example on first boot, fetches the browser if missing, and runs the web server
- Port: the server binds `0.0.0.0:$PORT` automatically when Railway injects `PORT`; locally it keeps `127.0.0.1:8093`
- Login: set `GITHUB_REGISTER_USERNAME` and `GITHUB_REGISTER_PASSWORD` in Railway **Variables** (defaults `admin` / `admin` come from `.env`, which Railway does not use — set real values)
- Persistence: Railway disks are ephemeral — `accounts/`, `config.json`, and the browser re-download on each redeploy. Attach a **Volume** mounted at `/app/accounts` to keep results, and keep **Result upload** on so every run also lands on a permanent link
- First boot downloads ~1 GB (browser); give it a few minutes, then open the Railway domain and log in

## Security

- Never commit `.env`, `config.json`, `accounts/`, `.browser-profile/`, `.datadome-trust.json`, recovery codes, or browser recordings
- Account files hold full credentials including password and TOTP secret
- Inspect `git status --short` and `git diff --cached` before every push

## License

Released under the [MIT License](LICENSE).
