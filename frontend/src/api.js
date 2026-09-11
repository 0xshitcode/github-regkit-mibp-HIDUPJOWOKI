const TOKEN_KEY = 'github-regkit-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

let _reloading = false
function authFailed(url) {
  // Login/logout endpoints report credential errors themselves — anything
  // else with 401/403 means the stored token is dead (e.g. server restarted
  // and wiped in-memory sessions): drop it and force a fresh login instead
  // of failing every poll silently forever.
  if (url.includes('/api/auth') || url.includes('/api/logout')) return false
  setToken('')
  if (!_reloading) {
    _reloading = true
    window.location.reload()
  }
  return true
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['X-Access-Key'] = token
  const resp = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (resp.status === 401 || resp.status === 403) {
    if (authFailed(url)) throw new Error('session expired — please log in again')
    throw new Error('unauthorized')
  }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.ok === false) {
    throw new Error(data.detail || data.message || `HTTP ${resp.status}`)
  }
  return data
}

async function uploadFile(url, file) {
  const headers = { 'Content-Type': 'text/plain' }
  const token = getToken()
  if (token) headers['X-Access-Key'] = token
  const resp = await fetch(url, { method: 'POST', headers, body: file })
  if (resp.status === 401 || resp.status === 403) {
    if (authFailed(url)) throw new Error('session expired — please log in again')
    throw new Error('unauthorized')
  }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.ok === false) throw new Error(data.detail || data.message || `HTTP ${resp.status}`)
  return data
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url, body) => request('DELETE', url, body),
  upload: uploadFile,
}

export async function subscribeLogs(after, onLine) {
  const token = getToken()
  const headers = {}
  if (token) headers['X-Access-Key'] = token
  const resp = await fetch('/api/logs?after=' + after, { headers })
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) authFailed('/api/logs')
    throw new Error('log stream failed')
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let closed = false

  const read = async () => {
    while (!closed) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) onLine(line.slice(6))
        }
      }
    }
  }
  read().catch(() => {})
  return () => {
    closed = true
    reader.cancel().catch(() => {})
  }
}
