import { createOpsSocket } from "./ws.js";

const $ = (id) => document.getElementById(id);
const JOB = "primary"; // this simple UI drives a single autodrop job

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function short(a) { return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? "—"); }

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const state = { job: null, dryRunMaster: false, sock: null };

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3200);
}

/* ---------- login ---------- */
function showLogin() { $("login-view").classList.remove("hidden"); $("app-view").classList.add("hidden"); }
function showApp() { $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); }

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("/login", { method: "POST", body: { password: $("login-password").value } });
    $("login-password").value = "";
    await init();
  } catch (err) { $("login-error").textContent = err.message; }
});
$("logout-btn").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST" }); } catch {}
  if (state.sock) state.sock.close();
  showLogin();
});

/* ---------- views ---------- */
function showView(id) {
  for (const v of ["view-dash", "view-settings"]) $(v).classList.toggle("hidden", v !== id);
}
function openSettings() {
  showView("view-settings");
  const j = state.job;
  // prefill from current job (key is never returned — left blank means "keep")
  $("s-key").value = "";
  $("s-drop").value = j?.airdropToken ?? "";
  $("s-hold").value = j?.holdToken ?? "";
  $("s-min").value = j?.minHolding ?? "";
  $("s-startblock").value = j?.holdersStartBlock ?? "";
  $("s-interval").value = j?.intervalMinutes ?? "";
  $("s-mineth").value = j?.minEthPerRound ?? "";
  $("s-feetier").value = String(j?.feeTier ?? 10000);
  $("s-maxrec").value = j?.maxRecipients ?? "";
  $("s-result").textContent = "";
}
$("settings-btn").addEventListener("click", openSettings);
$("settings-back").addEventListener("click", () => { showView("view-dash"); void loadJob(); });
$("settings-cancel").addEventListener("click", () => { showView("view-dash"); void loadJob(); });

$("s-key-eye").addEventListener("click", () => {
  const el = $("s-key");
  const show = el.type === "password";
  el.type = show ? "text" : "password";
  $("s-key-eye").textContent = show ? "hide" : "show";
});

/* ---------- feed ---------- */
const FEED_MAX = 300;
function feedLine(html, cls = "") {
  const feed = $("feed");
  if (!feed) return;
  const line = document.createElement("div");
  line.className = "line";
  const t = new Date().toISOString().slice(11, 19);
  line.innerHTML = `<span class="t">${t}</span> ${cls ? `<span class="type ${cls}">${cls}</span> ` : ""}${html}`;
  feed.appendChild(line);
  while (feed.childNodes.length > FEED_MAX) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

/* ---------- modal ---------- */
let modalFn = null;
function openModal(title, body, label, fn) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = body;
  $("modal-confirm").textContent = label;
  modalFn = fn;
  $("modal-overlay").classList.add("open");
}
function closeModal() { $("modal-overlay").classList.remove("open"); modalFn = null; }
$("modal-cancel").addEventListener("click", closeModal);
$("modal-confirm").addEventListener("click", async () => { const fn = modalFn; closeModal(); if (fn) await fn(); });

/* ---------- dashboard ---------- */
async function loadJob() {
  let s;
  try { s = await api(`/autodrop/${JOB}/status`); } catch { return; }
  if (s.exists === false) {
    state.job = null;
    $("no-job").classList.remove("hidden");
    $("dash-body").classList.add("hidden");
    return;
  }
  state.job = s;
  $("no-job").classList.add("hidden");
  $("dash-body").classList.remove("hidden");

  $("d-balance").textContent = `${Number(s.ethBalance).toFixed(4)} ETH`;
  $("d-wallet").textContent = s.wallet;
  $("d-drop").textContent = short(s.airdropToken);
  $("d-hold").textContent = short(s.holdToken);
  $("d-min").textContent = s.minHolding ?? "0";
  $("d-interval").textContent = `${s.intervalMinutes} min`;
  $("d-last").textContent = s.lastResult ?? "—";

  // scheduler pill + resume/pause button reflect the job's enabled flag
  const pill = $("scheduler-pill");
  pill.className = `pill ${s.enabled ? "on" : "paused"}`;
  $("scheduler-text").textContent = s.enabled ? "running" : "paused";
  const st = $("sched-toggle");
  st.textContent = s.enabled ? "Pause" : "Resume";
  st.className = `btn ${s.enabled ? "red" : "green"}`;

  // master live/safe banner
  const dry = s.dryRunMaster;
  const banner = $("mode-banner");
  banner.className = `mode-banner ${dry ? "safe" : "live"}`;
  $("mode-label").textContent = dry ? "SAFE MODE" : "LIVE — MAINNET";
  $("mode-desc").textContent = dry
    ? "Simulating only — no real transactions are sent."
    : "Real transactions. Rounds move real funds from the wallet.";
  $("mode-toggle").textContent = dry ? "Go LIVE (mainnet)" : "Switch to SAFE";
  $("mode-toggle").className = `btn ${dry ? "amber" : "ghost"}`;
  state.dryRunMaster = dry;
}

/* live countdown, ticks off nextRunAt */
setInterval(() => {
  const s = state.job;
  if (!s || !s.nextRunAt) { $("d-countdown").textContent = state.job ? "—" : ""; return; }
  const ms = s.nextRunAt - Date.now();
  const total = s.intervalMinutes * 60000;
  if (ms <= 0) { $("d-countdown").textContent = "00:00"; $("d-progress").style.width = "100%"; return; }
  const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
  $("d-countdown").textContent = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  $("d-progress").style.width = `${Math.min(100, 100 - (ms / total) * 100)}%`;
}, 1000);

$("copy-wallet").addEventListener("click", () => {
  if (state.job?.wallet) { navigator.clipboard?.writeText(state.job.wallet); toast("wallet address copied", "ok"); }
});

$("setup-btn")?.addEventListener("click", openSettings);

/* preview (dry) */
$("preview-btn").addEventListener("click", async () => {
  feedLine("previewing round (dry)…");
  try {
    const r = await api(`/autodrop/${JOB}/run`, { method: "POST", body: { dryRun: true } });
    feedLine(`${r.phase} — ${esc(r.detail)}`, r.phase === "error" ? "error" : "");
    if (r.top?.length) for (const t of r.top) feedLine(`  ${short(t.address)} would get ${t.amount} ${r.airdropSymbol ?? ""}`);
    toast(r.phase === "error" ? "preview failed — see console" : "preview done", r.phase === "error" ? "err" : "ok");
    await loadJob();
  } catch (err) { feedLine(esc(err.message), "error"); toast(err.message, "err"); }
});

/* trigger round (live) */
$("trigger-btn").addEventListener("click", () => {
  const s = state.job;
  if (!s) return;
  openModal(
    "Trigger round now",
    `Swaps this wallet's ETH on Uniswap for <b>${short(s.airdropToken)}</b> and sends it to qualifying holders.${s.dryRunMaster ? " <br><br><b>Master DRY-RUN is on</b> — this will simulate only." : " <br><br>This sends real transactions."}`,
    "Run round",
    async () => {
      feedLine("triggering round (LIVE)…");
      try {
        const r = await api(`/autodrop/${JOB}/run`, { method: "POST", body: { dryRun: false } });
        feedLine(`${r.phase} — ${esc(r.detail)}`, r.phase === "error" ? "error" : "journal");
        toast(r.phase === "error" ? "round failed — see console" : `round ${r.phase}`, r.phase === "error" ? "err" : "ok");
        await loadJob();
      } catch (err) { feedLine(esc(err.message), "error"); toast(err.message, "err"); }
    },
  );
});

/* scheduler pause/resume — both the header pill and the dashboard button */
async function toggleScheduler() {
  const s = state.job;
  if (!s) return;
  try {
    await api(`/autodrop/${JOB}/toggle`, { method: "POST", body: { enabled: !s.enabled } });
    toast(s.enabled ? "airdrop paused" : "airdrop resumed", "ok");
    feedLine(s.enabled ? "airdrop scheduler paused" : "airdrop scheduler resumed");
    await loadJob();
  } catch (err) { toast(err.message, "err"); }
}
$("scheduler-pill").addEventListener("click", toggleScheduler);
$("sched-toggle").addEventListener("click", toggleScheduler);

/* master live/safe switch */
$("mode-toggle").addEventListener("click", () => {
  const goingLive = state.dryRunMaster; // currently dry -> going live
  if (!goingLive) {
    // switching back to safe: no confirm needed
    void setMode(false);
    return;
  }
  openModal(
    "Go LIVE on mainnet",
    "This turns off simulation. Every round — automatic and manual — will send <b>real transactions</b> that move real funds from the airdrop wallet. Make sure your admin password is strong. Continue?",
    "Yes, go LIVE",
    () => setMode(true),
  );
});
async function setMode(live) {
  try {
    await api("/mode", { method: "POST", body: { live } });
    toast(live ? "LIVE — real transactions armed" : "back to SAFE (simulate only)", live ? "err" : "ok");
    feedLine(live ? "MASTER MODE: LIVE — real transactions" : "MASTER MODE: SAFE — simulate only", live ? "error" : "");
    await loadJob();
  } catch (err) { toast(err.message, "err"); }
}

/* ---------- settings save ---------- */
$("save-btn").addEventListener("click", async () => {
  const drop = $("s-drop").value.trim();
  const hold = $("s-hold").value.trim();
  if (!drop || !hold) { $("s-result").textContent = "airdrop token and hold token are both required"; return; }
  $("save-btn").disabled = true;
  $("s-result").textContent = "saving…";
  try {
    const body = {
      id: JOB,
      airdropToken: drop,
      holdToken: hold,
      minHolding: $("s-min").value.trim(),
      holdersStartBlock: $("s-startblock").value.trim(),
      intervalMinutes: Number($("s-interval").value.trim() || "5"),
      minEthPerRound: $("s-mineth").value.trim(),
      feeTier: Number($("s-feetier").value),
      maxRecipients: Number($("s-maxrec").value.trim() || "300"),
    };
    // if a private key was pasted, import it to the vault first (never stored raw)
    const pk = $("s-key").value.trim();
    if (pk) {
      const k = await api("/keys", { method: "POST", body: { name: `airdrop-${JOB}`, privateKey: pk } });
      body.keyRef = `vault:${k.id}`;
      $("s-key").value = "";
    } else if (!state.job) {
      throw new Error("paste the wallet private key (needed the first time)");
    }
    const r = await api("/autodrop", { method: "PUT", body });
    $("s-result").textContent = `saved — airdrop wallet ${r.wallet}`;
    toast("settings saved", "ok");
    feedLine(`settings saved — wallet ${short(r.wallet)}`);
    await loadJob();
    showView("view-dash");
  } catch (err) {
    $("s-result").textContent = `error: ${err.message}`;
    toast(err.message, "err");
  } finally {
    $("save-btn").disabled = false;
  }
});

/* ---------- ws ---------- */
function connectWs() {
  if (state.sock) state.sock.close();
  state.sock = createOpsSocket("/ws", { onStatus: () => {} });
  state.sock.on("*", (evt) => {
    const d = evt.data ?? {};
    if (evt.type === "airdrop_tx") feedLine(`sent ${d.i}/${d.n} to ${short(d.recipient)}`, "journal");
    else if (evt.type === "journal" && d.detail) feedLine(esc(d.detail), d.type === "error" ? "error" : "");
    else if (evt.type === "round_end") { feedLine("round complete", "journal"); void loadJob(); }
  });
  state.sock.connect();
}

/* ---------- boot ---------- */
async function init() {
  const me = await api("/me");
  state.dryRunMaster = me.dryRunMaster;
  showApp();
  connectWs();
  await loadJob();
}

(async () => { try { await init(); } catch { showLogin(); } })();
