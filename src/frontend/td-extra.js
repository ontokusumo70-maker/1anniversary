/* ==========================================================================
   TERAS LAUNDRY — Tambahan Dashboard Customer
   - Card status request Antar/Jemput yang sudah dikonfirmasi (#txReqStatus)
     + halaman status request (dibuka dari angka Antar / Jemput)
   - Card "Laundry Anda": nomor Washer/Dryer yang sedang dipakai (#txMyMachine)
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

  /* ---------------- state ---------------- */
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

  /* ============================================================ *
   * 1. STATUS REQUEST ANTAR / JEMPUT
   * ============================================================ */
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

  /* ============================================================ *
   * 2. LAUNDRY ANDA (nomor mesin)
   * ============================================================ */
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

  /* ============================================================ *
   * Realtime & siklus
   * ============================================================ */
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
    // pertahankan penanda pembungkus lain agar tidak dibungkus dua kali
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

  function start() {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; checkDash(); }, 150);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

    setInterval(() => { if (isCustomerDash()) refreshAll(); }, 20000);
    setInterval(() => { if (isCustomerDash()) paintMachine(); }, 30000);
    checkDash();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
