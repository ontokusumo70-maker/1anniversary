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
  let parked = [];

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
    $("tdBack").addEventListener("click", () => closePage());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && pageOpen) closePage();
    });
  }

  function park(node) {
    if (!node || !node.parentNode) return;
    const placeholder = document.createComment("td-park");
    node.parentNode.insertBefore(placeholder, node);
    parked.push({ node, placeholder });
    bodyEl.appendChild(node);
  }

  function restoreParked() {
    parked.forEach(({ node, placeholder }) => {
      if (placeholder.parentNode) {
        placeholder.parentNode.insertBefore(node, placeholder);
        placeholder.remove();
      }
    });
    parked = [];
  }

  function openPage({ key, title, sticky = false }) {
    ensurePage();
    if (pageOpen) {
      restoreParked();
    } else {
      try { history.pushState({ tdPage: key }, "", location.href); } catch { /* abaikan */ }
    }
    pageOpen = true;
    pageKey = key;
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
    restoreParked();
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
   * Halaman: kartu lama yang dipindahkan (Antrean, Drop-off, Member)
   * ------------------------------------------------------------ */
  function openParkedPage(key, title, cardId, refresh) {
    const body = openPage({ key, title });
    const card = $(cardId);
    if (!card) {
      body.innerHTML = '<div class="td-c"><div class="td-empty">Halaman tidak tersedia.</div></div>';
      return;
    }
    park(card);
    let empty = null;
    if (cardId === "customerDropoffCard") {
      empty = document.createElement("div");
      empty.className = "td-c td-empty";
      empty.textContent = "Belum ada laundry drop-off aktif.";
      empty.hidden = true;
      body.appendChild(empty);
    }
    const done = () => { if (empty) empty.hidden = !card.hidden; };
    try {
      Promise.resolve(refresh && refresh()).then(done, done);
    } catch { done(); }
  }

  const fn = (name) => (typeof window[name] === "function" ? window[name] : null);

  function openQueue() {
    if (role() === "STAFF") {
      openParkedPage("queue", "Antrean Self-Service", "staffQueueCard", () => fn("refreshStaffQueueList")?.());
    } else {
      openParkedPage("queue", "Antrean Self-Service", "customerQueueCard", () => {
        fn("refreshCustomerQueueBoard")?.();
        return fn("refreshCustomerMyTickets")?.();
      });
    }
  }

  function openDropoff() {
    if (role() === "STAFF") {
      openParkedPage("dropoff", "Drop-off", "staffDropoffCard", () => fn("refreshStaffDropoffList")?.());
    } else {
      openParkedPage("dropoff", "Drop-off", "customerDropoffCard", () => fn("refreshCustomerDropoff")?.());
    }
  }

  function openMember() {
    if (role() === "STAFF") {
      openParkedPage("member", "Member", "staffMemberCard", null);
    } else {
      openParkedPage("member", "Member", "customerMemberCard", () => fn("refreshCustomerMember")?.());
    }
  }

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
        <div class="td-list td-evs">
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
        <button type="button" class="p" data-act="confirm" data-id="${esc(r.id)}">Konfirmasi</button></div>`;
    } else if (r.status === "CONFIRMED") {
      actions = `<div class="td-act"><button type="button" class="p" data-act="complete" data-id="${esc(r.id)}">${ico("check")}Tandai selesai ${verb}</button></div>`;
    } else if (r.status === "COMPLETED") {
      actions = `<div class="td-done">${ico("check")}Selesai ${verb} · ${esc(fmtWib(r.completedAt))}</div>`;
    }
    return `
      <article class="td-c">
        <div class="td-rq-top"><h2>${esc(r.name)}</h2>${statusBadge(r.status)}</div>
        <div class="td-ir g3">
          <span>${ico("truck")}${isPickup ? "Jemput" : "Antar"}</span>
          <span>${ico("cal")}${esc(fmtDate(r.date))}</span>
          <span>${ico("clock")}${esc(fmtTime(r.time))}</span>
        </div>
        <div class="td-ir">${ico("phone")}<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></div>
        <div class="td-ir">${ico("pin")}<a href="${maps}" target="_blank" rel="noopener noreferrer">${esc(r.address)}</a></div>
        <div class="td-ir">${ico("scale")}<span>±${esc(r.estWeightKg)} kg · ${esc(r.itemCount)} ${unitLabel(r.itemUnit)}</span></div>
        ${r.notes ? `<div class="td-ir mu">${ico("note")}<span>Catatan: ${esc(r.notes)}</span></div>` : ""}
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

  async function runAction(button) {
    const act = button.getAttribute("data-act");
    const id = button.getAttribute("data-id");
    const [question, done] = ACTION_TEXT[act] || [];
    if (!question || !window.confirm(question)) return;
    const siblings = button.parentElement.querySelectorAll("button");
    siblings.forEach((b) => { b.disabled = true; });
    try {
      await call(`/staff/delivery/requests/${encodeURIComponent(id)}/${act}`, { method: "POST" });
      toast(done);
    } catch (error) {
      toast(error.message || "Aksi gagal.");
    }
    loadStaffRequests();
  }

  function openStaffRequests() {
    const body = openPage({ key: "requests", title: "Request Antar / Jemput" });
    body.innerHTML = '<div class="td-chips" id="tdChips"></div><div class="td-list" id="tdList"><div class="td-c td-empty">Memuat…</div></div>';
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
      ${infoCard(s)}
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
          </div></div></section>
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
   * Dashboard: kartu baru (Antrean, Menu, Request) & badge
   * ------------------------------------------------------------ */
  function setRequestBadge(count) {
    const card = $(role() === "STAFF" ? "staffRequestCard" : "customerRequestCard");
    if (!card) return;
    const badge = card.querySelector(".td-badge");
    const sub = card.querySelector("small");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = !count;
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
        const info = await call("/delivery/settings");
        const card = $("customerRequestCard");
        if (card) card.hidden = !info.settings.enabled;
        if (info.settings.enabled) {
          const mine = await call("/delivery/requests/mine");
          setRequestBadge(Number(mine.newCount) || 0);
        }
      }
    } catch { /* kartu bersifat pelengkap */ }
  }

  async function refreshMenuCounts() {
    try {
      if (role() === "STAFF") {
        const data = await call("/staff/dropoff/active");
        const n = (data.orders || []).length;
        const el = $("staffMenuDropoffSub");
        if (el) el.textContent = `${n} pesanan aktif`;
      } else if (role() === "CUSTOMER") {
        const data = await call("/dropoff/mine");
        const el = $("customerMenuDropoffSub");
        if (el) el.textContent = `${data.order ? 1 : 0} pesanan aktif`;
      }
    } catch { /* abaikan */ }
  }

  async function refreshStaffQueueSummary() {
    try {
      const data = await call("/staff/queue/self-service");
      const tickets = data.tickets || [];
      const count = (type) => tickets.filter((t) => t.machine_type === type && t.status === "WAITING").length;
      const w = $("staffQueueWasher");
      const d = $("staffQueueDryer");
      if (w) w.textContent = String(count("WASHER"));
      if (d) d.textContent = String(count("DRYER"));
    } catch { /* abaikan */ }
  }

  function refreshDashboard() {
    if (role() !== "STAFF" && role() !== "CUSTOMER") return;
    refreshRequestCard();
    refreshMenuCounts();
    if (role() === "STAFF") refreshStaffQueueSummary();
  }

  function buildQueueSummary(prefix, washerId, dryerId, label) {
    const el = document.createElement("section");
    el.id = `${prefix}QueueSummary`;
    el.className = "td-queue td-card";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", label);
    el.innerHTML = `<h2>Antrean Self-Service</h2>
      <div class="td-queue-grid">
        <div class="td-queue-cell"><span>Washer</span><em id="${washerId}">0</em></div>
        <div class="td-queue-cell"><span>Dryer</span><em id="${dryerId}">0</em></div>
      </div>`;
    return el;
  }

  function menuButton(id, icon, title, subId, sub) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = "td-menu-item";
    b.innerHTML = `<span class="td-ib">${ico(icon)}</span><span class="td-txt"><b>${title}</b><small id="${subId}">${sub}</small></span>`;
    return b;
  }

  function onActivate(el, handler) {
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  }

  function interceptEventCard(id) {
    const card = $(id);
    if (!card || card.dataset.tdBound) return;
    card.dataset.tdBound = "1";
    const open = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openEvents();
    };
    card.addEventListener("click", open, true);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    }, true);
    const heading = card.querySelector(".staff-section-heading");
    if (heading && !heading.querySelector(".td-badge")) {
      const badge = document.createElement("span");
      badge.className = "td-badge m";
      badge.hidden = true;
      badge.textContent = "0";
      const h2 = heading.querySelector("h2");
      if (h2) h2.after(badge); else heading.prepend(badge);
    }
  }

  function setEventBadge(cardId, data) {
    const badge = document.querySelector(`#${cardId} .td-badge`);
    if (!badge) return;
    const n = Array.isArray(data?.events) ? data.events.length : 0;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  function swapMachineIcons(dashId) {
    const icons = document.querySelectorAll(`#${dashId} .staff-status-card .staff-machine-icon svg`);
    icons.forEach((svg, i) => {
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.innerHTML = ICONS[i === 0 ? "wash" : "dry"];
    });
  }

  function injectStaff() {
    const dash = $("staffDashboard");
    if (!dash || dash.dataset.tdReady) return;
    dash.dataset.tdReady = "1";

    swapMachineIcons("staffDashboard");

    const queue = buildQueueSummary("staff", "staffQueueWasher", "staffQueueDryer", "Buka Antrean Self-Service");
    onActivate(queue, openQueue);

    const menu = document.createElement("div");
    menu.className = "td-menu";
    const drop = menuButton("staffMenuDropoff", "box", "Drop-off", "staffMenuDropoffSub", "0 pesanan aktif");
    const member = menuButton("staffMenuMember", "users", "Member", "staffMenuMemberSub", "Koin &amp; reward");
    drop.addEventListener("click", openDropoff);
    member.addEventListener("click", openMember);
    menu.append(drop, member);

    const req = document.createElement("button");
    req.type = "button";
    req.id = "staffRequestCard";
    req.className = "td-req";
    req.innerHTML = `<span class="td-ib">${ico("truck")}</span><span class="td-txt"><b>Request Antar / Jemput</b><small>menunggu konfirmasi</small></span><span class="td-badge" hidden>0</span><span class="td-chev" aria-hidden="true"></span>`;
    req.addEventListener("click", openStaffRequests);

    dash.append(queue, menu, req);
    interceptEventCard("staffEventCard");
  }

  function injectCustomer() {
    const dash = $("customerDashboard");
    if (!dash || dash.dataset.tdReady) return;
    dash.dataset.tdReady = "1";

    swapMachineIcons("customerDashboard");

    // ID penghitung antrean dipindahkan ke kartu ringkasan yang baru
    ["customerQueueWasherWaiting", "customerQueueDryerWaiting"].forEach((id) => {
      const old = $(id);
      if (old) old.removeAttribute("id");
    });
    const queue = buildQueueSummary("customer", "customerQueueWasherWaiting", "customerQueueDryerWaiting", "Buka Antrean Self-Service");
    onActivate(queue, openQueue);

    const menu = document.createElement("div");
    menu.className = "td-menu";
    const drop = menuButton("customerMenuDropoff", "box", "Drop-off", "customerMenuDropoffSub", "0 pesanan aktif");
    const member = menuButton("customerMenuMember", "users", "Member", "customerMenuMemberSub", "Koin &amp; reward");
    drop.addEventListener("click", openDropoff);
    member.addEventListener("click", openMember);
    menu.append(drop, member);

    const req = document.createElement("button");
    req.type = "button";
    req.id = "customerRequestCard";
    req.className = "td-req";
    req.hidden = true;
    req.innerHTML = `<span class="td-ib">${ico("truck")}</span><span class="td-txt"><b>Request Antar / Jemput</b><small>Ajukan antar / jemput</small></span><span class="td-badge" hidden>0</span><span class="td-chev" aria-hidden="true"></span>`;
    req.addEventListener("click", openCustomerRequest);

    dash.append(queue, menu, req);
    interceptEventCard("customerEventCard");
  }

  function onDashboardShown() {
    if (role() === "STAFF") injectStaff();
    else if (role() === "CUSTOMER") injectCustomer();
    refreshDashboard();
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
    wrap("showStaffDashboard", () => setTimeout(onDashboardShown, 0));
    wrap("showCustomerDashboard", () => setTimeout(onDashboardShown, 0));
    wrap("renderStaffDashboardEvent", (data) => setEventBadge("staffEventCard", data));
    wrap("renderCustomerDashboardEvent", (data) => setEventBadge("customerEventCard", data));
    wrap("refreshStaffQueueList", () => refreshStaffQueueSummary());
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
    const staffVisible = $("staffDashboard") && !$("staffDashboard").hidden;
    const customerVisible = $("customerDashboard") && !$("customerDashboard").hidden;
    if (staffVisible || customerVisible) onDashboardShown();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.TerasUi = { openStaffRequests, openCustomerRequest, openEvents, closePage, refreshDashboard };
})();
