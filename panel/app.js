import { createOpsSocket } from "./ws.js";

/* ---------------------------------------------------------------- helpers */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtEth(wei, dp = 6) {
  if (wei === null || wei === undefined) return "—";
  try {
    return (Number(BigInt(wei)) / 1e18).toFixed(dp);
  } catch {
    return String(wei);
  }
}

function fmtUnits(raw, decimals = 18, dp = 2) {
  try {
    return (Number(BigInt(raw)) / 10 ** decimals).toFixed(dp);
  } catch {
    return String(raw);
  }
}

function short(addr) {
  return addr && addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : String(addr ?? "—");
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------------------------------------------------------------- state */

const state = {
  projects: [],
  current: null, // project id
  dryRunMaster: false,
  status: null, // last /status payload
  sock: null,
};

function currentProject() {
  return state.projects.find((p) => p.id === state.current) ?? null;
}

/* ---------------------------------------------------------------- login */

function showLogin() {
  $("login-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
}

function showApp() {
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("/login", { method: "POST", body: { password: $("login-password").value } });
    $("login-password").value = "";
    await init();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await api("/logout", { method: "POST" });
  } catch {
    /* session already gone */
  }
  if (state.sock) state.sock.close();
  showLogin();
});

/* ---------------------------------------------------------------- feed */

const FEED_MAX = 400;

function feedLine(html, cls = "") {
  const feed = $("feed");
  const line = document.createElement("div");
  line.className = "line";
  const t = new Date().toISOString().slice(11, 19);
  line.innerHTML = `<span class="t">${t}</span> ${cls ? `<span class="type ${cls}">${cls}</span> ` : ""}${html}`;
  feed.appendChild(line);
  while (feed.childNodes.length > FEED_MAX) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

function describeEvent(evt) {
  const d = evt.data ?? {};
  switch (evt.type) {
    case "journal": {
      const bits = [d.type, d.dryRun ? "(dry)" : "", d.amount ? `amt=${d.amount}` : "", d.to ? `to=${short(d.to)}` : "", d.txHash ? `tx=${short(d.txHash)}` : "", d.detail ?? ""];
      return bits.filter(Boolean).join(" ");
    }
    case "scan":
      return d.upToDate ? `scan up to date @ ${d.head}` : `scan ${d.from}-${d.to}: ${d.transfers} transfers`;
    case "airdrop_tx":
      return `drop ${d.i}/${d.n} ${short(d.recipient)} amt=${d.amount} tx=${short(d.txHash)}`;
    case "cycle":
      return `claim cycle ${d.phase}${d.dryRun ? " (dry)" : ""}`;
    case "round_plan":
      return `round planned: ${d.recipientCount} recipients${d.dryRun ? " (dry)" : ""}`;
    case "round_end":
      return `round end: ${d.recipientCount ?? "?"} recipients, failed=${d.failedCount ?? 0}${d.dryRun ? " (dry)" : ""}`;
    default:
      return JSON.stringify(d).slice(0, 200);
  }
}

/* ---------------------------------------------------------------- modal */

let modalOnConfirm = null;

function openModal(title, bodyHtml, confirmLabel, onConfirm) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-confirm").textContent = confirmLabel;
  modalOnConfirm = onConfirm;
  $("modal-overlay").classList.add("open");
}

function closeModal() {
  $("modal-overlay").classList.remove("open");
  modalOnConfirm = null;
}

$("modal-cancel").addEventListener("click", closeModal);
$("modal-confirm").addEventListener("click", async () => {
  const fn = modalOnConfirm;
  closeModal();
  if (fn) await fn();
});

/* ---------------------------------------------------------------- views */

function showView(id) {
  for (const v of ["view-main", "view-settings", "view-autodrop"]) $(v).classList.toggle("hidden", v !== id);
}

function openSettings() {
  showView("view-settings");
  void loadConfig();
  void loadKeys();
}

$("settings-btn").addEventListener("click", openSettings);
$("btn-open-settings").addEventListener("click", openSettings);

$("btn-settings-back").addEventListener("click", () => {
  showView("view-main");
  void loadStatus();
});

$("autodrop-btn").addEventListener("click", () => {
  showView("view-autodrop");
  void loadAutodrop();
});

$("btn-autodrop-back").addEventListener("click", () => {
  showView("view-main");
  void loadStatus();
});

/* ---------------------------------------------------------------- dashboard */

async function loadStatus() {
  if (!state.current) return;
  const s = await api(`/projects/${state.current}/status`);
  state.status = s;
  const dec = s.tokenMeta?.decimals ?? 18;

  $("d-eth").textContent = fmtEth(s.balances.eth);
  $("d-weth").textContent = fmtEth(s.balances.weth);
  $("d-token").textContent = fmtUnits(s.balances.token, dec);
  $("d-token-sym").textContent = s.tokenMeta?.symbol ?? "TOKEN";
  $("d-claimable").textContent =
    s.claimable && !s.claimable.error
      ? `${fmtEth(s.claimable.netWethWei)} WETH + ${fmtUnits(s.claimable.netTokenRaw, dec)} ${s.tokenMeta?.symbol ?? ""}`
      : (s.claimable?.error ?? "n/a");

  const p = currentProject();
  const rows = [
    ["wallet", s.botAddress],
    ["recipient", s.recipient ? `${s.recipient} ${s.recipientOk ? "· OK (this wallet)" : "· MISMATCH"}` : "n/a"],
    ["locker", s.locker ? `${s.locker} (${s.lockerGeneration}, protocol ${s.protocolFeeSharePct}%)` : "claim disabled"],
    ["claim status", s.claimDisabledReason ? `DISABLED: ${s.claimDisabledReason}` : "enabled"],
    ["index", `block ${s.index.lastScannedBlock ?? "never"} · ${s.index.tracked} tracked`],
    ["routing", p ? `${p.treasuryPct}% treasury ${short(p.treasuryWallet)} / ${100 - p.treasuryPct}% kumo ${short(p.kumoWallet)}` : ""],
    ["allowlist", (s.allowlist ?? []).map(short).join(", ")],
  ];
  $("d-info").innerHTML = rows
    .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
    .join("");

  const st = s.stats;
  const totals = [
    ["WETH claimed (net)", `${st.totalClaimedWethEth} ETH`],
    ["ETH → kumo", `${st.totalForwardedKumoEth} ETH`],
    ["ETH → treasury", `${st.totalForwardedTreasuryEth} ETH`],
    ["token → treasury", fmtUnits(st.totalTokenForwardedRaw, dec)],
    ["airdropped ETH", fmtEth(st.totalAirdroppedEthWei)],
    ["airdropped token", fmtUnits(st.totalAirdroppedTokenRaw, dec)],
    ["claims / rounds / errors", `${st.claimCount} / ${st.roundCount} / ${st.errorCount}`],
    ["last claim", st.lastClaimAt ?? "never"],
    ["last round", st.lastRoundAt ?? "never"],
  ];
  $("d-stats").innerHTML = totals
    .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
    .join("");
}

/* next-auto-claim countdown, ticking client-side off /status timestamps */
setInterval(() => {
  const s = state.status;
  const el = $("d-timer");
  if (!el) return;
  if (!s || !s.nextClaimAt) {
    el.textContent = "";
    return;
  }
  const ms = s.nextClaimAt - Date.now();
  if (ms <= 0) {
    el.textContent = "next auto claim: any moment now…";
    return;
  }
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  el.textContent = `next auto claim in ${m}:${String(sec).padStart(2, "0")} (every ${s.claimIntervalMinutes} min)${s.claimBusy ? " · cycle running…" : ""}`;
}, 1000);

$("btn-claim-dry").addEventListener("click", async () => {
  feedLine("force claim (dry) requested…");
  try {
    const r = await api(`/projects/${state.current}/claim`, { method: "POST", body: { dryRun: true } });
    feedLine(`claim cycle done — ${r.entries.length} journal entries`);
    await loadStatus();
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
});

$("btn-claim-live").addEventListener("click", () => {
  const s = state.status;
  if (!s) return;
  const dec = s.tokenMeta?.decimals ?? 18;
  const claimableTxt =
    s.claimable && !s.claimable.error
      ? `${fmtEth(s.claimable.netWethWei)} WETH net + ${fmtUnits(s.claimable.netTokenRaw, dec)} token`
      : "unknown";
  openModal(
    "FORCE FEE CLAIM — LIVE",
    `<div class="kv">
      <div class="k">claimable</div><div class="v">${esc(claimableTxt)}</div>
      <div class="k">recipient ok</div><div class="v">${s.recipientOk ? "yes" : "NO — will refuse"}</div>
      <div class="k">master dry run</div><div class="v">${state.dryRunMaster ? "ON — this will still be dry" : "off"}</div>
    </div>
    <p style="margin-top:8px">Runs the full cycle: claim &rarr; unwrap &rarr; forward ETH &rarr; forward token.</p>`,
    "[ RUN LIVE CLAIM ]",
    async () => {
      feedLine("force claim (LIVE) requested…");
      try {
        const r = await api(`/projects/${state.current}/claim`, { method: "POST", body: { dryRun: false } });
        feedLine(`live claim cycle done — ${r.entries.length} journal entries`);
        await loadStatus();
      } catch (err) {
        feedLine(esc(err.message), "error");
      }
    },
  );
});

/* ---------------------------------------------------------------- holders */

function renderHolders(data) {
  const dec = state.status?.tokenMeta?.decimals ?? 18;
  const total = data.holders.reduce((a, h) => a + BigInt(h.balance), 0n);
  $("h-count").textContent = `(${data.holderCount})`;
  $("h-rows").innerHTML = data.holders
    .map((h, i) => {
      const share = total > 0n ? Number((BigInt(h.balance) * 10000n) / total) / 100 : 0;
      return `<tr><td>${i + 1}</td><td>${esc(h.address)}</td><td>${fmtUnits(h.balance, dec, 4)}</td><td>${share.toFixed(2)}%</td></tr>`;
    })
    .join("");
  if (data.index) {
    $("h-info").textContent = `index @ block ${data.index.lastScannedBlock ?? "never"} · ${data.index.tracked} tracked addresses`;
  }
}

function holderParams() {
  const body = {};
  if ($("h-min").value.trim()) body.minBalance = $("h-min").value.trim();
  if ($("h-topn").value.trim()) body.topN = Number($("h-topn").value.trim());
  return body;
}

async function loadHolders() {
  if (!state.current) return;
  try {
    const q = new URLSearchParams(holderParams()).toString();
    renderHolders(await api(`/projects/${state.current}/holders${q ? `?${q}` : ""}`));
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

$("btn-snapshot").addEventListener("click", async () => {
  const btn = $("btn-snapshot");
  btn.disabled = true;
  btn.textContent = "[ SCANNING… ]";
  feedLine("holder snapshot: scanning transfer events…");
  try {
    const data = await api(`/projects/${state.current}/snapshot`, { method: "POST", body: holderParams() });
    renderHolders(data);
    feedLine(`snapshot done — ${data.holderCount} holders (${data.scan.transfers} new transfers)`);
  } catch (err) {
    feedLine(esc(err.message), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "[ SNAPSHOT ]";
  }
});

$("btn-holders-refresh").addEventListener("click", () => void loadHolders());

/* ---------------------------------------------------------------- rounds */

$("r-mode").addEventListener("change", () => {
  const mode = $("r-mode").value;
  $("r-budget-field").classList.toggle("hidden", mode === "token");
  $("r-tokenamt-field").classList.toggle("hidden", mode !== "token");
});

async function loadRounds() {
  if (!state.current) return;
  try {
    const { rounds } = await api(`/projects/${state.current}/rounds`);
    const p = currentProject();
    $("r-rows").innerHTML = rounds
      .map((r) => {
        const amt = r.asset === "eth" ? `${fmtEth(r.amount)} ETH` : `${r.amount} units`;
        const tx = r.txHash && p?.explorerBase ? `<a href="${p.explorerBase}/tx/${r.txHash}" target="_blank">${short(r.txHash)}</a>` : short(r.txHash ?? "");
        return `<tr><td>${esc(r.ts)}</td><td>${esc(r.detail ?? "")}</td><td>${esc(r.asset ?? "")}</td><td>${r.recipientCount ?? ""}</td><td>${amt}</td><td>${r.failedCount ?? 0}</td><td>${r.dryRun ? "yes" : ""}</td><td>${tx}</td></tr>`;
      })
      .join("");
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

function roundSpec(dryRun) {
  const mode = $("r-mode").value;
  const spec = { mode, distribution: $("r-dist").value, dryRun };
  if (mode === "token") spec.tokenAmount = $("r-tokenamt").value.trim();
  else spec.budgetEth = $("r-budget").value.trim();
  if ($("r-topn").value.trim()) spec.topN = Number($("r-topn").value.trim());
  if ($("r-min").value.trim()) spec.minBalance = $("r-min").value.trim();
  return spec;
}

async function planAndConfirm(dryRun, specOverride = null) {
  feedLine(`planning round (${dryRun ? "dry" : "LIVE"})…`);
  let plan;
  try {
    plan = await api(`/projects/${state.current}/rounds/plan`, { method: "POST", body: specOverride ?? roundSpec(dryRun) });
  } catch (err) {
    feedLine(esc(err.message), "error");
    return;
  }

  const dec = state.status?.tokenMeta?.decimals ?? 18;
  const amt = (v) => (plan.asset === "eth" ? `${fmtEth(v)} ETH` : `${fmtUnits(v, dec, 4)} token`);
  const body = `
    <div class="kv">
      <div class="k">mode</div><div class="v">${esc(plan.mode)} / ${esc(plan.distribution)}</div>
      <div class="k">recipients</div><div class="v">${plan.recipientCount}</div>
      <div class="k">total distributed</div><div class="v">${amt(plan.totalDistributed)}${plan.quotedOut ? " (quoted)" : ""}</div>
      <div class="k">per-recipient</div><div class="v">${amt(plan.minAmount)} … ${amt(plan.maxAmount)}</div>
      <div class="k">ETH spend</div><div class="v">${fmtEth(plan.ethSpendWei)} ETH</div>
      <div class="k">est gas (max)</div><div class="v">${fmtEth(plan.estGasCostWei)} ETH (${plan.estGasUnits} units)</div>
      <div class="k">expires</div><div class="v">${esc(plan.expiresAt)}</div>
      <div class="k">mode flag</div><div class="v">${plan.dryRun ? "DRY RUN — nothing will be sent" : "LIVE — real transactions"}</div>
    </div>
    ${plan.warnings.length ? `<div class="warnings">${plan.warnings.map(esc).join("<br>")}</div>` : ""}
  `;
  openModal(
    plan.dryRun ? "EXECUTE ROUND — DRY RUN" : "EXECUTE ROUND — LIVE",
    body,
    plan.dryRun ? "[ EXECUTE DRY ]" : "[ EXECUTE LIVE ]",
    async () => {
      feedLine(`executing round ${plan.id.slice(0, 8)}…`);
      try {
        const r = await api(`/rounds/${plan.id}/execute`, { method: "POST" });
        feedLine(`round finished — sent=${r.sent} failed=${r.failed}${plan.dryRun ? " (dry)" : ""}`);
        await Promise.all([loadRounds(), loadStatus()]);
      } catch (err) {
        feedLine(esc(err.message), "error");
      }
    },
  );
}

$("btn-round-dry").addEventListener("click", () => void planAndConfirm(true));
$("btn-round-live").addEventListener("click", () => void planAndConfirm(false));

/* one-click force airdrop from the dashboard: ETH in the wallet -> holders,
   pro-rata, budget auto-sized to balance minus gas reserve (capped by maxRoundEth).
   The plan modal still shows exact numbers before anything executes. */
function forceAirdrop(dryRun) {
  const s = state.status;
  const p = currentProject();
  if (!s || !p) return;
  try {
    const bal = BigInt(s.balances.eth);
    const reserve = BigInt(p.caps.gasReserveWei);
    const maxRound = BigInt(p.caps.maxRoundWei);
    let budget = bal > reserve ? bal - reserve : 0n;
    if (budget > maxRound) budget = maxRound;
    if (budget <= 0n) {
      feedLine("force airdrop: nothing to distribute (balance below gas reserve)", "error");
      return;
    }
    const budgetEth = (Number(budget) / 1e18).toFixed(6);
    void planAndConfirm(dryRun, { mode: "eth", distribution: "pro-rata", dryRun, budgetEth });
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

$("btn-airdrop-dry").addEventListener("click", () => forceAirdrop(true));
$("btn-airdrop-live").addEventListener("click", () => forceAirdrop(false));

/* ---------------------------------------------------------------- keys */

async function loadKeys() {
  try {
    const { keys } = await api("/keys");
    $("k-rows").innerHTML = keys
      .map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.address)}</td><td>${esc(k.id)}</td><td>${esc(k.createdAt)}</td></tr>`)
      .join("");
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

$("btn-key-import").addEventListener("click", async () => {
  const priv = $("k-priv").value;
  const name = $("k-name").value;
  $("k-priv").value = ""; // clear the field immediately, before the request
  if (!priv.trim()) return;
  try {
    const r = await api("/keys", { method: "POST", body: { name, privateKey: priv } });
    $("k-result").textContent = `imported — address ${r.address}, keyRef "vault:${r.id}"`;
    $("k-name").value = "";
    await loadKeys();
  } catch (err) {
    $("k-result").textContent = `error: ${err.message}`;
  }
});

/* ---------------------------------------------------------------- config */

async function loadConfig() {
  if (!state.current) return;
  try {
    const { effective, overridden } = await api(`/projects/${state.current}/config`);
    const mark = (k) => (overridden.includes(k) ? " · panel override" : "");
    const rows = [
      ["token CA", `${effective.tokenAddress}${mark("tokenAddress")}`],
      ["holders start block", `${effective.holdersStartBlock}${mark("holdersStartBlock")}`],
      ["treasury wallet", `${effective.treasuryWallet}${mark("treasuryWallet")}`],
      ["kumo wallet", `${effective.kumoWallet ?? "(none)"}${mark("kumoWallet")}`],
      ["treasury %", `${effective.treasuryPct}% (kumo gets ${100 - effective.treasuryPct}%)${mark("treasuryPct")}`],
      ["key ref", `${effective.keyRef}${mark("keyRef")}`],
      ["bot wallet (from key)", effective.botAddress],
      ["claim enabled", `${effective.claimEnabled}${mark("claimEnabled")}`],
      ["claim min", `${effective.claimMinEth} ETH${mark("claimMinEth")}`],
      ["claim interval", `${effective.claimIntervalMinutes} min${mark("claimIntervalMinutes")}`],
    ];
    $("c-current").innerHTML = rows
      .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
      .join("");

    // pre-fill the form with the live values so editing is in-place, not guesswork
    $("c-token").value = effective.tokenAddress ?? "";
    $("c-startblock").value = effective.holdersStartBlock ?? "";
    $("c-treasury").value = effective.treasuryWallet ?? "";
    $("c-kumo").value = effective.kumoWallet ?? "";
    $("c-pct").value = String(effective.treasuryPct ?? "");
    // keyRef: only prefill a real ref — the "(from projects.json / env)" label isn't one
    $("c-keyref").value = /^(env:|vault:)/.test(effective.keyRef ?? "") ? effective.keyRef : "";
    $("c-claimenabled").value = String(effective.claimEnabled);
    $("c-claimmin").value = effective.claimMinEth ?? "";
    $("c-claiminterval").value = String(effective.claimIntervalMinutes ?? "");
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

function configPatch() {
  const patch = {};
  if ($("c-token").value.trim()) patch.tokenAddress = $("c-token").value.trim();
  if ($("c-startblock").value.trim()) patch.holdersStartBlock = $("c-startblock").value.trim();
  if ($("c-treasury").value.trim()) patch.treasuryWallet = $("c-treasury").value.trim();
  if ($("c-kumo").value.trim()) patch.kumoWallet = $("c-kumo").value.trim();
  if ($("c-pct").value.trim()) patch.treasuryPct = Number($("c-pct").value.trim());
  if ($("c-keyref").value.trim()) patch.keyRef = $("c-keyref").value.trim();
  if ($("c-claimenabled").value) patch.claimEnabled = $("c-claimenabled").value === "true";
  if ($("c-claimmin").value.trim()) patch.claimMinEth = $("c-claimmin").value.trim();
  if ($("c-claiminterval").value.trim()) patch.claimIntervalMinutes = Number($("c-claiminterval").value.trim());
  return patch;
}

$("btn-config-save").addEventListener("click", () => {
  const patch = configPatch();
  if (Object.keys(patch).length === 0) {
    $("c-result").textContent = "nothing to change — all fields blank";
    return;
  }
  const rows = Object.entries(patch)
    .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(String(v))}</div>`)
    .join("");
  openModal(
    "APPLY CONFIG CHANGES",
    `<div class="kv">${rows}</div>
     <p style="margin-top:8px">Applies immediately (next claim cycle uses the new values) and persists on the volume. Token change = fresh holder index.</p>`,
    "[ APPLY ]",
    async () => {
      try {
        const r = await api(`/projects/${state.current}/config`, { method: "POST", body: patch });
        $("c-result").textContent = `applied: ${Object.keys(r.applied).join(", ")}${r.claimDisabledReason ? ` — NOTE: ${r.claimDisabledReason}` : ""}`;
        for (const id of ["c-token", "c-startblock", "c-treasury", "c-kumo", "c-pct", "c-keyref", "c-claimmin", "c-claiminterval"]) $(id).value = "";
        $("c-claimenabled").value = "";
        feedLine(`config applied: ${Object.keys(r.applied).join(", ")}`);
        // refresh everything that displays config-derived values
        const { projects } = await api("/projects");
        state.projects = projects;
        await Promise.all([loadConfig(), loadStatus(), loadHolders()]);
      } catch (err) {
        $("c-result").textContent = `error: ${err.message}`;
        feedLine(esc(err.message), "error");
      }
    },
  );
});

/* ---------------------------------------------------------------- autodrop */

async function loadAutodrop() {
  try {
    const { jobs } = await api("/autodrop");
    $("ad-rows").innerHTML = jobs
      .map((j) => {
        const next = j.nextRunAt ? Math.max(0, Math.round((j.nextRunAt - Date.now()) / 60000)) : null;
        const status = j.busy ? "running…" : j.enabled ? `on${next !== null ? ` · next ~${next}m` : ""}` : "off";
        return `<tr>
          <td>${esc(j.id)}</td>
          <td>${esc(short(j.wallet))}</td>
          <td>${esc(short(j.airdropToken))}</td>
          <td>${esc(short(j.holdToken))}</td>
          <td>${esc(j.minHolding)}</td>
          <td>${j.intervalMinutes}m</td>
          <td>${esc(status)}</td>
          <td class="dim">${esc(j.lastResult)}</td>
          <td>
            <button class="action" data-ad="dry" data-id="${esc(j.id)}">[ DRY ]</button>
            <button class="action danger" data-ad="live" data-id="${esc(j.id)}">[ LIVE ]</button>
            <button class="action" data-ad="toggle" data-id="${esc(j.id)}" data-enabled="${j.enabled}">[ ${j.enabled ? "OFF" : "ON"} ]</button>
            <button class="action danger" data-ad="delete" data-id="${esc(j.id)}">[ X ]</button>
          </td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
}

$("ad-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-ad]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.ad;
  try {
    if (action === "dry" || action === "live") {
      const dryRun = action === "dry";
      const go = async () => {
        feedLine(`autodrop ${id}: running (${dryRun ? "dry" : "LIVE"})…`);
        const r = await api(`/autodrop/${id}/run`, { method: "POST", body: { dryRun } });
        feedLine(`autodrop ${id}: ${r.phase} — ${r.detail}`, r.phase === "error" ? "error" : "");
        if (r.top?.length) {
          for (const t of r.top) feedLine(`  plan: ${short(t.address)} gets ${t.amount} ${r.airdropSymbol ?? ""}`);
        }
        await loadAutodrop();
      };
      if (dryRun) await go();
      else {
        openModal(
          "AUTODROP — LIVE RUN",
          `<p>Swaps the wallet's ETH on Uniswap and sends the tokens to holders. Real transactions${state.dryRunMaster ? " (master DRY RUN is ON — this will still be dry)" : ""}.</p>`,
          "[ RUN LIVE ]",
          go,
        );
      }
    } else if (action === "toggle") {
      await api(`/autodrop/${id}/toggle`, { method: "POST", body: { enabled: btn.dataset.enabled !== "true" } });
      await loadAutodrop();
    } else if (action === "delete") {
      openModal(
        "REMOVE AUTODROP JOB",
        `<p>Removes job "${esc(id)}" and stops its loop. Nothing on-chain changes.</p>`,
        "[ REMOVE ]",
        async () => {
          await api(`/autodrop/${id}`, { method: "DELETE" });
          feedLine(`autodrop job removed: ${id}`);
          await loadAutodrop();
        },
      );
    }
  } catch (err) {
    feedLine(esc(err.message), "error");
  }
});

$("btn-autodrop-add").addEventListener("click", async () => {
  const body = {
    id: $("ad-id").value.trim(),
    keyRef: $("ad-keyref").value.trim(),
    airdropToken: $("ad-drop").value.trim(),
    holdToken: $("ad-hold").value.trim(),
    minHolding: $("ad-min").value.trim(),
    holdersStartBlock: $("ad-startblock").value.trim(),
    intervalMinutes: Number($("ad-interval").value.trim() || "10"),
    minEthPerRound: $("ad-mineth").value.trim(),
    feeTier: Number($("ad-feetier").value),
    maxRecipients: Number($("ad-maxrec").value.trim() || "300"),
  };
  try {
    const r = await api("/autodrop", { method: "POST", body });
    $("ad-result").textContent = `created "${r.id}" — wallet ${r.wallet}. fund it with ETH and it does the rest.`;
    for (const id of ["ad-id", "ad-keyref", "ad-drop", "ad-hold", "ad-min", "ad-startblock", "ad-interval", "ad-mineth", "ad-maxrec"]) $(id).value = "";
    feedLine(`autodrop job created: ${r.id}`);
    await loadAutodrop();
  } catch (err) {
    $("ad-result").textContent = `error: ${err.message}`;
  }
});

/* ---------------------------------------------------------------- add / remove projects */

async function refreshProjects(selectId = null) {
  const { projects } = await api("/projects");
  state.projects = projects;
  $("project-select").innerHTML = projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.id)})</option>`)
    .join("");
  if (selectId && projects.some((p) => p.id === selectId)) state.current = selectId;
  else if (!projects.some((p) => p.id === state.current)) state.current = projects[0]?.id ?? null;
  $("project-select").value = state.current ?? "";
}

$("btn-project-add").addEventListener("click", async () => {
  const body = {
    id: $("np-id").value.trim(),
    name: $("np-name").value.trim(),
    tokenAddress: $("np-token").value.trim(),
    holdersStartBlock: $("np-startblock").value.trim(),
    treasuryWallet: $("np-treasury").value.trim(),
    kumoWallet: $("np-kumo").value.trim(),
    treasuryPct: $("np-pct").value.trim(),
    keyRef: $("np-keyref").value.trim(),
  };
  try {
    const r = await api("/projects", { method: "POST", body });
    $("np-result").textContent = `created "${r.id}" — claim wallet ${r.botAddress}${r.claimDisabledReason ? ` — NOTE: ${r.claimDisabledReason}` : ""}`;
    for (const id of ["np-id", "np-name", "np-token", "np-startblock", "np-treasury", "np-kumo", "np-pct", "np-keyref"]) $(id).value = "";
    feedLine(`project created: ${r.id}`);
    await refreshProjects(r.id);
    await Promise.all([loadStatus(), loadConfig(), loadRounds(), loadHolders()]);
  } catch (err) {
    $("np-result").textContent = `error: ${err.message}`;
  }
});

$("btn-project-remove").addEventListener("click", () => {
  const p = currentProject();
  if (!p) return;
  if (!p.extra) {
    $("np-remove-result").textContent = `"${p.id}" comes from projects.json — it can't be removed from the panel`;
    return;
  }
  openModal(
    "REMOVE PROJECT",
    `<div class="kv"><div class="k">project</div><div class="v">${esc(p.name)} (${esc(p.id)})</div>
      <div class="k">token</div><div class="v">${esc(p.tokenAddress)}</div></div>
     <p style="margin-top:8px">Stops its claim loop and removes it from the panel. Nothing on-chain changes.</p>`,
    "[ REMOVE ]",
    async () => {
      try {
        await api(`/projects/${p.id}`, { method: "DELETE" });
        $("np-remove-result").textContent = `removed "${p.id}"`;
        feedLine(`project removed: ${p.id}`);
        await refreshProjects();
        await Promise.all([loadStatus(), loadConfig(), loadRounds(), loadHolders()]);
      } catch (err) {
        $("np-remove-result").textContent = `error: ${err.message}`;
      }
    },
  );
});

/* ---------------------------------------------------------------- boot */

$("project-select").addEventListener("change", async () => {
  state.current = $("project-select").value;
  await Promise.all([loadStatus(), loadRounds(), loadHolders()]);
});

function connectWs() {
  if (state.sock) state.sock.close();
  state.sock = createOpsSocket("/ws", {
    onStatus: (s) => {
      const el = $("ws-status");
      el.textContent = `ws: ${s}`;
      el.className = s === "online" ? "online" : s.startsWith("re") || s === "offline" ? "offline" : "";
    },
  });
  state.sock.on("*", (evt) => {
    if (evt.projectId && state.current && evt.projectId !== state.current) return;
    feedLine(esc(describeEvent(evt)), evt.type === "journal" && evt.data?.type === "error" ? "error" : evt.type);
  });
  state.sock.on("round_end", () => void loadRounds());
  state.sock.on("cycle", (evt) => {
    if (evt.data?.phase === "end") void loadStatus();
  });
  state.sock.connect();
}

async function init() {
  const me = await api("/me");
  state.dryRunMaster = me.dryRunMaster;
  $("master-dry").classList.toggle("hidden", !me.dryRunMaster);

  const { projects, dryRunMaster } = await api("/projects");
  state.projects = projects;
  state.dryRunMaster = dryRunMaster;
  $("project-select").innerHTML = projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.id)})</option>`)
    .join("");
  state.current = projects[0]?.id ?? null;

  showApp();
  connectWs();
  await Promise.all([loadStatus(), loadRounds(), loadHolders()]);
}

(async () => {
  try {
    await init();
  } catch {
    showLogin();
  }
})();
