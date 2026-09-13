import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, Ellipsis, FileDown, FileJson, FileSpreadsheet, FileText, FolderGit2, KeyRound, Mail, Merge, Pencil, Play, Plus, ShieldCheck, Square, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { api, getToken } from '../api.js'
import { Button, Card, Dialog, EmptyState, Input, Spinner } from './ui.jsx'

const fmtSize = (n) => (n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
const fileLabel = (name) => String(name || '').replace('github_accounts_', '').replace('.txt', '')

export default function AccountsPanel({ group = '', onClearGroup, onGroupsChanged, onGotoStatus }) {
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [rows, setRows] = useState([])
  const [toast, setToast] = useState('')
  const [confirm, setConfirm] = useState(null) // {type:'row'|'file', ...}
  const [rename, setRename] = useState(null) // {name, value} | null
  const [renameBusy, setRenameBusy] = useState(false)
  const [merge, setMerge] = useState(null) // {source, target} | null
  const [mergeBusy, setMergeBusy] = useState(false)
  const [assign, setAssign] = useState(null) // {email, groups, memberOf, newName} | null
  const [assignBusy, setAssignBusy] = useState(false)
  const [recovery, setRecovery] = useState(null) // {email, codes} | null
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [resend, setResend] = useState(null) // {email, status, message, code, expired_at} | null
  const resendTimer = useRef(null)
  const triggerRefs = useRef({})
  const menuRef = useRef(null)
  const [menuEmail, setMenuEmail] = useState(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef(null)
  // Loading flags only cover user-visible loads, not background polling.
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [loadError, setLoadError] = useState('')

  function notify(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  // silent = don't show the loading indicator (used by background polling)
  const loadFiles = (silent = false) => {
    if (!silent) setLoadingFiles(true)
    return api
      .get('/api/accounts')
      .then((d) => {
        setFiles(d.files || [])
        setLoadError('')
      })
      .catch((error) => setLoadError(error.message || 'Accounts could not be loaded'))
      .finally(() => setLoadingFiles(false))
  }

  const currentName = selected || files[0]?.name || ''

  const loadRows = (name, silent = false) => {
    const target = group || name
    if (!target) {
      setRows([])
      setLoadingRows(false)
      return
    }
    if (!silent) setLoadingRows(true)
    const url = group
      ? `/api/accounts/preview?group=${encodeURIComponent(group)}`
      : `/api/accounts/preview?name=${encodeURIComponent(name)}`
    api
      .get(url)
      .then((d) => {
        setRows(d.rows || [])
        setLoadError('')
      })
      .catch((error) => {
        setRows([])
        setLoadError(error.message || 'Account preview could not be loaded')
      })
      .finally(() => setLoadingRows(false))
  }

  // Poll in the background without flashing the loading indicator.
  useEffect(() => {
    loadFiles(false)
    const t = setInterval(() => loadFiles(true), 3000)
    return () => clearInterval(t)
  }, [])

  // load preview rows whenever selection changes (or a new file appears).
  // Show the spinner ONLY for the first load or when the user picks a file;
  // subsequent silent refreshes triggered by files.length polling are silent
  // to avoid flicker.
  useEffect(() => {
    loadRows(currentName, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, currentName, group])

  async function copyAll() {
    const text = rows.map((r) => `${r.email}----${r.password}----${r.username}----${r.totp || ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      notify(`${rows.length} accounts copied to clipboard`)
    } catch {
      notify('Clipboard failed')
    }
  }

  function copyRow(row) {
    const line = `${row.email}----${row.password}----${row.username}----${row.totp || ''}`
    navigator.clipboard.writeText(line).then(
      () => notify('Row copied'),
      () => notify('Clipboard failed'),
    )
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    notify(`Exported ${filename}`)
  }

  function exportTxt() {
    const text = rows.map((r) => `${r.email}----${r.password}----${r.username}----${r.totp || ''}`).join('\n')
    download(text, 'github_accounts.txt', 'text/plain')
  }

  function exportCsv() {
    const csv = [
      'email,password,username,totp_secret',
      ...rows.map((r) => `${r.email},${r.password},${r.username},${r.totp || ''}`),
    ].join('\n')
    download(csv, 'github_accounts.csv', 'text/csv')
  }

  function exportJson() {
    download(JSON.stringify(rows, null, 2), 'github_accounts.json', 'application/json')
  }

  function downloadRaw() {
    const name = currentName
    if (!name) return
    const token = getToken()
    fetch(`/api/accounts/download?name=${encodeURIComponent(name)}`, {
      headers: token ? { 'X-Access-Key': token } : {},
    })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b)
        const link = document.createElement('a')
        link.href = u
        link.download = name
        link.click()
        URL.revokeObjectURL(u)
        notify(`Downloaded ${name}`)
      })
      .catch(() => notify('Download failed'))
  }

  async function doDeleteRow() {
    const { email } = confirm
    try {
      await api.del(`/api/accounts/row`, { email, name: currentName })
      notify(`Account ${email} deleted`)
      setConfirm(null)
      loadRows(currentName)
      loadFiles()
    } catch (e) {
      notify(e.message)
    }
  }

  async function showTotpCode(secret, email) {
    try {
      const d = await api.get(`/api/totp?secret=${encodeURIComponent(secret)}`)
      const code = String(d.code || '')
      if (!code) throw new Error('empty code')
      try {
        await navigator.clipboard.writeText(code)
        notify(`${code} copied. Expires in ${d.expires_in}s`)
      } catch {
        // Show the code when clipboard access is denied.
        notify(`${email}: ${code}. Expires in ${d.expires_in}s`)
      }
    } catch (e) {
      notify(e.message)
    }
  }

  async function copyValue(value) {
    if (!value) return false
    try {
      await navigator.clipboard.writeText(String(value))
      return true
    } catch {
      notify('Clipboard failed')
      return false
    }
  }

  async function viewRecoveryCodes(email) {
    setRecoveryLoading(true)
    try {
      const d = await api.get(`/api/accounts/recovery?email=${encodeURIComponent(email)}`)
      setRecovery({ email: d.email, codes: d.codes || [] })
    } catch (e) {
      notify(e.message)
    } finally {
      setRecoveryLoading(false)
    }
  }

  async function copyRecoveryCodes() {
    if (!recovery?.codes?.length) return
    try {
      await navigator.clipboard.writeText(recovery.codes.join('\n'))
      notify(`${recovery.codes.length} recovery codes copied`)
    } catch {
      notify('Clipboard failed')
    }
  }

  function stopResendPoll() {
    if (resendTimer.current) {
      clearInterval(resendTimer.current)
      resendTimer.current = null
    }
  }

  // Reorder the Litensi mailbox and poll until a code arrives or the server
  // stops at its own 2-minute ceiling.
  async function startResend(email) {
    stopResendPoll()
    setResend({ email, status: 'running', message: 'Reordering mailbox', code: '', expired_at: '' })
    try {
      await api.post('/api/accounts/resend', { email })
    } catch (e) {
      setResend({ email, status: 'error', message: e.message })
      return
    }
    const startedAt = Date.now()
    resendTimer.current = setInterval(async () => {
      if (Date.now() - startedAt > 150000) {
        stopResendPoll()
        setResend((cur) => cur && cur.email === email && cur.status === 'running'
          ? { ...cur, status: 'error', message: 'Stopped waiting for a code' }
          : cur)
        return
      }
      try {
        const d = await api.get(`/api/accounts/resend-status?email=${encodeURIComponent(email)}`)
        setResend((cur) => (cur && cur.email === email ? { ...cur, ...d } : cur))
        if (d.status && d.status !== 'running') stopResendPoll()
      } catch (e) {
        stopResendPoll()
        setResend((cur) => (cur && cur.email === email
          ? { ...cur, status: 'error', message: e.message }
          : cur))
      }
    }, 2000)
  }

  async function copyResendCode() {
    if (!resend?.code) return
    try {
      await navigator.clipboard.writeText(resend.code)
      notify('Code copied')
    } catch {
      notify('Clipboard failed')
    }
  }

  async function stopResend(email) {
    stopResendPoll()
    try {
      await api.post('/api/accounts/resend-stop', { email })
    } catch {
      // server state may already be finished; the local stop still applies
    }
    setResend((cur) => (cur && cur.email === email && cur.status === 'running'
      ? { ...cur, status: 'error', message: 'Resend stopped' }
      : cur))
  }

  function openMenu(row) {
    const wrap = triggerRefs.current[row.email]
    if (wrap) {
      const rect = wrap.getBoundingClientRect()
      const width = 248
      const items = 3 + (row.totp ? 1 : 0) + (row.has_recovery ? 1 : 0) + (group ? 0 : 1)
      const height = items * 42 + 14
      let top = rect.bottom + 6
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      setMenuPos({ top, left })
    }
    setMenuEmail(row.email)
  }

  function closeMenu(focusTrigger = false) {
    if (focusTrigger && menuEmail) {
      triggerRefs.current[menuEmail]?.querySelector('button')?.focus()
    }
    setMenuEmail(null)
  }

  useEffect(() => stopResendPoll, [])

  useEffect(() => {
    if (!exportOpen) return undefined
    const onPointerDown = (event) => {
      if (exportRef.current?.contains(event.target)) return
      setExportOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setExportOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [exportOpen])

  useEffect(() => {
    if (!menuEmail) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (menuRef.current?.contains(target)) return
      if (target.closest?.('[data-menu-trigger]')) return
      setMenuEmail(null)
    }
    const onScrollResize = () => setMenuEmail(null)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    menuRef.current?.querySelector('.action-menu-item:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [menuEmail])

  async function doDeleteFile() {
    const { name } = confirm
    try {
      await api.del(`/api/accounts/file?name=${encodeURIComponent(name)}`)
      notify(`File ${name} deleted`)
      setConfirm(null)
      setSelected(null)
      loadFiles()
    } catch (e) {
      notify(e.message)
    }
  }

  async function doRenameFile() {
    const { name } = rename
    const value = rename.value.trim()
    if (!value) return
    setRenameBusy(true)
    try {
      const d = await api.post('/api/accounts/rename', { name, new_name: value })
      notify(d.renamed ? `File renamed to ${d.name}` : 'Name unchanged')
      const next = d.renamed ? d.name : name
      setRename(null)
      setSelected(next)
      loadFiles()
    } catch (e) {
      notify(e.message)
    } finally {
      setRenameBusy(false)
    }
  }

  async function doMerge() {
    const { source, target } = merge || {}
    if (!source || !target || source === target) return
    setMergeBusy(true)
    try {
      const d = await api.post('/api/accounts/merge', { source, target })
      const skipped = d.skipped ? `, ${d.skipped} duplicate(s) skipped` : ''
      notify(`Moved ${d.moved} account(s) into ${fileLabel(d.target)}${skipped}`)
      setMerge(null)
      setSelected(target)
      loadFiles()
    } catch (e) {
      notify(e.message)
    } finally {
      setMergeBusy(false)
    }
  }

  async function openAssign(email) {
    setAssign({ email, groups: null, memberOf: [], newName: '' })
    try {
      const [d, m] = await Promise.all([
        api.get('/api/groups'),
        api.get(`/api/groups/membership?email=${encodeURIComponent(email)}`).catch(() => null),
      ])
      const memberOf = m?.groups || []
      setAssign((a) => (a && a.email === email ? { ...a, groups: d.groups || [], memberOf } : a))
    } catch (e) {
      setAssign(null)
      notify(e.message)
    }
  }

  async function toggleGroup(groupName) {
    if (!assign || assignBusy) return
    setAssignBusy(true)
    try {
      const d = await api.post('/api/groups/assign', { email: assign.email, group: groupName })
      const memberOf = d.groups || []
      setAssign((a) => (a && a.email === assign.email ? { ...a, memberOf } : a))
      notify(d.action === 'removed' ? `${assign.email} removed from ${groupName}` : `${assign.email} added to ${groupName}`)
      loadRows(currentName, true)
      onGroupsChanged?.()
    } catch (e) {
      notify(e.message)
    } finally {
      setAssignBusy(false)
    }
  }

  async function createAndAssign() {
    const name = assign?.newName?.trim()
    if (!name || assignBusy) return
    setAssignBusy(true)
    try {
      await api.post('/api/groups', { name })
    } catch {
      // Let the assign endpoint validate existing or invalid names.
    }
    try {
      const d = await api.post('/api/groups/assign', { email: assign.email, group: name })
      const memberOf = d.groups || []
      // Refresh counts so the new group is immediately visible.
      const list = await api.get('/api/groups').catch(() => null)
      setAssign((a) => (a && a.email === assign.email ? { ...a, groups: list?.groups || a.groups, memberOf } : a))
      notify(`${assign.email} added to ${name}`)
      loadRows(currentName, true)
      onGroupsChanged?.()
    } catch (e) {
      notify(e.message)
    } finally {
      setAssignBusy(false)
    }
  }

  async function removeFromGroup(email) {
    try {
      const d = await api.post('/api/groups/assign', { email, group })
      notify(d.action === 'removed' ? `${email} removed from ${group}` : `${email} is not a member of ${group}`)
      loadRows(currentName, true)
      onGroupsChanged?.()
    } catch (e) {
      notify(e.message)
    }
  }

  function renderEmptyState() {
    const openStatusAction = onGotoStatus ? (
      <Button variant="primary" size="sm" onClick={onGotoStatus}>
        <Play size={14} /> Open Status
      </Button>
    ) : undefined
    if (group) {
      return (
        <EmptyState
          icon={FolderGit2}
          title="This group is empty"
          description="Add accounts to this group from Registered Accounts, then manage them here."
        />
      )
    }
    if (files.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title="No accounts yet"
          description="There are no registered accounts in this console yet. Start a registration job, then return here to copy, export, or manage accounts."
          action={openStatusAction}
        />
      )
    }
    return (
      <EmptyState
        icon={FileText}
        title="This file is empty"
        description="The selected account file has no rows. Start a registration job or choose another file."
        action={openStatusAction}
      />
    )
  }

  const menuRow = menuEmail ? (rows.find((row) => row.email === menuEmail) ?? null) : null

  return (
    <div style={styles.wrap}>
      {/* header + file selector */}
      <Card className="accounts-head" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
              {group ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <FolderGit2 size={18} /> Group: {group}
                </span>
              ) : (
                'Registered Accounts'
              )}
              {(loadingFiles || loadingRows) && (
                <Spinner />
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
              {loadingRows && rows.length === 0
                ? 'Loading accounts'
                : group
                  ? <>{rows.length} accounts · across all files</>
                  : <>{rows.length} accounts {currentName && `· ${currentName}`}</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {group && (
              <Button onClick={onClearGroup} title="Back to all accounts">
                All Accounts
              </Button>
            )}
            <Button onClick={copyAll} disabled={!rows.length}><Copy size={15} /> Copy All</Button>
            <span className="export-wrap" ref={exportRef}>
              <Button
                onClick={() => setExportOpen((open) => !open)}
                disabled={!rows.length}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                title="Export accounts as a file"
              >
                <FileDown size={15} /> Export <span className="caret" aria-hidden="true">▾</span>
              </Button>
              {exportOpen && (
                <div className="action-menu action-menu-inline" role="menu" aria-label="Export accounts">
                  <MenuItem icon={FileText} onClick={() => { setExportOpen(false); exportTxt() }}>
                    Export TXT
                  </MenuItem>
                  <MenuItem icon={FileSpreadsheet} onClick={() => { setExportOpen(false); exportCsv() }}>
                    Export CSV
                  </MenuItem>
                  <MenuItem icon={FileJson} onClick={() => { setExportOpen(false); exportJson() }}>
                    Export JSON
                  </MenuItem>
                </div>
              )}
            </span>
            {!group && (
              <>
                <Button variant="primary" onClick={downloadRaw} disabled={!files.length}><Download size={15} /> Download</Button>
                {files.length > 0 && (
                  <Button
                    onClick={() => setRename({ name: currentName, value: currentName.replace('github_accounts_', '').replace('.txt', '') })}
                    disabled={!currentName}
                    title="Rename file accounts"
                  >
                    <Pencil size={15} /> Rename
                  </Button>
                )}
                {files.length > 1 && (
                  <Button
                    onClick={() => {
                      const other = files.find((f) => f.name !== currentName)?.name || ''
                      setMerge({ source: currentName, target: other })
                    }}
                    disabled={!currentName}
                    title="Move all accounts from one file into another"
                  >
                    <Merge size={15} /> Merge
                  </Button>
                )}
                {files.length > 1 && (
                  <Button variant="destructive"
                    onClick={() => setConfirm({ type: 'file', name: currentName })}
                    disabled={!currentName}
                  >
                    <Trash2 size={15} /> Delete File
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {!group && files.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {files.slice(0, 8).map((f) => {
              const active = currentName === f.name
              return (
                <Button
                  key={f.name}
                  size="sm"
                  variant={active ? 'primary' : 'outline'}
                  onClick={() => setSelected(f.name)}
                >
                  {fileLabel(f.name)}
                  <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{fmtSize(f.size)}</span>
                </Button>
              )
            })}
          </div>
        )}
      </Card>

      {/* table */}
      <Card style={{ flex: 1, padding: 0, overflow: 'hidden', minHeight: 200, position: 'relative' }}>
        {loadError ? (
          <div className="panel-state panel-state-error">
            <strong>Unable to load accounts</strong>
            <span>{loadError}</span>
            <Button onClick={() => { loadFiles(false); loadRows(currentName, false) }}>Retry</Button>
          </div>
        ) : rows.length === 0 && (loadingFiles || loadingRows) ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          renderEmptyState()
        ) : (
          <div className="accounts-table-wrap">
            <table className={group ? 'accounts-table group-view' : 'accounts-table'} style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Password</th>
                  <th style={styles.th}>Username</th>
                  <th style={styles.th}>TOTP Secret</th>
                  {!group && <th style={styles.th}>Group</th>}
                  <th style={{ ...styles.th, minWidth: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td data-label="#" style={{ ...styles.td, color: 'var(--muted)' }}>{i + 1}</td>
                    <td data-label="Email" style={styles.tdEmail}>
                      <CopyCell
                        value={r.email}
                        label="Email"
                        onCopy={() => copyValue(r.email)}
                      />
                    </td>
                    <td data-label="Password" style={{ ...styles.tdMono, color: 'var(--text-secondary)' }}>
                      <CopyCell
                        value={r.password}
                        masked
                        label="Password"
                        onCopy={() => copyValue(r.password)}
                      />
                    </td>
                    <td data-label="Username" style={{ ...styles.tdMono, color: 'var(--text-secondary)' }}>
                      <CopyCell
                        value={r.username}
                        label="Username"
                        onCopy={() => copyValue(r.username)}
                      />
                    </td>
                    <td data-label="TOTP Secret" style={{ ...styles.tdMono, color: 'var(--text-secondary)' }}>
                      {r.totp ? (
                        <CopyCell
                          value={r.totp}
                          masked
                          label="TOTP secret"
                          onCopy={() => copyValue(r.totp)}
                        />
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>-</span>
                      )}
                    </td>
                    {!group && (
                      <td data-label="Group" style={{ ...styles.td, maxWidth: 220 }}>
                        {r.groups?.length ? (
                          <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
                            {r.groups.map((g) => (
                              <button key={g} type="button" className="group-badge" onClick={() => openAssign(r.email)} title="Change this account's groups">
                                <FolderGit2 size={11} /> {g}
                              </button>
                            ))}
                          </span>
                        ) : r.group ? (
                            <button type="button" className="group-badge" onClick={() => openAssign(r.email)} title="Change this account's groups">
                            <FolderGit2 size={11} /> {r.group}
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>-</span>
                        )}
                      </td>
                    )}
                    <td data-label="Actions" style={{ ...styles.td, minWidth: 64 }}>
                      <span
                        ref={(el) => {
                          if (el) triggerRefs.current[r.email] = el
                          else delete triggerRefs.current[r.email]
                        }}
                        data-menu-trigger
                        style={{ display: 'inline-flex' }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="action-trigger"
                          aria-label="Account actions"
                          title="Account actions"
                          aria-haspopup="menu"
                          aria-expanded={menuEmail === r.email}
aria-controls="row-action-menu"
                  onClick={() => (menuEmail === r.email ? closeMenu() : openMenu(r))}
                >
                  <Ellipsis size={16} aria-hidden="true" />
                </Button>
              </span>
            </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* subtle overlay when refreshing rows while data is already shown */}
        {loadingRows && rows.length > 0 && (
          <div style={styles.tableRefresh} aria-hidden="true">
            <Spinner />
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>Loading</span>
          </div>
        )}
      </Card>

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.type === 'file' ? 'Delete account file?' : 'Delete this account?'}
        footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="destructive" onClick={confirm?.type === 'file' ? doDeleteFile : doDeleteRow}><Trash2 size={15} /> Delete</Button></>}
      >
        {confirm?.type === 'file' ? <>File <strong>{confirm.name}</strong> and all of its accounts will be permanently deleted.</> : <>Account <strong>{confirm?.email}</strong> will be deleted from {confirm?.name}. This action cannot be undone.</>}
      </Dialog>

      <Dialog
        open={!!rename}
        onClose={() => !renameBusy && setRename(null)}
        title="Rename accounts file"
        footer={<><Button onClick={() => setRename(null)} disabled={renameBusy}>Cancel</Button><Button variant="primary" onClick={doRenameFile} disabled={renameBusy || !rename?.value?.trim()}><Pencil size={15} /> Rename</Button></>}
      >
        {rename && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Renaming <strong style={{ color: 'var(--text)' }}>{rename.name}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>github_accounts_</span>
              <Input
                autoFocus
                value={rename.value}
                onChange={(e) => setRename({ ...rename, value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && !renameBusy && rename.value.trim() && doRenameFile()}
                placeholder="new-name"
                disabled={renameBusy}
                style={{ flex: 1 }}
              />
              <span style={{ fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>.txt</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Only letters, digits, <code>-</code>, <code>_</code>, and <code>.</code> are allowed.
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!merge}
        onClose={() => !mergeBusy && setMerge(null)}
        title="Merge accounts file"
        footer={
          <>
            <Button onClick={() => setMerge(null)} disabled={mergeBusy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={doMerge}
              disabled={mergeBusy || !merge?.source || !merge?.target || merge.source === merge.target}
            >
              <Merge size={15} /> Merge
            </Button>
          </>
        }
      >
        {merge && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Move every account from the source file into the target file. Accounts
              already present in the target are skipped, and the source file is removed.
            </div>
            <label style={{ display: 'grid', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Source file (moved out)
              <select
                className="ui-input"
                value={merge.source}
                onChange={(e) => setMerge({ ...merge, source: e.target.value })}
                disabled={mergeBusy}
              >
                {files.map((f) => (
                  <option key={f.name} value={f.name}>{fileLabel(f.name)}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Target file (receives accounts)
              <select
                className="ui-input"
                value={merge.target}
                onChange={(e) => setMerge({ ...merge, target: e.target.value })}
                disabled={mergeBusy}
              >
                {files.map((f) => (
                  <option key={f.name} value={f.name}>{fileLabel(f.name)}</option>
                ))}
              </select>
            </label>
            {merge.source === merge.target && (
              <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                Source and target must be different files.
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!assign}
        onClose={() => !assignBusy && setAssign(null)}
        title="Manage account groups"
      >
        {assign && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              Account <strong style={{ color: 'var(--text)' }}>{assign.email}</strong>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              One account can join multiple groups. Click to add / remove.
            </div>
            {assign.groups === null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <Spinner /> <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Loading groups</span>
              </div>
            ) : assign.groups.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No groups yet. Create one below.</div>
            ) : (
              <div className="group-pick-list">
                {assign.groups.map((g) => {
                  const isMember = assign.memberOf.includes(g.name)
                  return (
                    <button key={g.name} type="button" className={isMember ? 'group-pick member' : 'group-pick'} onClick={() => toggleGroup(g.name)} disabled={assignBusy}>
                      <span className="group-check" aria-hidden="true">{isMember && <Check size={13} />}</span>
                      <span className="group-pick-name">{g.name}</span>
                      <span className="group-pick-count">{g.count} accounts</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={assign.newName}
                onChange={(e) => setAssign({ ...assign, newName: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && createAndAssign()}
                placeholder="Or create a new group, e.g. Github"
                disabled={assignBusy}
                style={{ flex: 1 }}
              />
              <Button variant="primary" onClick={createAndAssign} disabled={assignBusy || !assign.newName.trim()}>
                <Plus size={14} /> Create & Add
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!recovery}
        onClose={() => setRecovery(null)}
        title="Recovery codes"
        footer={<><Button onClick={() => setRecovery(null)}>Close</Button><Button variant="primary" onClick={copyRecoveryCodes}><Copy size={15} /> Copy All</Button></>}
      >
        <p className="recovery-email">{recovery?.email}</p>
        <div className="recovery-codes">{recovery?.codes.map((code) => <code key={code}>{code}</code>)}</div>
        <p className="recovery-warning">Store these safely. Each recovery code can only be used once.</p>
      </Dialog>

      <Dialog
        open={!!resend}
        onClose={() => { stopResendPoll(); setResend(null) }}
        title="Resend verification code"
        footer={
          <>
            <Button onClick={() => { stopResendPoll(); setResend(null) }}>Close</Button>
            {resend?.status === 'running' && (
              <Button variant="destructive" onClick={() => stopResend(resend.email)}>
                <Square size={15} /> Stop
              </Button>
            )}
            {resend?.status === 'done' && resend.code && (
              <Button variant="primary" onClick={copyResendCode}>
                <Copy size={15} /> Copy code
              </Button>
            )}
          </>
        }
      >
        {resend && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              Mailbox <strong style={{ color: 'var(--text)' }}>{resend.email}</strong>
            </div>
            {resend.status === 'running' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                <Spinner />
                <span>Waiting for a new code. Stops automatically after 2 minutes.</span>
              </div>
            )}
            {resend.status === 'done' && resend.code && (
              <>
                <code className="resend-code">{resend.code}</code>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {resend.expired_at ? `Window open until ${resend.expired_at}` : 'Code received'}
                </div>
              </>
            )}
            {resend.status === 'error' && (
              <div style={{ fontSize: 13, color: 'var(--danger)', overflowWrap: 'anywhere' }}>
                {resend.message}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {menuRow && (
        <div
          ref={menuRef}
          id="row-action-menu"
          role="menu"
          aria-label={`Actions for ${menuRow.email}`}
          className="action-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeMenu(true)
            }
          }}
        >
          {group ? (
            <MenuItem icon={UserMinus} onClick={() => { closeMenu(); removeFromGroup(menuRow.email) }}>
              Remove from group
            </MenuItem>
          ) : (
            <MenuItem icon={UserPlus} onClick={() => { closeMenu(); openAssign(menuRow.email) }}>
              Manage groups
            </MenuItem>
          )}
          <MenuItem icon={Copy} onClick={() => { closeMenu(); copyRow(menuRow) }}>
            Copy entire row
          </MenuItem>
          {menuRow.totp && (
            <MenuItem icon={KeyRound} onClick={() => { closeMenu(); showTotpCode(menuRow.totp, menuRow.email) }}>
              Generate 2FA code
            </MenuItem>
          )}
          {menuRow.has_recovery && (
            <MenuItem
              icon={ShieldCheck}
              disabled={recoveryLoading}
              onClick={() => { closeMenu(); viewRecoveryCodes(menuRow.email) }}
            >
              View recovery codes
            </MenuItem>
          )}
          <MenuItem
            icon={Mail}
            disabled={resend?.email === menuRow.email && resend.status === 'running'}
            onClick={() => { closeMenu(); startResend(menuRow.email) }}
          >
            Resend mailbox code
          </MenuItem>
          {!group && (
            <MenuItem
              icon={Trash2}
              danger
              onClick={() => { closeMenu(); setConfirm({ type: 'row', email: menuRow.email, name: currentName }) }}
            >
              Delete account
            </MenuItem>
          )}
        </div>
      )}

      {toast && <div className="glass toast glass-strong" style={{ padding: '12px 26px', fontSize: 13.5 }}>{toast}</div>}

      <style>{accountsCSS}</style>
    </div>
  )
}

/**
 * CopyCell displays a value with an inline copy button.
 * When `masked` is true the text is dots by default; click text to toggle
 * visibility. Clicking the button always copies the REAL value regardless of
 * mask state, so users don't have to reveal the password to copy it.
 */
function CopyCell({ value, onCopy, masked = false, label = 'Value' }) {
  const [show, setShow] = useState(!masked)
  const [copied, setCopied] = useState(false)
  const text = String(value ?? '')
  const display = masked && !show ? '•'.repeat(Math.min(12, text.length || 6)) : text
  const shownLabel = label.toLowerCase()

  async function handleCopy(e) {
    e.stopPropagation()
    const ok = onCopy ? await onCopy() : false
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }

  return (
    <span style={styles.copyCell}>
      {masked ? (
        <button
          type="button"
          className="copy-toggle"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          aria-label={show ? `Hide ${shownLabel}` : `Show ${shownLabel}`}
          title={show ? `Hide ${shownLabel}` : `Show ${shownLabel}`}
        >
          {display || <span style={{ color: 'var(--text-secondary)' }}>-</span>}
        </button>
      ) : (
        <span
          style={{
            ...styles.copyText,
            cursor: 'default',
            userSelect: 'text',
          }}
          title={text || undefined}
        >
          {display || <span style={{ color: 'var(--text-secondary)' }}>-</span>}
        </span>
      )}
      {text && (
        <button
          type="button"
          className="copy-btn"
          onClick={handleCopy}
          title={copied ? `${label} copied` : `Copy ${shownLabel}`}
          aria-label={copied ? `${label} copied` : `Copy ${shownLabel}`}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </span>
  )
}

function MenuItem({ icon: Icon, danger, children, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'action-menu-item danger' : 'action-menu-item'}
      {...props}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{children}</span>
    </button>
  )
}

/** First-load skeleton: 8 shimmering rows that mirror the real table shape. */
function TableSkeleton() {
  return (
    <div style={styles.skeletonWrap}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton-row" style={styles.skeletonRow}>
          <div style={styles.skeletonBarShort} />
          <div style={styles.skeletonBar} />
          <div style={styles.skeletonBar} />
          <div style={styles.skeletonBar} />
          <div style={styles.skeletonBar} />
          <div style={styles.skeletonBarShort} />
        </div>
      ))}
    </div>
  )
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', minHeight: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 700,
    letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  },
  td: { padding: '14px 16px', fontSize: 13, verticalAlign: 'middle' },
  tdEmail: {
    padding: '14px 16px',
    fontSize: 13.5,
    fontWeight: 600,
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
  },
  tdMono: {
    padding: '14px 16px',
    fontFamily: "'SF Mono', Menlo, monospace",
    fontSize: 12.5,
    verticalAlign: 'middle',
  },
  copyCell: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  copyText: {
    display: 'inline-block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 240,
    verticalAlign: 'middle',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 998,
    background: 'rgba(11,15,20,0.72)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.2s ease',
  },
  dialog: { padding: 30, width: 400, animation: 'toastIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' },
  recoveryDialog: {
    padding: 24, width: 'min(460px, calc(100vw - 32px))',
    animation: 'toastIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  recoveryCodes: {
    display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8, padding: 12, maxHeight: '42vh', overflowY: 'auto',
    border: '1px solid var(--glass-border)', borderRadius: 12,
    background: 'var(--bg-input)',
  },
  // refresh overlay on top of an existing table
  tableRefresh: {
    position: 'absolute', inset: 0, zIndex: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(11,15,20,0.78)', backdropFilter: 'blur(3px)',
    animation: 'fadeIn 0.2s ease', pointerEvents: 'none',
  },
  // skeleton first-load layout
  skeletonWrap: {
    padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  skeletonRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr 120px',
    gap: 12, alignItems: 'center',
  },
  skeletonBar: {
    height: 14, borderRadius: 6,
    background: 'var(--bg-card-hover)',
    backgroundSize: '400% 100%',
    animation: 'shimmer 1.4s ease infinite',
  },
  skeletonBarShort: { height: 14, width: 60, borderRadius: 6, background: 'var(--border)' },
}

// injected copy-button CSS (hover/focus styling can't live in inline styles)
const accountsCSS = `
  .copy-btn {
    position: relative;
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; flex-shrink: 0;
    border-radius: 6px; border: 1px solid transparent;
    background: var(--bg-card-hover);
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
    line-height: 1;
  }
  .copy-btn::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .copy-btn:hover {
    background: rgba(var(--accent-rgb),0.16);
    color: var(--text);
    border-color: rgba(var(--accent-rgb),0.40);
  }
  .copy-btn:active { transform: scale(0.9); }
  .accounts-table-wrap { overflow: auto; max-height: calc(100vh - 320px); }
  .accounts-table { width: 100%; border-collapse: collapse; min-width: 940px; }
  .accounts-table.group-view { min-width: 780px; }
  .accounts-table tbody tr { transition: background-color 120ms ease; }
  .accounts-table tbody tr:hover { background: #151C26; }
  .accounts-table tbody tr:focus-within { background: rgba(var(--accent-rgb), 0.08); }
  .caret { font-size: 10px; line-height: 1; opacity: 0.75; }
  .export-wrap { position: relative; display: inline-flex; }
  .accounts-head { overflow: visible; }
  .action-trigger {
    width: 40px;
    min-width: 40px;
    min-height: 40px;
    padding: 0;
    justify-content: center;
    color: var(--text-muted);
  }
  .action-trigger[aria-expanded="true"] {
    background: var(--bg-card-hover);
    color: var(--text-primary);
  }
  .action-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .action-menu {
    position: fixed;
    z-index: 200;
    width: 248px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.42);
  }
  .action-menu-inline {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    left: auto;
    width: 190px;
  }
  .action-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .action-menu-item:hover:not(:disabled) { background: var(--bg-card-hover); color: var(--text-primary); }
  .action-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .action-menu-item:disabled { opacity: 0.42; cursor: not-allowed; }
  .action-menu-item svg { flex: none; color: var(--text-muted); }
  .action-menu-item:hover:not(:disabled) svg { color: var(--accent-text); }
  .action-menu-item.danger { color: var(--text-muted); }
  .action-menu-item.danger:hover:not(:disabled),
  .action-menu-item.danger:focus-visible { background: rgba(var(--danger-rgb), 0.12); color: var(--danger); }
  .action-menu-item.danger:hover:not(:disabled) svg { color: var(--danger); }
  .copy-btn:focus-visible,
  .copy-toggle:focus-visible,
  .group-badge:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .copy-toggle {
    display: inline-block;
    max-width: 240px;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
    user-select: text;
  }
  .copy-toggle[aria-pressed="false"] { user-select: none; }

  .resend-code {
    display: block; padding: 14px 16px; text-align: center;
    border: 1px solid rgba(var(--accent-rgb), 0.40); border-radius: 8px;
    background: var(--bg-input); color: var(--text-primary);
    font-family: 'SF Mono', Menlo, monospace; font-size: 26px;
    font-weight: 700; letter-spacing: 6px;
  }

  /* Keep the loading indicator visible without moving the table layout. */
  .acc-spinner {
    width: 16px; height: 16px; flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid rgba(var(--accent-rgb),0.25);
    border-top-color: var(--accent);
    animation: acc-spin 0.7s linear infinite;
    display: inline-block;
  }
  @keyframes acc-spin { to { transform: rotate(360deg); } }

  /* skeleton shimmer */
  @keyframes shimmer {
    0% { background-position: 100% 50%; }
    100% { background-position: 0 50%; }
  }

  /* responsive: collapse skeleton columns on narrow screens */
  @media (max-width: 640px) {
    .skeleton-row { grid-template-columns: 32px 1fr 1fr 120px !important; }
    .skeleton-row > :nth-child(4),
    .skeleton-row > :nth-child(5) { display: none; }
    .recovery-codes { grid-template-columns: 1fr !important; }
  }

  /* responsive: stack account rows as cards without hiding any field */
  @media (max-width: 760px) {
    .accounts-table-wrap { overflow: visible; max-height: none; }
    .accounts-table,
    .accounts-table.group-view { min-width: 0; }
    .accounts-table thead { display: none; }
    .accounts-table tbody { display: grid; gap: 10px; padding: 10px; }
    .accounts-table tbody tr {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-card);
    }
    .accounts-table tbody td {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      padding: 0;
      border: 0;
      max-width: none;
    }
    .accounts-table tbody td::before {
      content: attr(data-label);
      flex: none;
      padding-top: 2px;
      color: var(--text-secondary);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .accounts-table tbody td > :last-child {
      min-width: 0;
      margin-left: auto;
      text-align: right;
    }
    .accounts-table tbody td[data-label="#"] { display: none; }
    .accounts-table tbody td[data-label="Email"] {
      display: grid;
      gap: 6px;
      justify-items: start;
    }
    .accounts-table tbody td[data-label="Email"]::before { padding-top: 0; }
    .accounts-table tbody td[data-label="Email"] > :last-child {
      margin-left: 0;
      text-align: left;
      font-size: 14px;
    }
    .accounts-table tbody td[data-label="Actions"] { display: block; }
    .accounts-table tbody td[data-label="Actions"]::before { content: none; }
    .action-divider { display: none; }
  }
`
