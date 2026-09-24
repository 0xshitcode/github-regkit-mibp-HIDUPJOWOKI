import React, { useEffect, useState } from "react";
import { Save, Mail, Shield, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { Button, Card, Input, Spinner } from "./ui.jsx";

/* ───────────────────── fields ───────────────────── */

const PAKMAIL_FIELDS = [
  { key: "pakmail_domain", label: "Fixed domain (blank = auto)", group: "Mail Provider", wide: true },
  { key: "pakmail_domain_whitelist", label: "Domain whitelist (csv)", group: "Mail Provider", wide: true },
  { key: "pakmail_domain_blacklist", label: "Domain blacklist (csv)", group: "Mail Provider", wide: true },
];

const NEXTPROXY_FIELDS = [
  { key: "nextproxy_api_key", label: "NextProxy API Key", secret: true, group: "Proxy", wide: true },
  { key: "nextproxy_country", label: "Country filter (e.g. US, DE — blank = any)", group: "Proxy" },
  { key: "nextproxy_limit", label: "Pool size per fetch", type: "number", group: "Proxy" },
  { key: "nextproxy_max_latency", label: "Max latency ms (0 = off)", type: "number", group: "Proxy" },
  { key: "use_proxy", label: "Use proxy — uncheck for direct without proxy", type: "checkbox", group: "Proxy", wide: true },
  { key: "freeproxy_enabled", label: "Auto-fetch free proxy lists (validated repos)", type: "checkbox", group: "Proxy", wide: true },
  { key: "nextproxy_whitelist", label: "Whitelist (csv URLs, tried first — e.g. http://1.2.3.4:8888)", group: "Proxy", wide: true },
  { key: "nextproxy_blacklist", label: "Blacklist (csv ip:port, skipped — e.g. 2.59.132.39:3128)", group: "Proxy", wide: true },
  { key: "nextproxy_max_ping_ms", label: "Max ping ms per candidate (0 = off)", type: "number", group: "Proxy" },
  { key: "result_upload", label: "Upload results (permanent link, no local txt)", type: "checkbox", group: "Registration", wide: true },
];

const REG_FIELDS = [
  { key: "register_count", label: "Register Count", type: "number", group: "Registration" },
  { key: "delay_sec", label: "Delay between accounts (seconds)", type: "number", group: "Registration" },
  { key: "max_username_tries", label: "Max username tries", type: "number", group: "Registration" },
  { key: "otp_timeout_sec", label: "OTP timeout (seconds)", type: "number", group: "Registration" },
  { key: "headless", label: "Headless (no browser window, less stable)", type: "checkbox", group: "Registration", wide: true },
];

const ADV_FIELDS = [
  { key: "browser_profile_dir", label: "Browser profile dir (DataDome trust)", group: "Advanced", wide: true },
  { key: "proxy_hard_block_retries", label: "Proxy retries after DataDome hard block", type: "number", group: "Advanced" },
  { key: "proxy_rate_limit_retries", label: "IP rotation/retries after rate limit", type: "number", group: "Advanced" },
  { key: "proxy_retry_attempts", label: "Auto-retry same account with fresh IP on IP/proxy failure", type: "number", group: "Advanced" },
  { key: "fresh_profile", label: "Fresh browser per account (incognito-like with cloned DataDome cookie)", type: "checkbox", group: "Advanced", wide: true },
];

const POST_FIELDS = [
  { key: "repo_name", label: "Repository name", group: "Post-Signup Stages" },
  { key: "create_repo", label: "Create first repository after signup", type: "checkbox", group: "Post-Signup Stages", wide: true },
  { key: "enable_2fa", label: "Enable TOTP 2FA and save secret", type: "checkbox", group: "Post-Signup Stages", wide: true },
  { key: "set_profile_status", label: "Set profile status after 2FA", type: "checkbox", group: "Post-Signup Stages", wide: true },
  { key: "profile_status", label: "Profile status (blank = On vacation)", group: "Post-Signup Stages" },
  { key: "complete_profile", label: "Complete name, bio, and location after 2FA", type: "checkbox", group: "Post-Signup Stages", wide: true },
  { key: "profile_name", label: "Profile name (blank = Random User)", group: "Post-Signup Stages" },
  { key: "profile_bio", label: "Profile bio (blank = ZenQuotes)", group: "Post-Signup Stages" },
  { key: "profile_location", label: "Profile location (blank = Random User)", group: "Post-Signup Stages" },
];

const PAKMAIL_SERVICE = "server-2";
const PROXY_TYPES = ["socks5", "https", "socks4", "all"];

export default function ConfigPanel() {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [domains, setDomains] = useState([]);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolData, setPoolData] = useState(null);
  const [poolError, setPoolError] = useState("");

  useEffect(() => {
    api.get("/api/config").then((d) => { setCfg(d.config); setConfigError(""); })
      .catch((error) => setConfigError(error.message || "Configuration could not be loaded"));
  }, []);

  useEffect(() => { refreshDomains(); }, []);

  async function refreshDomains() {
    try {
      const d = await api.post("/api/pakmail/domains", {});
      setDomains(d.domains || []);
    } catch { /* offline — manual entry still works */ }
  }

  if (configError)
    return (
      <Card className="panel-state panel-state-error">
        <strong>Unable to load configuration</strong>
        <span>{configError}</span>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Card>
    );
  if (!cfg) return (<div className="panel-state"><Spinner /> <span>Loading configuration</span></div>);

  function set(key, value) { setCfg((c) => ({ ...c, [key]: value })); setSaved(""); }

  async function save() {
    setBusy(true);
    try {
      const patch = {
        pakmail_domain: cfg.pakmail_domain ?? "",
        pakmail_domain_whitelist: cfg.pakmail_domain_whitelist ?? "",
        pakmail_domain_blacklist: cfg.pakmail_domain_blacklist ?? "",
        nextproxy_api_key: cfg.nextproxy_api_key ?? "",
        nextproxy_type: cfg.nextproxy_type ?? "socks5",
        nextproxy_country: cfg.nextproxy_country ?? "",
      };
      for (const f of [...NEXTPROXY_FIELDS, ...REG_FIELDS, ...ADV_FIELDS, ...POST_FIELDS]) {
        if (patch[f.key] !== undefined) continue;
        if (f.type === "checkbox") patch[f.key] = !!cfg[f.key];
        else if (f.type === "number") patch[f.key] = Number(cfg[f.key] ?? 0);
        else patch[f.key] = cfg[f.key] ?? "";
      }
      const d = await api.put("/api/config", patch);
      setCfg(d.config);
      setSaved("Configuration saved");
    } catch (e) { setSaved(e.message); }
    finally { setBusy(false); }
  }

  async function checkPool() {
    setPoolOpen(true); setPoolLoading(true); setPoolError(""); setPoolData(null);
    try {
      const d = await api.post("/api/nextproxy/pool", {
        nextproxy_type: cfg.nextproxy_type ?? "socks5",
        nextproxy_country: cfg.nextproxy_country ?? "",
        nextproxy_limit: Number(cfg.nextproxy_limit ?? 20),
      });
      setPoolData(d);
    } catch (e) { setPoolError(e.message || "Unable to fetch pool"); }
    finally { setPoolLoading(false); }
  }

  return (
    <div style={styles.wrap} className="config-layout">
      <div style={styles.columns} className="cfg-columns">
        <div style={styles.col}>
          <Card style={styles.card}>
            <div style={styles.groupTitle}><Mail size={15} /> PakMail <span style={styles.badge}>Free</span></div>
            <div style={styles.fieldsGrid} className="cfg-fields">
              <div style={styles.fieldWide} className="cfg-field-wide">
                <label style={styles.field}>
                  <span style={styles.label}>Service (locked)</span>
                  <Input type="text" value="server-2" disabled style={{ width: "100%" }} />
                </label>
              </div>
              <div style={styles.fieldWide} className="cfg-field-wide">
                <label style={styles.field}>
                  <span style={styles.label}>Domain (blank = auto-pick)</span>
                  <select style={styles.select} value={cfg.pakmail_domain || ""}
                    onChange={(e) => set("pakmail_domain", e.target.value)}>
                    <option value="">Auto (random from available)</option>
                    {domains.map((d) => (<option key={d} value={d}>{d}</option>))}
                    {(cfg.pakmail_domain && !domains.includes(cfg.pakmail_domain)) && (
                      <option value={cfg.pakmail_domain}>{cfg.pakmail_domain}</option>
                    )}
                  </select>
                </label>
              </div>
              {PAKMAIL_FIELDS.map((f) => (
                <div key={f.key} style={styles.fieldWide} className="cfg-field-wide">
                  <Field f={f} value={cfg[f.key]} onChange={(v) => set(f.key, v)} />
                </div>
              ))}
            </div>
          </Card>
          <Card style={styles.card}>
            <div style={styles.groupTitle}><Shield size={15} /> NextProxy <span style={styles.badge}>Live</span></div>
            <div style={styles.fieldsGrid} className="cfg-fields">
              <div style={styles.fieldWide} className="cfg-field-wide">
                <label style={styles.field}>
                  <span style={styles.label}>Protocol</span>
                  <select style={styles.select} value={cfg.nextproxy_type || "socks5"}
                    onChange={(e) => set("nextproxy_type", e.target.value)}>
                    {PROXY_TYPES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </label>
              </div>
              {NEXTPROXY_FIELDS.map((f) => (
                <div key={f.key} style={f.wide ? styles.fieldWide : styles.fieldHalf}
                  className={f.wide ? "cfg-field-wide" : "cfg-field-half"}>
                  <Field f={f} value={cfg[f.key]} onChange={(v) => set(f.key, v)} />
                </div>
              ))}
              <div style={styles.fieldWide} className="cfg-field-wide">
                <Button variant="outline" onClick={checkPool} disabled={poolLoading}>
                  <RefreshCw size={14} /> {poolLoading ? "Fetching..." : "Test live pool"}
                </Button>
              </div>
            </div>
          </Card>
          <GroupCard name="Registration" fields={REG_FIELDS} cfg={cfg} set={set} />
        </div>
        <div style={styles.col}>
          <GroupCard name="Advanced" fields={ADV_FIELDS} cfg={cfg} set={set} />
          <GroupCard name="Post-Signup Stages" fields={POST_FIELDS} cfg={cfg} set={set} />
        </div>
      </div>
      <Card style={styles.saveBar} className="cfg-savebar">
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save configuration"}
        </Button>
        {saved && (
          <span style={{ fontSize: 13, color: saved === "Configuration saved" ? "var(--ok)" : "var(--danger)" }}>{saved}</span>
        )}
      </Card>
      {poolOpen && (
        <PoolModal loading={poolLoading} error={poolError} data={poolData} onClose={() => setPoolOpen(false)} onRefresh={checkPool} />
      )}
      <style>{layoutCSS}</style>
    </div>
  );
}

/* ───────────────────── sub-components ───────────────────── */

function GroupCard({ name, fields, cfg, set }) {
  return (
    <Card style={styles.card}>
      <div style={styles.groupTitle}>{name}</div>
      <div style={styles.fieldsGrid} className="cfg-fields">
        {fields.map((f) => (
          <div key={f.key} style={f.wide ? styles.fieldWide : styles.fieldHalf}
            className={f.wide ? "cfg-field-wide" : "cfg-field-half"}>
            <Field f={f} value={cfg[f.key]} onChange={(v) => set(f.key, v)} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Field({ f, value, onChange }) {
  if (f.type === "checkbox") {
    return (
      <label style={{ ...styles.field, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span style={{ fontSize: 13.5 }}>{f.label}</span>
      </label>
    );
  }
  if (f.type === "number") {
    return (
      <label style={styles.field}>
        <span style={styles.label}>{f.label}</span>
        <Input type="number" value={value ?? 0} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
      </label>
    );
  }
  return (
    <label style={styles.field}>
      <span style={styles.label}>{f.label}</span>
      <Input type={f.secret ? "password" : "text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
    </label>
  );
}

function PoolModal({ loading, error, data, onClose, onRefresh }) {
  return (
    <div className="ui-dialog-backdrop" onMouseDown={onClose}>
      <div className="ui-dialog" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={styles.modalTitle}>NextProxy Live Pool</div>
        {loading && (<div className="panel-state"><Spinner /> <span>Fetching + probing from this host (up to ~15s)...</span></div>)}
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        {data && (
          <>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
              {data.usable ?? data.count} of {data.count} reach from this host
              {data.credits_remaining ? ` · credits: ${data.credits_remaining}` : ""}
            </div>
            <div style={{ maxHeight: 320, overflow: "auto", fontSize: 12.5, fontFamily: "monospace" }}>
              {(data.proxies || []).map((p, i) => (
                <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: p.ok ? "var(--success)" : "var(--danger)" }}>
                    {p.ok ? "●" : "○"}
                  </span>{" "}
                  {p.ip}:{p.port} · {p.protocol} · {p.country} · {p.latency}ms
                  {p.detail ? ` · ${p.detail}` : ""}
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="outline" onClick={onRefresh}>Refresh</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 },
  columns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" },
  col: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  card: { padding: 16 },
  groupTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 650, marginBottom: 12 },
  badge: { fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(59,158,255,.15)", color: "var(--accent)" },
  fieldsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  fieldWide: { gridColumn: "1 / -1" },
  fieldHalf: {},
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12.5, color: "var(--muted)" },
  select: { background: "var(--bg-raise)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 13.5, minHeight: 44 },
  saveBar: { display: "flex", alignItems: "center", gap: 12, padding: 14 },
  modalTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 },
};

const layoutCSS = `
@media (max-width: 900px) { .cfg-columns { grid-template-columns: 1fr !important; } }
`;
