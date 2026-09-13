import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  Play,
  Square,
  Target,
  XCircle,
} from "lucide-react";
import { api } from "../api.js";
import { Badge, Button, Card, Input, Spinner } from "./ui.jsx";
import LogViewer from "./LogViewer.jsx";

const fmtTime = (ts) =>
  ts ? new Date(ts * 1000).toLocaleTimeString("en-US", { hour12: false }) : "-";

const fmtDuration = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}.${pad(m)}.${pad(r)}` : `${pad(m)}.${pad(r)}`;
};

export default function StatusPanel({ onGotoAccounts }) {
  const [state, setState] = useState(null);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);
  const tickTimer = useRef(null);

  const refresh = useCallback(() => {
    api
      .get("/api/status")
      .then((data) => {
        setState(data);
        setLoadError("");
      })
      .catch((error) => setLoadError(error.message || "Status could not be loaded"));
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 1500);
    tickTimer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer.current);
      clearInterval(tickTimer.current);
    };
  }, [refresh]);

  const running = !!state?.running;
  const target = state?.target ?? 0;
  const success = state?.success ?? 0;
  const failed = state?.fail ?? 0;
  const done = success + failed;

  // progress: only meaningful when target > 0
  const progress =
    target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;

  // elapsed live counter
  const elapsedSec = useMemo(() => {
    if (!state?.started_at) return 0;
    const end = state?.finished_at ? state.finished_at * 1000 : now;
    return Math.max(0, (end - state.started_at * 1000) / 1000);
  }, [state?.started_at, state?.finished_at, now]);

  // status label + tone
  const statusInfo = useMemo(() => {
    if (running)
      return { label: "Running", tone: "ok", title: "Creating accounts" };
    if (state?.error)
      return { label: "Error", tone: "bad", title: "Job failed" };
    if (state?.finished_at) {
      if (target > 0 && done >= target && failed === 0)
        return {
          label: "Completed",
          tone: "ok",
          title: "All accounts were created",
        };
      if (target > 0 && done < target)
        return {
          label: "Stopped",
          tone: "muted",
          title: "Job stopped before completion",
        };
      if (failed > 0 && success === 0)
        return {
          label: "All failed",
          tone: "bad",
          title: "No accounts were created",
        };
      return { label: "Completed", tone: "ok", title: "Job completed" };
    }
    return { label: "Ready", tone: "muted", title: "Ready to register" };
  }, [
    running,
    state?.error,
    state?.finished_at,
    target,
    done,
    failed,
    success,
  ]);

  const progressTone = statusInfo.tone;

  async function start() {
    setBusy(true);
    try {
      await api.post("/api/start", { count });
      refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.post("/api/stop");
      refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.wrap}>
      {/* hero */}
      <Card style={styles.hero}>
        <div style={styles.heroText}>
          <div style={styles.eyebrow}>GITHUB ACCOUNT REGISTRATION</div>
          <h1 style={styles.heroTitle}>{statusInfo.title}</h1>
        </div>
        <Badge
          tone={
            statusInfo.tone === "ok"
              ? "success"
              : statusInfo.tone === "bad"
                ? "danger"
                : "muted"
          }
          className="status-hero-badge"
        >
          {running && <span className="pulse-dot" />}
          {statusInfo.label}
        </Badge>
      </Card>

      {/* Metrics use a fluid grid so the job summary remains scannable. */}
      <div style={styles.grid}>
        <Stat label="Target" value={target} icon={Target} />
        <Stat label="Success" value={success} tone="ok" icon={CheckCircle2} />
        <Stat label="Failed" value={failed} tone="bad" icon={XCircle} />
        <Stat
          label="Progress"
          value={target > 0 ? `${done}/${target}` : "-"}
          hint={target > 0 ? `${progress}%` : null}
          icon={ListChecks}
        />
        <Stat
          label="Started"
          value={fmtTime(state?.started_at)}
          icon={Play}
          small
        />
        <Stat
          label={running ? "Elapsed" : "Duration"}
          value={fmtDuration(elapsedSec)}
          icon={running ? Clock3 : Square}
          small
        />
      </div>

      {/* Show progress only after the server has a target. */}
      {target > 0 && (
        <Card style={styles.progressCard}>
          <div style={styles.progressHead}>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>
              Progress
            </span>
            <span style={{ fontWeight: 700 }}>
              {done} / {target}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                ({progress}%)
              </span>
            </span>
          </div>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${progress}%`,
                background: progressFillColor(progressTone, running),
                boxShadow: progressGlow(progressTone),
              }}
            />
          </div>
          {(success > 0 || failed > 0) && (
            <div style={styles.progressLegend}>
              <span style={{ color: "var(--ok)" }}>● {success} success</span>
              <span style={{ color: "var(--danger)" }}>● {failed} failed</span>
              {running && target - done > 0 && (
                <span style={{ color: "var(--muted)" }}>
                  ● {target - done} pending
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {state?.error && (
        <Card style={styles.errorCard}>
          <span
            style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}
          >
            <AlertTriangle
              size={15}
              style={{ verticalAlign: "text-bottom", marginRight: 6 }}
            />
            {state.error}
          </span>
        </Card>
      )}

      {/* controls */}
      <Card style={styles.controls}>
        <div style={styles.countRow}>
          <span style={styles.countLabel}>Account count</span>
          <div style={styles.stepper}>
            <Button
              type="button"
              size="sm"
              className="status-stepper-button"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              disabled={running || count <= 1}
              aria-label="Decrease count"
            >
              −
            </Button>
            <Input
              type="number"
              min="1"
              max="1000"
              value={count}
              className="status-count-input"
              onChange={(e) =>
                setCount(
                  Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
                )
              }
              disabled={running}
              style={styles.countInput}
            />
            <Button
              type="button"
              size="sm"
              className="status-stepper-button"
              onClick={() => setCount((c) => Math.min(1000, c + 1))}
              disabled={running || count >= 1000}
              aria-label="Increase count"
            >
              +
            </Button>
          </div>
        </div>
        <div style={styles.buttonRow}>
          <Button
            variant="primary"
            size="lg"
            onClick={start}
            disabled={running || busy}
          >
            <Play size={16} /> Start
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={stop}
            disabled={!running || busy}
          >
            <Square size={15} /> Stop
          </Button>
          <Button onClick={onGotoAccounts}>
            <FileText size={16} /> Accounts
          </Button>
        </div>
      </Card>

      {state === null && !loadError && (
        <Card className="status-state-card">
          <Spinner />
          <span>Loading job status</span>
        </Card>
      )}
      {loadError && (
        <Card className="status-state-card status-state-error">
          <strong>Unable to load job status</strong>
          <span>{loadError}</span>
          <Button onClick={refresh}>Retry</Button>
        </Card>
      )}

      <LogViewer />

      {/* injected responsive CSS */}
      <style>{responsiveCSS}</style>
    </div>
  );
}

function Stat({ label, value, tone, small, icon: Icon, hint }) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "bad"
        ? "var(--danger)"
        : "var(--text)";
  return (
    <Card className="stat-card" style={styles.statCard}>
      <div style={styles.statHead}>
        <Icon size={14} style={{ ...styles.statIcon, color }} />
        <span style={styles.statLabel}>{label}</span>
      </div>
      <div
        style={{
          fontSize: small ? 18 : 26,
          fontWeight: 800,
          color,
          letterSpacing: -0.5,
          lineHeight: 1.15,
          wordBreak: "break-word",
          textAlign: "center",
          width: "100%",
        }}
      >
        {value}
      </div>
      {hint && <div style={styles.statHint}>{hint}</div>}
    </Card>
  );
}

// helper: progress bar gradient depending on state
function progressFillColor(tone, running) {
  if (tone === "bad") return "var(--danger)";
  if (tone === "muted" && !running) return "var(--border-strong)";
  return "var(--accent)";
}
function progressGlow(tone) {
  return "none";
}

const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxWidth: 980,
    width: "100%",
    margin: "0 auto",
  },
  hero: {
    padding: "clamp(18px, 3vw, 26px)",
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    background:
      "var(--bg-card)",
  },
  heroText: { flex: "1 1 260px", minWidth: 0 },
  eyebrow: {
    fontSize: 11.5,
    color: "var(--muted)",
    fontWeight: 700,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: "clamp(20px, 4.5vw, 26px)",
    fontWeight: 800,
    letterSpacing: -0.4,
    lineHeight: 1.2,
    color: "var(--text-primary)",
  },
  heroDesc: {
    fontSize: 13,
    color: "var(--muted)",
    marginTop: 8,
    lineHeight: 1.55,
  },
  heroBadge: { alignSelf: "flex-start", flexShrink: 0 },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  },
  statCard: {
    padding: "18px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 8,
    minHeight: 100,
  },
  statHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  statIcon: { fontSize: 13, opacity: 0.9 },
  statLabel: {
    fontSize: 11.5,
    color: "var(--muted)",
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  statHint: {
    fontSize: 11.5,
    color: "var(--muted)",
    fontWeight: 600,
    textAlign: "center",
  },

  progressCard: { padding: "16px 20px" },
  progressHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    fontSize: 12.5,
    marginBottom: 10,
    flexWrap: "wrap",
    gap: 8,
  },
  progressTrack: {
    height: 10,
    borderRadius: 4,
    background: "var(--bg-input)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s",
  },
  progressLegend: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    marginTop: 10,
    fontSize: 12,
    fontWeight: 600,
  },

  errorCard: {
    padding: "14px 18px",
    borderColor: "rgba(var(--danger-rgb),0.4)",
  },

  controls: {
    padding: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 14,
  },
  countRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  countLabel: { fontSize: 13, color: "var(--muted)", fontWeight: 600 },
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: 4,
    background: "var(--bg-input)",
    border: "1px solid var(--glass-border)",
    borderRadius: 14,
  },
  stepperBtn: {
    padding: "6px 12px",
    fontSize: 16,
    fontWeight: 700,
    borderRadius: 10,
    minWidth: 34,
  },
  countInput: { width: 78, textAlign: "center" },

  buttonRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    flex: "1 1 auto",
    justifyContent: "flex-end",
  },
  mainBtn: { padding: "12px 28px", fontSize: 14 },
  linkBtn: {},
};

// media queries can't live in inline style; inject once per mount
const responsiveCSS = `
  @media (max-width: 640px) {
    .stat-card {
      padding: 14px 12px !important;
      min-height: 88px !important;
      gap: 6px !important;
    }
  }
  @media (max-width: 520px) {
    .status-controls-row { flex-direction: column; align-items: stretch !important; }
  }
`;
