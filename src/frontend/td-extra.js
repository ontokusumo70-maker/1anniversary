/* ==========================================================================
   TERAS LAUNDRY — Tambahan
   CUSTOMER : card status request Antar/Jemput + "Laundry Anda" (nomor mesin)
   OWNER    : Reward Member di menu Program + info pemakaian di Reward Pool
   Dimuat SETELAH delivery.js dan td-pages.js.
   ========================================================================== */
(() => {
  "use strict";

  if (window.__terasExtra) return;
  window.__terasExtra = true;

  const $ = (id) => document.getElementById(id);
  const ui = () => window.TdUi || null;
  const role = () => (typeof state !== "undefined" && state && state.role) || "";
  const call = (path, options) => api(path, options);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
  const fmtNum = (n) => Number(n || 0).toLocaleString("id-ID");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const pad = (n) => String(n).padStart(2, "0");
  const TYPE = { DELIVERY: "Antar", PICKUP: "Jemput" };

  const SVG = {
    truck: '<path d="M1 5h13v11H1zM14 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a6 6 0 0 1 8 0M12 14l2-3"/>',
    note: '<path d="M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3-6 7-6s6.2 2 7 6"/>',
    wash: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13.5" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01"/><path d="M9.8 13.5c.8-.8 1.6-.8 2.4 0s1.6.8 2.4 0"/>',
    dry: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13.5" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01"/><path d="M12 11.3v4.4M10 12.4l4 2.2M14 12.4l-4 2.2"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M12 9v11M3 9h18M6 9a2.5 2.5 0 1 1 2.5-2.5C8.5 8 12 9 12 9s3.5-1 3.5-2.5A2.5 2.5 0 1 1 18 9"/>',
  };
  const ico = (name, cls = "tx-ico") =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SVG[name] || ""}</svg>`;

  /* ---------------- format ---------------- */
  function fmtDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return esc(ymd || "–");
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return `${DAYS[d.getUTCDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }
  const fmtTime = (hm) => String(hm || "–").replace(":", ".");
  function wibParts(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t + 7 * 3600 * 1000);
  }
  function fmtWib(iso) {
    const d = wibParts(iso);
    if (!d) return "";
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())} WIB`;
  }
  function fmtClock(iso) {
    const d = wibParts(iso);
    return d ? `${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())} WIB` : "";
  }
  const unitLabel = (unit) => (ui()?.unitLabel ? ui().unitLabel(unit) : (unit === "BAG" ? "laundry bag" : "keranjang"));

  /* ================================================================== *
   * CUSTOMER
   * ================================================================== */
  let confirmedRequests = [];
  let activeMachines = [];
  let currentType = "";
  let dashVisible = false;

  function isCustomerDash() {
    const d = $("tdDash");
    return role() === "CUSTOMER" && Boolean(d) && !d.hidden;
  }
  const isPageOpen = (key) => Boolean(ui()?.isOpen?.(key));

  function ensureSlots() {
    const queue = $("tdQueue");
    const req = $("tdReq");
    if (queue && !$("txMyMachine")) {
      const s = document.createElement("section");
      s.id = "txMyMachine";
      s.className = "td-card td-pad tx-machine";
      s.hidden = true;
      queue.insertAdjacentElement("afterend", s);
    }
    if (req && !$("txReqStatus")) {
      const s = document.createElement("div");
      s.id = "txReqStatus";
      s.className = "td-card tx-req-status";
      s.hidden = true;
      req.insertAdjacentElement("afterend", s);
    }
  }

  async function refreshRequests() {
    if (role() !== "CUSTOMER") return;
    try {
      const data = await call("/delivery/requests/mine");
      confirmedRequests = (data.requests || [])
        .filter((r) => r.status === "CONFIRMED")
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
      paintReqStatus();
      if (isPageOpen("req-status")) renderStatusPage();
    } catch { /* card bersifat pelengkap */ }
  }

  function paintReqStatus() {
    const el = $("txReqStatus");
    if (!el) return;
    const antar = confirmedRequests.filter((r) => r.type === "DELIVERY").length;
    const jemput = confirmedRequests.filter((r) => r.type === "PICKUP").length;
    const show = antar + jemput > 0;
    if (el.hidden !== !show) el.hidden = !show;
    if (!show) {
      el.innerHTML = "";
      el.dataset.sig = "";
      return;
    }
    const sig = `${antar}|${jemput}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;

    const pill = (type, n) => n
      ? `<button type="button" class="tx-rs-pill" data-tx-type="${type}">
           <span class="tx-rs-ic">${ico("truck")}</span>
           <span class="tx-rs-lb">${TYPE[type]}</span>
           <em>${n}</em>
         </button>`
      : "";

    el.innerHTML = `
      <div class="tx-rs-head">
        <span class="tx-rs-dot">${ico("check")}</span>
        <span class="tx-rs-tx"><b>Request dikonfirmasi</b><small>Ketuk untuk melihat status</small></span>
      </div>
      <div class="tx-rs-row">${pill("DELIVERY", antar)}${pill("PICKUP", jemput)}</div>`;
    el.querySelectorAll("[data-tx-type]").forEach((btn) => {
      btn.addEventListener("click", () => openStatus(btn.getAttribute("data-tx-type")));
    });
  }

  function openStatus(type) {
    const U = ui();
    if (!U?.openPage) return;
    currentType = type;
    U.openPage({ key: "req-status", title: `Request ${TYPE[type] || "Antar / Jemput"}` });
    renderStatusPage();
    refreshRequests();
  }

  function infoRow(icon, html, cls = "") {
    return `<div class="tx-st-row ${cls}">${ico(icon)}<span>${html}</span></div>`;
  }

  function statusCard(r) {
    const isPickup = r.type === "PICKUP";
    const label = TYPE[r.type] || "Antar / Jemput";
    const otw = isPickup
      ? "Petugas kami sedang menuju lokasi Anda untuk menjemput laundry."
      : "Petugas kami sedang menuju lokasi Anda untuk mengantar laundry.";
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address || "")}`;
    return `
      <article class="td-c tx-st">
        <div class="tx-st-banner">
          <span class="tx-st-bic">${ico("check")}</span>
          <div><b>Request ${esc(label)} sudah dikonfirmasi</b>${r.confirmedAt ? `<small>Dikonfirmasi ${esc(fmtWib(r.confirmedAt))}</small>` : ""}</div>
        </div>
        <div class="tx-st-otw">${ico("truck")}<span>${otw}</span></div>
        <div class="tx-dt">
          <div class="tx-dt-card">${ico("cal")}<small>Tanggal</small><b>${esc(fmtDate(r.date))}</b></div>
          <div class="tx-dt-card">${ico("clock")}<small>Jam</small><b>${esc(fmtTime(r.time))} WIB</b></div>
        </div>
        <div class="tx-st-rows">
          ${infoRow("truck", `Layanan: <b>${esc(label)}</b>`)}
          ${infoRow("user", esc(r.name || "–"))}
          ${infoRow("phone", esc(r.phone || "–"))}
          ${infoRow("pin", `<a href="${maps}" target="_blank" rel="noopener noreferrer">${esc(r.address || "–")}</a>`)}
          ${infoRow("scale", `±${esc(r.estWeightKg)} kg · ${esc(r.itemCount)} ${esc(unitLabel(r.itemUnit))}`)}
          ${r.notes ? infoRow("note", `Catatan: ${esc(r.notes)}`, "mu") : ""}
        </div>
        <p class="tx-st-foot">Pastikan nomor telepon Anda aktif agar petugas mudah menghubungi Anda.</p>
      </article>`;
  }

  function renderStatusPage() {
    const U = ui();
    if (!U || !isPageOpen("req-status")) return;
    const body = U.body();
    if (!body) return;
    const list = confirmedRequests.filter((r) => r.type === currentType);
    body.innerHTML = list.length
      ? `<div class="td-list">${list.map(statusCard).join("")}</div>`
      : `<div class="td-c td-empty">Tidak ada request ${esc((TYPE[currentType] || "").toLowerCase())} yang sedang diproses.</div>`;
  }

  async function refreshMachines() {
    if (role() !== "CUSTOMER") return;
    try {
      const data = await call("/queue/self-service/mine");
      activeMachines = Array.isArray(data.activeMachines) ? data.activeMachines : [];
      paintMachine();
    } catch { /* abaikan */ }
  }

  function remainText(endIso, now) {
    const end = Date.parse(endIso);
    if (!Number.isFinite(end)) return "Sedang berjalan";
    const mins = Math.max(1, Math.ceil((end - now) / 60000));
    return `Selesai ± ${mins} menit lagi · ${fmtClock(endIso)}`;
  }

  function paintMachine() {
    const el = $("txMyMachine");
    if (!el) return;
    const now = Date.now();
    const list = activeMachines.filter((m) => !m.expectedEndAt || Date.parse(m.expectedEndAt) > now);
    if (!list.length) {
      if (!el.hidden) el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="td-ct"><h2>Laundry Anda</h2></div>
      <div class="tx-mm">
        ${list.map((m) => {
          const isDryer = m.machineType === "DRYER";
          return `
          <div class="tx-mm-item">
            <span class="tx-mm-ic">${ico(isDryer ? "dry" : "wash")}</span>
            <div class="tx-mm-tx">
              <small>${isDryer ? "Dryer" : "Washer"}${m.displayCode ? ` · Antrean ${esc(m.displayCode)}` : ""}</small>
              <b>Mesin ${esc(m.machineId || "-")}</b>
              <em>${esc(remainText(m.expectedEndAt, now))}</em>
            </div>
          </div>`;
        }).join("")}
      </div>
      <p class="tx-note">Laundry Anda sedang diproses di mesin di atas.</p>`;
  }

  function installRealtime() {
    const orig = window.handleRealtimeMessage;
    if (typeof orig !== "function" || orig.__txExtra) return;
    const wrapped = function (...args) {
      try {
        const t = args[0] && args[0].type;
        if (role() === "CUSTOMER") {
          if (t === "DELIVERY_REQUEST_UPDATED") setTimeout(refreshRequests, 300);
          if (t === "SELF_SERVICE_TICKET_ACTIVATED" || t === "SELF_SERVICE_QUEUE_UPDATED" || t === "MACHINE_UPDATED") {
            setTimeout(refreshMachines, 300);
          }
        }
      } catch { /* abaikan */ }
      return orig.apply(this, args);
    };
    wrapped.__txExtra = true;
    if (orig.__tdWrapped) wrapped.__tdWrapped = true;
    if (orig.__tdPages) wrapped.__tdPages = true;
    window.handleRealtimeMessage = wrapped;
  }

  function refreshAll() {
    if (!isCustomerDash()) return;
    ensureSlots();
    installRealtime();
    refreshRequests();
    refreshMachines();
  }

  function checkDash() {
    const visible = isCustomerDash();
    if (visible) ensureSlots();
    if (visible && !dashVisible) refreshAll();
    dashVisible = visible;
  }

  /* ================================================================== *
   * OWNER — Reward Member (menu Program) + info di Reward Pool
   * ================================================================== */
  const prog = { pools: [], rows: [], saved: {}, loaded: false, busy: false };
  let progCache = null;
  let progCacheAt = 0;
  let progWasVisible = false;

  async function fetchProgramRewards(force = false) {
    if (!force && progCache && Date.now() - progCacheAt < 3000) return progCache;
    const data = await call("/owner/program-rewards");
    progCache = data;
    progCacheAt = Date.now();
    return data;
  }

  const poolById = (id) => prog.pools.find((p) => p.rewardPoolId === id);
  // Stok yang boleh dipakai baris ini = stok bebas pool + jumlah yang sudah tersimpan untuk reward ini.
  const availOf = (pool) => (pool ? Number(pool.freeStock || 0) + Number(prog.saved[pool.rewardPoolId] || 0) : 0);
  const syncSaved = (items) => {
    prog.saved = {};
    (items || []).forEach((i) => { prog.saved[i.rewardPoolId] = Number(i.quantity) || 0; });
  };

  function ensureProgSlot() {
    const field = $("td_pbag");
    if (!field) return null;
    let slot = $("txProgRewards");
    if (slot) return slot;
    const fs = field.closest(".td-fs");
    if (!fs) return null;
    slot = document.createElement("div");
    slot.id = "txProgRewards";
    slot.className = "tx-prog";
    fs.appendChild(slot);
    return slot;
  }

  function progMsg(text, isError = false) {
    const el = $("txProgMsg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("err", Boolean(text) && isError);
  }

  function renderProgram() {
    const slot = ensureProgSlot();
    if (!slot) return;
    const chosen = new Set(prog.rows.map((r) => r.rewardPoolId).filter(Boolean));

    const rowsHtml = prog.rows.map((row, i) => {
      const options = prog.pools
        .filter((p) => p.active || p.rewardPoolId === row.rewardPoolId)
        .map((p) => {
          const taken = chosen.has(p.rewardPoolId) && p.rewardPoolId !== row.rewardPoolId;
          const label = `${p.rewardType} · stok ${fmtNum(availOf(p))}${p.active ? "" : " (nonaktif)"}`;
          return `<option value="${esc(p.rewardPoolId)}"${p.rewardPoolId === row.rewardPoolId ? " selected" : ""}${taken ? " disabled" : ""}>${esc(label)}</option>`;
        }).join("");
      const pool = poolById(row.rewardPoolId);
      const max = pool ? Math.max(1, availOf(pool)) : "";
      return `
        <div class="tx-prog-row" data-i="${i}">
          <select class="td-in tx-prog-sel" data-i="${i}" aria-label="Pilih reward dari Reward Pool">
            <option value=""${row.rewardPoolId ? "" : " selected"}>Pilih reward dari Reward Pool</option>${options}
          </select>
          <input class="td-in tx-prog-qty" data-i="${i}" type="number" min="1" ${max ? `max="${max}"` : ""} step="1" inputmode="numeric" value="${esc(row.quantity)}" aria-label="Jumlah reward">
          <button type="button" class="tx-prog-del" data-i="${i}" aria-label="Hapus reward program">${ico("trash")}</button>
        </div>`;
    }).join("");

    slot.innerHTML = `
      <h3 class="tx-prog-title">Reward Member</h3>
      <div class="tx-prog-rows">${prog.loaded
        ? (rowsHtml || '<p class="tx-prog-empty">Belum ada reward program.</p>')
        : '<p class="tx-prog-empty">Memuat…</p>'}</div>
      <button type="button" class="tx-prog-add" id="txProgAdd"${prog.loaded ? "" : " disabled"}>+ Tambah Reward Program</button>
      <p class="tx-prog-msg" id="txProgMsg" aria-live="polite"></p>
      <p class="tx-prog-hint">Reward diambil dari menu Reward Pool dan mengurangi stok “Sisa” di sana. Tekan “Simpan pengaturan” untuk menyimpan.</p>`;

    slot.querySelectorAll(".tx-prog-sel").forEach((sel) => sel.addEventListener("change", () => {
      const i = Number(sel.dataset.i);
      const row = prog.rows[i];
      if (!row) return;
      row.rewardPoolId = sel.value;
      const pool = poolById(row.rewardPoolId);
      if (pool) row.quantity = Math.max(1, Math.min(Number(row.quantity) || 1, availOf(pool) || 1));
      renderProgram();
    }));
    slot.querySelectorAll(".tx-prog-qty").forEach((input) => input.addEventListener("input", () => {
      const row = prog.rows[Number(input.dataset.i)];
      if (row) row.quantity = Number(input.value);
    }));
    slot.querySelectorAll(".tx-prog-del").forEach((btn) => btn.addEventListener("click", () => {
      prog.rows.splice(Number(btn.dataset.i), 1);
      renderProgram();
    }));
    $("txProgAdd")?.addEventListener("click", () => {
      const usable = prog.pools.filter((p) => p.active && !chosen.has(p.rewardPoolId));
      if (!usable.length) { progMsg("Semua reward di Reward Pool sudah dipilih.", true); return; }
      prog.rows.push({ rewardPoolId: "", quantity: 1 });
      renderProgram();
    });
  }

  async function loadProgram() {
    if (role() !== "OWNER") return;
    prog.loaded = false;
    renderProgram();
    try {
      const data = await fetchProgramRewards(true);
      prog.pools = data.pools || [];
      syncSaved(data.items);
      prog.rows = (data.items || []).map((i) => ({ rewardPoolId: i.rewardPoolId, quantity: i.quantity }));
      prog.loaded = true;
    } catch (error) {
      prog.loaded = false;
      renderProgram();
      progMsg(error.message || "Gagal memuat reward program.", true);
      return;
    }
    renderProgram();
  }

  async function saveProgramRewards() {
    if (!prog.loaded || prog.busy) return;
    if (prog.rows.some((r) => !r.rewardPoolId)) {
      progMsg("Ada baris reward program yang belum memilih reward.", true);
      return;
    }
    const items = prog.rows.map((r) => ({ rewardPoolId: r.rewardPoolId, quantity: Number(r.quantity) }));
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) {
      progMsg("Jumlah reward harus angka bulat minimal 1.", true);
      return;
    }
    prog.busy = true;
    try {
      const data = await call("/owner/program-rewards", { method: "PUT", body: JSON.stringify({ items }) });
      progCache = data;
      progCacheAt = Date.now();
      prog.pools = data.pools || prog.pools;
      syncSaved(data.items);
      prog.rows = (data.items || []).map((i) => ({ rewardPoolId: i.rewardPoolId, quantity: i.quantity }));
      renderProgram();
      progMsg("Reward program tersimpan.");
    } catch (error) {
      progMsg(error.message || "Gagal menyimpan reward program.", true);
    }
    prog.busy = false;
  }

  function bindProgramSave() {
    const btn = $("tdPSave");
    if (!btn || btn.dataset.txBound === "1") return;
    btn.dataset.txBound = "1";
    btn.addEventListener("click", saveProgramRewards);
  }

  /* ----- Reward Pool: info "Digunakan di Program Member" ----- */
  const usedLine = (qty) =>
    `Digunakan di Program Member: <b>${fmtNum(qty)}</b>`;

  async function decorateRewardPool() {
    const list = $("ownerRewardList");
    if (!list) return;
    const pending = [...list.querySelectorAll("[data-open-reward]")].filter((b) => b.dataset.txProg !== "1");
    if (!pending.length) return;

    let data;
    try { data = await fetchProgramRewards(); } catch { return; }
    const map = new Map((data.items || []).map((i) => [i.rewardPoolId, i.quantity]));

    list.querySelectorAll("[data-open-reward]").forEach((btn) => {
      if (btn.dataset.txProg === "1") return;
      btn.dataset.txProg = "1";
      btn.querySelector(".tx-prog-used")?.remove();
      const qty = map.get(btn.dataset.openReward);
      if (!qty) return;
      const host = btn.querySelector(".locked-card-main");
      if (!host) return;
      const tag = document.createElement("span");
      tag.className = "tx-prog-used";
      tag.innerHTML = `${ico("gift")}<span>${usedLine(qty)}</span>`;
      host.appendChild(tag);
    });
  }

  async function decorateRewardDetail() {
    const view = $("rewardDetailView");
    const layout = $("rewardDetailCard")?.querySelector(".reward-detail-layout");
    if (!view || view.hidden || !layout || layout.dataset.txProg === "1") return;
    const id = typeof selectedRewardPoolId !== "undefined" ? selectedRewardPoolId : null;
    if (!id) return;

    let data;
    try { data = await fetchProgramRewards(); } catch { return; }
    if (layout.dataset.txProg === "1" || !layout.isConnected) return;
    layout.dataset.txProg = "1";
    const found = (data.items || []).find((i) => i.rewardPoolId === id);
    if (!found) return;

    const section = document.createElement("section");
    section.className = "reward-detail-wide-card tx-prog-detail";
    section.innerHTML = `
      <div class="reward-detail-icon">${ico("gift", "")}</div>
      <div>
        <span>Digunakan di Program Member</span>
        <strong>${fmtNum(found.quantity)} reward</strong>
        <small>Reward ini dipilih Owner sebagai Reward Member</small>
      </div>`;
    layout.insertBefore(section, layout.querySelector(".reward-detail-terms-card"));
  }

  let ownerScanTimer = null;
  function scanOwner() {
    if (role() !== "OWNER") return;

    const view = $("tdOwnerProgram");
    const visible = Boolean(view) && !view.hidden;
    if (visible) bindProgramSave();
    if (visible && !progWasVisible) loadProgram();
    progWasVisible = visible;

    decorateRewardPool();
    decorateRewardDetail();
  }
  function scheduleOwnerScan() {
    clearTimeout(ownerScanTimer);
    ownerScanTimer = setTimeout(scanOwner, 120);
  }

  /* ================================================================== *
   * Siklus
   * ================================================================== */
  function start() {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; checkDash(); }, 150);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

    const ownerEl = $("owner");
    if (ownerEl) {
      new MutationObserver(scheduleOwnerScan).observe(ownerEl, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"],
      });
    }

    setInterval(() => { if (isCustomerDash()) refreshAll(); }, 20000);
    setInterval(() => { if (isCustomerDash()) paintMachine(); }, 30000);
    checkDash();
    scheduleOwnerScan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
