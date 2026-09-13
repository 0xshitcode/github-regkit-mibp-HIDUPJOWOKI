import React, { useEffect, useRef, useState } from 'react'
import { ListEnd, Radio, Trash2 } from 'lucide-react'
import { api, subscribeLogs } from '../api.js'
import { Badge, Button, Card, EmptyState } from './ui.jsx'

export default function LogViewer() {
  const [lines, setLines] = useState([])
  const [follow, setFollow] = useState(true)
  const [live, setLive] = useState(false)
  const [loadError, setLoadError] = useState('')
  const boxRef = useRef(null)
  useEffect(() => {
    let closed = false; let unsubscribe = () => {}
    api.get('/api/logs/snapshot?limit=500').then((data) => {
      if (closed) return
      setLines(data.lines || []); setLive(true)
      setLoadError('')
      subscribeLogs(data.seq || 0, (line) => !closed && setLines((prev) => [...prev.slice(-1499), line])).then((unsub) => { if (!closed) unsubscribe = unsub }).catch(() => {})
    }).catch((error) => {
      if (!closed) setLoadError(error.message || 'Logs could not be loaded')
    })
    return () => { closed = true; unsubscribe(); setLive(false) }
  }, [])
  useEffect(() => {
    const el = boxRef.current
    if (!follow || !el) return
    // Keep the newest event visible while the stream is active.
    el.scrollTop = el.scrollHeight
  }, [lines, follow])
  const color = (line) => line.includes('[+]') ? 'success' : line.includes('[-]') || line.includes('[!]') ? 'danger' : line.includes('[*]') ? 'accent' : ''
  return <div className="log-layout">
    <Card className="log-toolbar"><div className="log-toolbar-group"><Badge tone={live ? 'success' : 'muted'}><Radio size={12} />{live ? 'Streaming' : 'Connecting'}</Badge><span>{lines.length} lines</span></div><div className="log-toolbar-group"><label className="log-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Auto-scroll</label><Button size="sm" onClick={() => setLines([])}><Trash2 size={14} /> Clear</Button></div></Card>
     <Card className="log-terminal" ref={boxRef}>{loadError ? <div className="panel-state panel-state-error"><strong>Unable to load logs</strong><span>{loadError}</span><Button onClick={() => window.location.reload()}>Retry</Button></div> : lines.length === 0 ? <EmptyState icon={ListEnd} title="No logs yet" description="Start a job from the Status page to view events in real time." /> : lines.map((line, index) => <div key={index} className={`log-line ${color(line)}`}>{line}</div>)}</Card>
  </div>
}
