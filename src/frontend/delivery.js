/* ==========================================================================
   TERAS LAUNDRY — Standar UI v1.0
   Dashboard Staff & Customer, Request Antar/Jemput, Event (view only).

   Dimuat SETELAH app.js (<script src="/delivery.js" defer>). Memakai
   fungsi/variabel global app.js: api(), state, openStaffEvent(),
   openCustomerEvent(), refreshStaff*(), refreshCustomer*(), qdmWhatsappHref().
   Tidak mengubah logika app.js: hanya membungkus beberapa fungsi global
   (showStaffDashboard, showCustomerDashboard, handleRealtimeMessage, ...).
   ========================================================================== */
(() => {
  "use strict";

  if (window.__terasUiSpec) return;
  window.__terasUiSpec = true;

  const $ = (id) => document.getElementById(id);
  const role = () => (typeof state !== "undefined" && state && state.role) || "";
  const call = (path, options) => api(path, options);

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));

  /* ------------------------------------------------------------ *
   * Ikon (outline, stroke 1.75, mengikuti spesifikasi)
   * ------------------------------------------------------------ */
  const ICONS = {
    chev: '<path d="M9 5l7 7-7 7"/>',
    truck: '<path d="M1 5h13v11H1zM14 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.2.7 3.5 2.7 3.5 5.7"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a6 6 0 0 1 8 0M12 14l2-3"/>',
    note: '<path d="M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    wash: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13.5" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01"/><path d="M9.8 13.5c.8-.8 1.6-.8 2.4 0s1.6.8 2.4 0"/>',
    dry: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13.5" r="4.5"/><path d="M7.5 6h.01M10.5 6h.01"/><path d="M12 11.3v4.4M10 12.4l4 2.2M14 12.4l-4 2.2"/>',
  };
  const ico = (name, cls = "td-ico") =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  /* ------------------------------------------------------------ *
   * Format tanggal/jam (WIB)
   * ------------------------------------------------------------ */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const pad = (n) => String(n).padStart(2, "0");

  function fmtDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ymd || "");
  }
  const fmtTime = (hm) => String(hm || "").replace(":", ".");
  function fmtWib(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t + 7 * 3600 * 1000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}`;
  }
  function fmtRange(startIso, endIso) {
    const f = (iso) => {
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return "";
      const d = new Date(t + 7 * 3600 * 1000);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
    return `${f(startIso)} – ${f(endIso)}`;
  }
  const unitLabel = (unit) => (unit === "BAG" ? "bungkus" : "keranjang");
  const addDays = (ymd, days) => {
    const t = Date.parse(`${ymd}T00:00:00Z`) + days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  };

  let toastTimer = null;
  function toast(text) {
    let el = $("tdToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tdToast";
      el.className = "td-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /* ------------------------------------------------------------ *
   * Halaman dalam (overlay): bar atas tetap, konten dapat digulir
   * ------------------------------------------------------------ */
  let pageEl = null;
  let bodyEl = null;
  let stickyEl = null;
  let titleEl = null;
  let pageOpen = false;
  let pageKey = "";
  let pageOnBack = null;

  function ensurePage() {
    if (pageEl) return;
    pageEl = document.createElement("div");
    pageEl.id = "tdPage";
    pageEl.className = "td-page";
    pageEl.hidden = true;
    pageEl.setAttribute("role", "dialog");
    pageEl.setAttribute("aria-modal", "true");
    pageEl.setAttribute("aria-labelledby", "tdPageTitle");
    pageEl.innerHTML = `
      <header class="td-bar">
        <button type="button" class="td-back" id="tdBack" aria-label="Kembali">${ico("chev")}</button>
        <h1 class="td-title" id="tdPageTitle"></h1>
      </header>
      <div class="td-scroll" id="tdScroll"><div class="td-inner" id="tdBody"></div></div>
      <div class="td-sticky" id="tdSticky" hidden></div>`;
    document.body.appendChild(pageEl);
    bodyEl = $("tdBody");
    stickyEl = $("tdSticky");
    titleEl = $("tdPageTitle");
    $("tdBack").addEventListener("click", () => {
      if (pageOnBack) pageOnBack();
      else closePage();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && pageOpen) closePage();
    });
  }

  function openPage({ key, title, sticky = false, onBack = null }) {
    ensurePage();
    if (!pageOpen) {
      try { history.pushState({ tdPage: key }, "", location.href); } catch { /* abaikan */ }
    }
    pageOpen = true;
    pageKey = key;
    pageOnBack = typeof onBack === "function" ? onBack : null;
    pageEl.className = `td-page ${role() === "CUSTOMER" ? "td-customer" : "td-staff"}${sticky ? " has-sticky" : ""}`;
    titleEl.textContent = title;
    bodyEl.innerHTML = "";
    stickyEl.innerHTML = "";
    stickyEl.hidden = !sticky;
    pageEl.hidden = false;
    document.documentElement.classList.add("td-lock");
    $("tdScroll").scrollTop = 0;
    return bodyEl;
  }

  function closePage(fromPop = false) {
    if (!pageOpen) return;
    pageOpen = false;
    pageKey = "";
    pageOnBack = null;
    bodyEl.innerHTML = "";
    stickyEl.innerHTML = "";
    pageEl.hidden = true;
    document.documentElement.classList.remove("td-lock");
    if (!fromPop && history.state && history.state.tdPage) {
      try { history.back(); } catch { /* abaikan */ }
    }
    refreshDashboard();
  }

  window.addEventListener("popstate", () => { if (pageOpen) closePage(true); });

  const isOpen = (key) => pageOpen && pageKey === key;

  /* ------------------------------------------------------------ *
   * Halaman Antrean, Drop-off, Member: lihat td-pages.js
   * ------------------------------------------------------------ */
  const fn = (name) => (typeof window[name] === "function" ? window[name] : null);
  const openQueue = () => window.TdPages?.openQueue?.();
  const openDropoff = () => window.TdPages?.openDropoff?.();
  const openMember = () => window.TdPages?.openMember?.();

  /* ------------------------------------------------------------ *
   * Halaman Event (view only) — daftar event, detail memakai view lama
   * ------------------------------------------------------------ */
  function eventCard(e) {
    const active = e.status === "ACTIVE";
    return `
      <button type="button" class="td-c td-evc" data-event="${esc(e.eventId)}">
        <div class="td-ev-row">
          <span class="td-ib">${ico("star")}</span>
          <div class="td-txt">
            <b>${esc(e.title)}</b>
            <small>${esc(fmtRange(e.startsAt, e.endsAt))}</small>
          </div>
          <span class="td-badge${active ? " m" : ""}">${active ? "Berlangsung" : "Akan datang"}</span>
        </div>
        ${e.description ? `<p class="td-ev-ds">${esc(e.description)}</p>` : ""}
      </button>`;
  }

  async function openEvents() {
    const body = openPage({ key: "events", title: "Event" });
    body.innerHTML = '<div class="td-c td-empty">Memuat…</div>';
    try {
      const data = await call("/event/active");
      if (!isOpen("events")) return;
      const events = Array.isArray(data.events) ? data.events : [];
      body.innerHTML = `
        <div class="td-list td-grid">
          ${events.length ? events.map(eventCard).join("") : '<div class="td-c td-empty">Belum ada event aktif.</div>'}
        </div>
        <div class="td-foot">Event dikelola admin · halaman hanya untuk dilihat</div>`;
      body.querySelectorAll("[data-event]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-event");
          closePage();
          setTimeout(() => {
            if (role() === "STAFF") fn("openStaffEvent")?.(id);
            else fn("openCustomerEvent")?.(id);
          }, 60);
        });
      });
    } catch (error) {
      if (isOpen("events")) body.innerHTML = `<div class="td-c td-empty">${esc(error.message || "Gagal memuat event.")}</div>`;
    }
  }

  /* ------------------------------------------------------------ *
   * STAFF — daftar request antar/jemput
   * ------------------------------------------------------------ */
  let reqFilter = "ALL";
  const FILTERS = [
    ["ALL", "Semua", "all"],
    ["NEW", "Baru", "new"],
    ["CONFIRMED", "Dikonfirmasi", "confirmed"],
    ["COMPLETED", "Selesai", "completed"],
  ];

  function statusBadge(status) {
    if (status === "NEW") return '<span class="td-badge">Baru</span>';
    if (status === "CONFIRMED") return '<span class="td-badge m">Dikonfirmasi</span>';
    if (status === "COMPLETED") return '<span class="td-badge g">Selesai</span>';
    return '<span class="td-badge r">Ditolak</span>';
  }

  function staffRequestCard(r) {
    const isPickup = r.type === "PICKUP";
    const verb = isPickup ? "dijemput" : "diantar";
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}`;
    let actions = "";
    if (r.status === "NEW") {
      actions = `<div class="td-act">
        <button type="button" class="d" data-act="reject" data-id="${esc(r.id)}">Tolak</button>
        <button type="button" class="p" data-act="confirm" data-id="${esc(r.id)}" data-type="${esc(r.type)}" data-order="${esc(r.orderId || "")}">Konfirmasi</button></div>`;
    } else if (r.status === "CONFIRMED") {
      actions = `<div class="td-act"><button type="button" class="p" data-act="complete" data-id="${esc(r.id)}">${ico("check")}Tandai selesai ${verb}</button></div>`;
    } else if (r.status === "COMPLETED") {
      actions = `<div class="td-done">${ico("check")}Selesai ${verb} · ${esc(fmtWib(r.completedAt))}</div>`;
    }
    return `
      <article class="td-c">
        <div class="td-rq-top"><h2>${esc(r.name)}</h2>${statusBadge(r.status)}</div>
        <div class="tx-chips">
          <span class="td-badge tx-type">${isPickup ? "Jemput" : "Antar"}</span>
          ${r.orderId ? `<span class="td-badge tx-order">No. Order ${esc(r.orderId)}</span>` : ""}
        </div>
        <div class="td-ir g3">
          <span>${ico("truck")}${isPickup ? "Jemput" : "Antar"}</span>
          <span>${ico("cal")}${esc(fmtDate(r.date))}</span>
          <span>${ico("clock")}${esc(fmtTime(r.time))}</span>
        </div>
        <div class="td-ir">${ico("phone")}<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></div>
        <div class="td-ir">${ico("pin")}<a href="${maps}" target="_blank" rel="noopener noreferrer">${esc(r.address)}</a></div>
        <div class="td-ir">${ico("scale")}<span>±${esc(r.estWeightKg)} kg · ${esc(r.itemCount)} ${unitLabel(r.itemUnit)}</span></div>
        ${r.notes ? `<div class="td-ir mu">${ico("note")}<span>Catatan: ${esc(r.notes)}</span></div>` : ""}
        ${isPickup && r.estDoneAt ? `<div class="td-ir mu">${ico("clock")}<span>Estimasi selesai pengerjaan ${esc(fmtWib(r.estDoneAt))}</span></div>` : ""}
        ${actions}
      </article>`;
  }

  function renderChips(counts) {
    const el = $("tdChips");
    if (!el) return;
    el.innerHTML = FILTERS.map(([key, label, c]) =>
      `<button type="button" class="td-chip" data-filter="${key}" aria-pressed="${reqFilter === key}">${label} <i>${counts?.[c] ?? 0}</i></button>`,
    ).join("");
    el.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        reqFilter = btn.getAttribute("data-filter");
        loadStaffRequests();
      });
    });
  }

  async function loadStaffRequests() {
    if (!isOpen("requests")) return;
    const list = $("tdList");
    try {
      const data = await call(`/staff/delivery/requests?status=${encodeURIComponent(reqFilter)}`);
      if (!isOpen("requests")) return;
      renderChips(data.counts);
      const items = data.requests || [];
      list.innerHTML = items.length
        ? items.map(staffRequestCard).join("")
        : '<div class="td-c td-empty">Belum ada request.</div>';
      setRequestBadge(data.counts?.new ?? 0);
    } catch (error) {
      if (isOpen("requests")) list.innerHTML = `<div class="td-c td-empty">${esc(error.message || "Gagal memuat request.")}</div>`;
    }
  }

  const ACTION_TEXT = {
    confirm: ["Konfirmasi request ini?", "Request dikonfirmasi"],
    reject: ["Tolak request ini?", "Request ditolak"],
    complete: ["Tandai request ini sudah selesai?", "Request selesai"],
  };

  /* Konfirmasi request JEMPUT: Staff hanya mengisi estimasi selesai pengerjaan
     (nomor order & data cucian otomatis menjadi drop-off). */
  let pickupEstHours = 24;
  const dtLocal = (date) => {
    const w = new Date(date.getTime() + 7 * 3600 * 1000);
    return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  };

  function askPickupEstimate(orderId) {
    return new Promise((resolve) => {
      $("tdEstModal")?.remove();
      const el = document.createElement("div");
      el.id = "tdEstModal";
      el.className = "td-modal";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.innerHTML = `<div class="td-modal-card">
        <h2>Konfirmasi Request Jemput</h2>
        <p>${orderId ? `Nomor order <b>${esc(orderId)}</b> otomatis menjadi nomor drop-off. ` : ""}Isi estimasi selesai pengerjaan.</p>
        <div class="td-f" data-f="est"><label for="tdEstInput">Estimasi selesai</label>
          <input class="td-in" id="tdEstInput" type="datetime-local" value="${esc(dtLocal(new Date(Date.now() + pickupEstHours * 3600 * 1000)))}">
          <div class="td-e" role="alert"></div></div>
        <div class="td-act"><button type="button" id="tdEstNo">Batal</button><button type="button" class="p" id="tdEstYes">Konfirmasi</button></div>
      </div>`;
      document.body.appendChild(el);
      const done = (value) => { el.remove(); resolve(value); };
      $("tdEstNo").addEventListener("click", () => done(null));
      $("tdEstYes").addEventListener("click", () => {
        const v = $("tdEstInput").value;
        const d = v ? new Date(`${v}:00+07:00`) : null;
        const hours = d ? (d.getTime() - Date.now()) / 3600000 : NaN;
        const wrap = el.querySelector(".td-f");
        if (!d || !(hours >= 1)) {
          wrap.classList.add("err");
          wrap.querySelector(".td-e").textContent = "Estimasi minimal 1 jam dari sekarang.";
          return;
        }
        done(d.toISOString());
      });
      $("tdEstInput").focus();
    });
  }

  async function runAction(button) {
    const act = button.getAttribute("data-act");
    const id = button.getAttribute("data-id");
    const [question, done] = ACTION_TEXT[act] || [];
    if (!question) return;

    let payload;
    if (act === "confirm" && button.getAttribute("data-type") === "PICKUP") {
      try {
        const r = await call("/program/settings");
        const h = Number(r.settings?.dropoff?.estimateHours);
        if (h >= 1) pickupEstHours = h;
      } catch { /* pakai bawaan */ }
      const est = await askPickupEstimate(button.getAttribute("data-order"));
      if (!est) return;
      payload = JSON.stringify({ estDoneAt: est });
    } else if (!window.confirm(question)) {
      return;
    }

    const siblings = button.parentElement.querySelectorAll("button");
    siblings.forEach((b) => { b.disabled = true; });
    try {
      await call(`/staff/delivery/requests/${encodeURIComponent(id)}/${act}`, { method: "POST", body: payload });
      toast(done);
    } catch (error) {
      toast(error.message || "Aksi gagal.");
    }
    loadStaffRequests();
    refreshDashboard();
  }

  function openStaffRequests() {
    const body = openPage({ key: "requests", title: "Request Antar / Jemput" });
    body.innerHTML = '<div class="td-chips" id="tdChips"></div><div class="td-list td-grid" id="tdList"><div class="td-c td-empty">Memuat…</div></div>';
    renderChips({});
    $("tdList").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-act]");
      if (btn) runAction(btn);
    });
    loadStaffRequests();
  }

  /* ------------------------------------------------------------ *
   * CUSTOMER — form request antar/jemput
   * ------------------------------------------------------------ */
  function infoCard(s) {
    const lines = [];
    lines.push(`Jam operasional ${esc(fmtTime(s.hoursStart))} – ${esc(fmtTime(s.hoursEnd))}`);
    if (s.areas) lines.push(`Area: ${esc(s.areas)}`);
    if (s.minOrderKg) lines.push(`Minimum ${esc(s.minOrderKg)} kg`);
    if (s.tariffLabel) lines.push(`Tarif: ${esc(s.tariffLabel)}`);
    if (s.note) lines.push(esc(s.note));
    const wa = typeof qdmWhatsappHref === "function"
      ? qdmWhatsappHref(s.whatsapp, "Halo, saya mau tanya layanan antar/jemput laundry.")
      : "";
    return `<section class="td-c"><h2>Info layanan</h2>${lines.map((l) => `<p class="td-note">${l}</p>`).join("")}${
      wa ? `<p class="td-note"><a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">Hubungi via WhatsApp</a></p>` : ""
    }</section>`;
  }

  function fieldWrap(key, label, inner, required = true) {
    return `<div class="td-f" data-f="${key}"><label for="td_${key}">${label}${
      required ? '<span class="td-req-star">*</span>' : '<span class="td-opt"> (opsional)</span>'
    }</label>${inner}<div class="td-e" role="alert"></div></div>`;
  }

  function defaultSchedule(info) {
    const s = info.settings;
    let date = info.today;
    let time = s.hoursStart;
    if (info.nowTime > s.hoursEnd) {
      date = addDays(info.today, 1);
    } else if (info.nowTime >= s.hoursStart) {
      const [h] = info.nowTime.split(":").map(Number);
      const next = `${pad(Math.min(h + 1, 23))}:00`;
      time = next <= s.hoursEnd ? next : s.hoursEnd;
    }
    return { date, time };
  }

  function renderForm(body, info) {
    const s = info.settings;
    const sched = defaultSchedule(info);
    const profile = info.profile || {};
    const f = { type: "PICKUP", unit: "BASKET", count: 1 };

    body.innerHTML = `
      <div class="td-form">
        <section class="td-c ca"><h2>Jadwal</h2><div class="td-fs">
          <div class="td-f" data-f="type"><span class="td-lb">Jenis layanan<span class="td-req-star">*</span></span>
            <div class="td-seg" role="group" aria-label="Jenis layanan">
              <button type="button" data-type="PICKUP" aria-pressed="true">Jemput</button>
              <button type="button" data-type="DELIVERY" aria-pressed="false">Antar</button>
            </div><div class="td-e" role="alert"></div></div>
          <div class="td-g2">
            ${fieldWrap("date", "Tanggal", `<input class="td-in" id="td_date" type="date" min="${esc(info.today)}" max="${esc(addDays(info.today, 60))}" value="${esc(sched.date)}">`)}
            ${fieldWrap("time", "Jam", `<input class="td-in" id="td_time" type="time" min="${esc(s.hoursStart)}" max="${esc(s.hoursEnd)}" value="${esc(sched.time)}">`)}
          </div><p class="td-note">Jam operasional ${esc(fmtTime(s.hoursStart))} – ${esc(fmtTime(s.hoursEnd))}${s.minOrderKg ? ` · minimum ${esc(s.minOrderKg)} kg` : ""}${s.tariffLabel ? ` · tarif: ${esc(s.tariffLabel)}` : ""}${s.areas ? ` · area: ${esc(s.areas)}` : ""}</p></div></section>
        <section class="td-c cb"><h2>Data pemohon</h2><div class="td-fs">
          ${fieldWrap("name", "Nama", `<input class="td-in" id="td_name" type="text" maxlength="60" autocomplete="name" value="${esc(profile.name || "")}">`)}
          ${fieldWrap("phone", "No. telepon", `<input class="td-in" id="td_phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" value="${esc(profile.phone || "")}">`)}
          ${fieldWrap("address", "Alamat", '<textarea class="td-ta" id="td_address" rows="3" maxlength="250" autocomplete="street-address"></textarea>')}
        </div></section>
        <section class="td-c cc"><h2>Cucian</h2><div class="td-fs">
          <div class="td-g2">
            ${fieldWrap("weight", "Estimasi berat", `<div class="td-suffix"><input class="td-in" id="td_weight" type="number" inputmode="decimal" min="${esc(s.minOrderKg || 1)}" max="99" step="0.5" placeholder="0"><span>kg</span></div>`)}
            <div class="td-f" data-f="count"><span class="td-lb">Jumlah<span class="td-req-star">*</span></span>
              <div class="td-stp"><button type="button" id="tdMinus" aria-label="Kurangi">${ico("minus")}</button><output id="tdCount">1</output><button type="button" id="tdPlus" aria-label="Tambah">${ico("plus")}</button></div>
              <div class="td-e" role="alert"></div></div>
          </div>
          <div class="td-f" data-f="unit"><span class="td-lb">Satuan jumlah<span class="td-req-star">*</span></span>
            <div class="td-seg" role="group" aria-label="Satuan jumlah">
              <button type="button" data-unit="BASKET" aria-pressed="true">Keranjang</button>
              <button type="button" data-unit="BAG" aria-pressed="false">Bungkus</button>
            </div><div class="td-e" role="alert"></div></div>
          ${fieldWrap("notes", "Catatan", '<textarea class="td-ta s" id="td_notes" rows="2" maxlength="200" placeholder="Contoh: titip ke satpam"></textarea>', false)}
        </div></section>
      </div>`;

    stickyEl.innerHTML = '<button type="button" class="td-btn" id="tdSubmit">Kirim Request</button>';

    const setPressed = (selector, attr, value) => {
      body.querySelectorAll(selector).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
    };
    body.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => {
      f.type = b.getAttribute("data-type");
      setPressed("[data-type]", "data-type", f.type);
    }));
    body.querySelectorAll("[data-unit]").forEach((b) => b.addEventListener("click", () => {
      f.unit = b.getAttribute("data-unit");
      setPressed("[data-unit]", "data-unit", f.unit);
    }));

    const syncCount = () => {
      $("tdCount").textContent = String(f.count);
      $("tdMinus").disabled = f.count <= 1;
      $("tdPlus").disabled = f.count >= 20;
    };
    $("tdMinus").addEventListener("click", () => { f.count = Math.max(1, f.count - 1); syncCount(); });
    $("tdPlus").addEventListener("click", () => { f.count = Math.min(20, f.count + 1); syncCount(); });
    syncCount();

    const setError = (key, text) => {
      const wrap = body.querySelector(`.td-f[data-f="${key}"]`);
      if (!wrap) return;
      wrap.classList.toggle("err", Boolean(text));
      const e = wrap.querySelector(".td-e");
      if (e) e.textContent = text || "";
    };
    body.querySelectorAll(".td-in, .td-ta").forEach((input) => {
      input.addEventListener("input", () => setError(input.id.replace("td_", ""), ""));
    });

    const collect = () => ({
      type: f.type,
      date: $("td_date").value,
      time: $("td_time").value,
      name: $("td_name").value.trim(),
      phone: $("td_phone").value.trim(),
      address: $("td_address").value.trim(),
      estWeightKg: Number($("td_weight").value),
      itemCount: f.count,
      itemUnit: f.unit,
      notes: $("td_notes").value.trim(),
    });

    const validate = (v) => {
      const e = {};
      if (!v.date || v.date < info.today) e.date = "Tanggal tidak boleh sebelum hari ini.";
      if (!v.time) e.time = "Jam wajib diisi.";
      else if (v.time < s.hoursStart || v.time > s.hoursEnd) e.time = `Jam operasional ${fmtTime(s.hoursStart)} – ${fmtTime(s.hoursEnd)}.`;
      else if (v.date === info.today && v.time < info.nowTime) e.time = "Jam sudah lewat.";
      if (v.name.length < 2) e.name = "Nama minimal 2 karakter.";
      if (v.phone.replace(/[^\d+]/g, "").length < 8) e.phone = "Nomor telepon tidak valid.";
      if (v.address.length < 10) e.address = "Alamat minimal 10 karakter.";
      if (!Number.isFinite(v.estWeightKg) || v.estWeightKg < 1 || v.estWeightKg > 99) e.weight = "Estimasi berat 1–99 kg.";
      else if (s.minOrderKg && v.estWeightKg < s.minOrderKg) e.weight = `Minimum ${s.minOrderKg} kg.`;
      return e;
    };

    $("tdSubmit").addEventListener("click", async () => {
      const values = collect();
      const errors = validate(values);
      ["date", "time", "name", "phone", "address", "weight"].forEach((k) => setError(k, errors[k] || ""));
      const first = Object.keys(errors)[0];
      if (first) {
        const target = body.querySelector(`.td-f[data-f="${first}"]`);
        if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const btn = $("tdSubmit");
      btn.disabled = true;
      btn.textContent = "Mengirim…";
      try {
        await call("/delivery/requests", { method: "POST", body: JSON.stringify(values) });
        toast("Request terkirim · menunggu konfirmasi");
        closePage();
      } catch (error) {
        toast(error.message || "Request gagal dikirim.");
        btn.disabled = false;
        btn.textContent = "Kirim Request";
      }
    });
  }

  async function openCustomerRequest() {
    const body = openPage({ key: "request", title: "Request Antar / Jemput", sticky: true });
    body.innerHTML = '<div class="td-c td-empty">Memuat…</div>';
    stickyEl.hidden = true;
    try {
      const info = await call("/delivery/settings");
      if (!isOpen("request")) return;
      if (!info.settings.enabled) {
        body.innerHTML = `${infoCard(info.settings)}<div class="td-c td-empty">Layanan antar/jemput sedang tidak aktif.</div>`;
        return;
      }
      stickyEl.hidden = false;
      renderForm(body, info);
    } catch (error) {
      if (isOpen("request")) body.innerHTML = `<div class="td-c td-empty">${esc(error.message || "Gagal memuat form.")}</div>`;
    }
  }

  /* ------------------------------------------------------------ *
   * Dashboard (layer #tdDash) — menggantikan tampilan dashboard lama.
   * Dashboard lama tetap ada (disembunyikan CSS) sebagai sumber data
   * dan agar seluruh logika app.js tetap berjalan.
   * ------------------------------------------------------------ */
  const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const chev = () => `<svg class="td-chv" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chev}</svg>`;

  function setRequestBadge(count) {
    const card = $("tdReq");
    if (!card) return;
    const badge = card.querySelector(".td-badge");
    const sub = card.querySelector("small");
    badge.textContent = count > 99 ? "99+" : String(count);
    if (badge.hidden !== !count) badge.hidden = !count;
    sub.textContent = count
      ? "menunggu konfirmasi"
      : (role() === "STAFF" ? "Tidak ada request baru" : "Ajukan antar / jemput");
  }

  async function refreshRequestCard() {
    try {
      if (role() === "STAFF") {
        const data = await call("/staff/delivery/count");
        setRequestBadge(Number(data.newCount) || 0);
      } else if (role() === "CUSTOMER") {
        const mine = await call("/delivery/requests/mine");
        setRequestBadge(Number(mine.newCount) || 0);
      }
    } catch { /* kartu bersifat pelengkap */ }
  }

  async function refreshMenuCounts() {
    const el = $("tdDropSub");
    if (!el) return;
    try {
      if (role() === "STAFF") {
        const data = await call("/staff/dropoff/active");
        el.textContent = `${Number(data.activeCount ?? (data.orders || []).length)} pesanan aktif`;
      } else if (role() === "CUSTOMER") {
        const data = await call("/dropoff/mine");
        el.textContent = `${Number(data.activeCount ?? (data.order ? 1 : 0))} pesanan aktif`;
      }
    } catch { /* abaikan */ }
  }

  async function refreshQueueSummary() {
    if (role() === "CUSTOMER") {
      try {
        const board = await call("/queue/self-service/board");
        if ($("tdQW")) $("tdQW").textContent = String(board.washer?.waitingCount ?? 0);
        if ($("tdQD")) $("tdQD").textContent = String(board.dryer?.waitingCount ?? 0);
      } catch { /* abaikan */ }
      return;
    }
    if (role() !== "STAFF") return;
    try {
      const data = await call("/staff/queue/self-service");
      const tickets = data.tickets || [];
      const count = (type) => tickets.filter((t) => t.machine_type === type && t.status === "WAITING").length;
      if ($("tdQW")) $("tdQW").textContent = String(count("WASHER"));
      if ($("tdQD")) $("tdQD").textContent = String(count("DRYER"));
    } catch { /* abaikan */ }
  }

  async function refreshEventBadge() {
    const badge = document.querySelector("#tdEv .td-badge");
    if (!badge) return;
    try {
      const data = await call("/event/active");
      const n = Array.isArray(data.events) ? data.events.length : 0;
      badge.textContent = String(n);
      if (badge.hidden !== (n === 0)) badge.hidden = n === 0;
    } catch { /* abaikan */ }
  }

  function refreshDashboard() {
    if (!$("tdDash") || $("tdDash").hidden) return;
    refreshRequestCard();
    refreshMenuCounts();
    refreshQueueSummary();
    refreshEventBadge();
  }

  function mirror(pairs) {
    pairs.forEach(([from, to]) => {
      const src = $(from);
      const dst = $(to);
      if (!src || !dst) return;
      const copy = () => { dst.textContent = (src.textContent || "").trim(); };
      copy();
      new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true });
    });
  }

  function miniCard(icon, label, totalId, idleId, busyId) {
    return `<div class="td-mini"><span class="td-mi">${ico(icon, "")}</span><div>
      <div class="td-ml">${label} (<span id="${totalId}">5</span>)</div>
      <div class="td-dots"><span><i class="td-d"></i><b id="${idleId}" style="font-weight:inherit">0</b></span><span><i class="td-d a"></i><b id="${busyId}" style="font-weight:inherit">0</b></span></div>
    </div></div>`;
  }

  function menuItem(id, icon, title, subId, sub) {
    return `<button type="button" class="td-card td-menu-item" id="${id}"><span class="td-ib">${ico(icon, "")}</span><span class="td-txt"><b>${title}</b><small id="${subId}">${sub}</small></span></button>`;
  }

  function activate(el, handler) {
    if (!el) return;
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  }

  function buildDash(r) {
    const isC = r === "CUSTOMER";
    const p = isC ? "customer" : "staff";
    const el = document.createElement("div");
    el.id = "tdDash";
    el.dataset.role = r;
    el.className = `td-dash ${isC ? "td-d-customer" : "td-d-staff"}`;
    el.hidden = true;
    el.innerHTML = `
      <div class="td-d-wrap"><div class="td-canvas">
        ${isC ? '<img class="td-logo" src="/assets/branding/branding.png" alt="Teras Laundry"><div class="td-who" id="tdWho"></div>' : ""}
        <div class="td-flow">
          <div class="td-hdr">
            <div class="td-card td-date" id="tdDate"></div>
            <button type="button" class="td-card td-sq" id="tdServicesBtn" aria-label="Layanan &amp; Fasilitas" title="Layanan &amp; Fasilitas">${ico("sun", "")}</button>
            <button type="button" class="td-card td-out" id="tdLogout">${ico("out", "")}Logout</button>
          </div>
          <section class="td-card td-pad td-clickable" id="tdStatus" role="button" tabindex="0" aria-label="Buka Status Mesin">
            <div class="td-ct"><h2>Status Mesin</h2>${chev()}</div>
            <div class="td-two">
              ${miniCard("wash", "Washer", "tdWT", "tdWI", "tdWB")}
              ${miniCard("dry", "Dryer", "tdDT", "tdDI", "tdDB")}
            </div>
          </section>
          <section class="td-card td-pad td-clickable" id="tdQueue" role="button" tabindex="0" aria-label="Buka Antrean Self-Service">
            <div class="td-ct"><h2>Antrean Self-Service</h2></div>
            <div class="td-two">
              <div class="td-q"><span>Washer</span><em id="tdQW">0</em></div>
              <div class="td-q"><span>Dryer</span><em id="tdQD">0</em></div>
            </div>
          </section>
          <div class="td-menu">
            ${menuItem("tdDrop", "box", "Drop-off", "tdDropSub", "0 pesanan aktif")}
            ${menuItem("tdMember", "users", "Member", "tdMemberSub", "Koin &amp; reward")}
          </div>
          <button type="button" class="td-card td-req" id="tdReq">
            <span class="td-ib">${ico("truck", "")}</span>
            <span class="td-txt"><b>Request Antar / Jemput</b><small>${isC ? "Ajukan antar / jemput" : "menunggu konfirmasi"}</small></span>
            <span class="td-badge" hidden>0</span>${chev()}
          </button>
          <button type="button" class="td-card td-ev" id="tdEv">
            <h2>Event</h2><span class="td-badge m" hidden>0</span>${chev()}
          </button>
        </div>
      </div></div>`;
    document.body.appendChild(el);

    mirror(isC
      ? [["customerWasherTotal", "tdWT"], ["customerWasherIdle", "tdWI"], ["customerWasherBusy", "tdWB"],
         ["customerDryerTotal", "tdDT"], ["customerDryerIdle", "tdDI"], ["customerDryerBusy", "tdDB"]]
      : [["staffWasherTotal", "tdWT"], ["staffWasherIdle", "tdWI"], ["staffWasherBusy", "tdWB"],
         ["staffDryerTotal", "tdDT"], ["staffDryerIdle", "tdDI"], ["staffDryerBusy", "tdDB"]]);

    activate($("tdStatus"), () => fn(isC ? "openCustomerMachineStatus" : "openStaffMachineStatus")?.());
    activate($("tdQueue"), openQueue);
    $("tdServicesBtn").addEventListener("click", () => fn(isC ? "openCustomerServices" : "openStaffServices")?.());
    $("tdLogout").addEventListener("click", () => $(`${p}Logout`)?.click());
    $("tdDrop").addEventListener("click", openDropoff);
    $("tdMember").addEventListener("click", openMember);
    $("tdReq").addEventListener("click", isC ? openCustomerRequest : openStaffRequests);
    $("tdEv").addEventListener("click", openEvents);
    tickDate();
    if (isC) loadWho();
    try { window.TdPages?.onDashboard?.(r); } catch { /* abaikan */ }
    return el;
  }

  /* Nama + nomor HP customer yang sedang login (di bawah logo). */
  const fmtPhone = (p) => {
    let d = String(p || "").replace(/\D/g, "");
    if (d.startsWith("62")) d = `0${d.slice(2)}`;
    return d.length > 8 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : d;
  };
  function paintWho(profile) {
    const el = $("tdWho");
    if (!el || !profile) return;
    el.innerHTML = `<b>${esc(profile.name || "")}</b> · ${esc(fmtPhone(profile.phone))}`;
  }
  async function loadWho() {
    const stored = window.TdAuth?.profile?.();
    if (stored) { paintWho(stored); return; }
    try {
      const me = await call("/member/me");
      if (me.customer?.name || me.customer?.phone) paintWho(me.customer);
    } catch { /* abaikan */ }
  }

  function tickDate() {
    const el = $("tdDate");
    if (!el) return;
    const n = new Date();
    el.textContent = `${DAYS[n.getDay()]}, ${pad(n.getDate())} ${MONTHS[n.getMonth()]} ${n.getFullYear()}, ${pad(n.getHours())}:${pad(n.getMinutes())}`;
  }

  let dashWasVisible = false;

  function syncDash() {
    const r = role();
    let el = $("tdDash");
    const legacy = r === "STAFF" ? $("staffDashboard") : r === "CUSTOMER" ? $("customerDashboard") : null;
    const screen = r === "STAFF" ? $("staff") : r === "CUSTOMER" ? $("customer") : null;
    const show = Boolean(legacy && screen && !legacy.hidden && !screen.hidden);

    if (!show) {
      if (el && !el.hidden) el.hidden = true;
      document.documentElement.classList.remove("td-dash-on");
      dashWasVisible = false;
      return;
    }
    if (!el || el.dataset.role !== r) {
      if (el) el.remove();
      el = buildDash(r);
    }
    if (el.hidden) el.hidden = false;
    document.documentElement.classList.add("td-dash-on");
    if (!dashWasVisible) {
      dashWasVisible = true;
      refreshDashboard();
    }
  }

  /* ------------------------------------------------------------ *
   * Pembungkus fungsi global app.js (tanpa mengubah app.js)
   * ------------------------------------------------------------ */
  function wrap(name, after, before) {
    const original = window[name];
    if (typeof original !== "function" || original.__tdWrapped) return;
    const wrapped = function (...args) {
      if (before) {
        try { if (before.apply(this, args) === true) return undefined; } catch { /* abaikan */ }
      }
      const result = original.apply(this, args);
      if (after) {
        try { after.apply(this, args); } catch { /* abaikan */ }
      }
      return result;
    };
    wrapped.__tdWrapped = true;
    window[name] = wrapped;
  }

  function install() {
    wrap("refreshStaffQueueList", () => refreshQueueSummary());
    wrap("refreshStaffDropoffList", () => refreshMenuCounts());
    wrap("refreshCustomerDropoff", () => refreshMenuCounts());

    // Realtime: DELIVERY_REQUEST_UPDATED ditangani di sini; tipe lain diteruskan.
    wrap("handleRealtimeMessage", null, (message) => {
      if (!message || typeof message !== "object") return false;
      if (message.type === "DELIVERY_REQUEST_UPDATED") {
        refreshRequestCard();
        if (isOpen("requests")) loadStaffRequests();
        return true;
      }
      return false;
    });
  }

  function start() {
    install();
    new MutationObserver(syncDash).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    setInterval(() => {
      tickDate();
      if (new Date().getSeconds() === 0) syncDash();
    }, 1000);
    setInterval(() => refreshDashboard(), 60000);
    syncDash();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.TdUi = {
    openPage, closePage, isOpen, esc, ico, call, role, toast, fmtDate, fmtTime, fmtWib, pad, MONTHS, setProfile: paintWho,
    body: () => bodyEl, sticky: () => stickyEl, refreshDashboard, unitLabel,
  };
  window.TerasUi = { openStaffRequests, openCustomerRequest, openEvents, closePage, refreshDashboard };
})();
