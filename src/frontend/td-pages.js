/* ==========================================================================
   TERAS LAUNDRY — Standar UI v1.0
   Halaman: Antrean Self-Service, Drop-off, Member (staff & customer),
   notifikasi antrean di dashboard customer, dan pengaturan program Owner.
   Dimuat SETELAH delivery.js (memakai window.TdUi).
   ========================================================================== */
(() => {
  "use strict";
  if (window.TdPages || !window.TdUi) return;

  const U = window.TdUi;
  const { esc, ico, call, role, toast, fmtDate, fmtTime, fmtWib } = U;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------ *
   * Util
   * ------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDT = (iso) => (iso ? fmtWib(iso) : "–");
  const phoneHref = (p) => `tel:${String(p || "").replace(/[^\d+]/g, "")}`;
  const unitLabel = (u) => (u === "BAG" ? "bungkus" : "keranjang");
  const typeLabel = (t) => (t === "WASHER" ? "Washer" : "Dryer");
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function dtLocalValue(date) {
    const w = new Date(date.getTime() + 7 * 3600 * 1000);
    return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  }
  const parseDtLocal = (v) => (v ? new Date(`${v}:00+07:00`) : null);

  const badge = (text, cls = "") => `<span class="td-badge ${cls}">${esc(text)}</span>`;
  const infoRow = (icon, html, cls = "") => `<div class="td-ir ${cls}">${ico(icon)}<span>${html}</span></div>`;
  const empty = (text) => `<div class="td-c td-empty">${esc(text)}</div>`;
  const loading = () => `<div class="td-c td-empty">Memuat…</div>`;

  function field(id, label, inner, required = true) {
    return `<div class="td-f" data-f="${id}"><label for="td_${id}">${label}${
      required ? '<span class="td-req-star">*</span>' : '<span class="td-opt"> (opsional)</span>'
    }</label>${inner}<div class="td-e" role="alert"></div></div>`;
  }
  function setErr(root, key, text) {
    const w = root.querySelector(`.td-f[data-f="${key}"]`);
    if (!w) return;
    w.classList.toggle("err", Boolean(text));
    const e = w.querySelector(".td-e");
    if (e) e.textContent = text || "";
  }

  /* ============================================================ *
   * 1. ANTREAN SELF-SERVICE
   * ============================================================ */
  let queueTimer = null;
  const stopQueueTimer = () => { clearInterval(queueTimer); queueTimer = null; };

  function openQueue() {
    return role() === "STAFF" ? openStaffQueue() : openCustomerQueue();
  }

  /* ---------- staff ---------- */
  let machinesCache = [];

  async function loadStaffQueue() {
    if (!U.isOpen("queue")) return;
    const body = U.body();
    try {
      const [q, m] = await Promise.all([call("/staff/queue/self-service"), call("/machines").catch(() => ({ machines: [] }))]);
      if (!U.isOpen("queue")) return;
      machinesCache = m.machines || [];
      const tickets = q.tickets || [];
      body.innerHTML = `
        <div class="td-grid">
          ${queueGroup("WASHER", tickets)}
          ${queueGroup("DRYER", tickets)}
        </div>`;
      bindStaffQueue(body);
    } catch (error) {
      if (U.isOpen("queue")) body.innerHTML = empty(error.message || "Gagal memuat antrean.");
    }
  }

  function queueGroup(type, tickets) {
    const list = tickets.filter((t) => t.machine_type === type).sort((a, b) => a.queue_number - b.queue_number);
    const idle = machinesCache.filter((m) => m.type === type && m.status === "IDLE");
    const first = list[0];
    const items = list.map((t) => {
      const code = t.display_code || t.displayCode || `${type === "WASHER" ? "C" : "K"}-${pad(t.queue_number)}`;
      const called = t.status === "CALLED";
      const calledAt = t.called_at ? Date.parse(t.called_at) : 0;
      const canNoShow = called && calledAt && Date.now() - calledAt >= 10 * 60 * 1000;
      const isFirst = first && t.ticket_id === first.ticket_id;
      const opts = idle.map((m) => `<option value="${esc(m.machineId)}"${m.machineId === t.preferred_machine_id ? " selected" : ""}>${esc(m.machineId)}</option>`).join("");
      return `
      <article class="td-c td-tk" data-ticket="${esc(t.ticket_id)}">
        <div class="td-rq-top"><h2>${esc(code)}</h2>${called ? badge("Dipanggil", "m") : badge("Menunggu")}</div>
        ${infoRow("users", esc(t.customer_name || "Tanpa nama"))}
        ${infoRow("phone", `<a href="${phoneHref(t.phone)}">${esc(t.phone || t.phone_masked || "–")}</a>`)}
        ${infoRow("clock", `Masuk ${esc(fmtDT(t.created_at))}`, "mu")}
        ${isFirst ? `
          <div class="td-act">
            ${called ? "" : `<button type="button" data-act="call">Panggil</button>`}
            ${canNoShow ? `<button type="button" class="d" data-act="noshow">Tidak hadir</button>` : ""}
          </div>
          <div class="td-act">
            <select class="td-in td-sel" aria-label="Pilih mesin" ${idle.length ? "" : "disabled"}>${opts || '<option value="">Tidak ada mesin kosong</option>'}</select>
            <button type="button" class="p" data-act="activate" ${idle.length ? "" : "disabled"}>Aktifkan</button>
          </div>` : `<div class="td-note">Menunggu giliran antrean sebelumnya.</div>`}
      </article>`;
    }).join("");
    return `<section>
      <div class="td-sec-h"><h2>${typeLabel(type)}</h2>${badge(String(list.length), list.length ? "" : "g")}</div>
      <div class="td-list">${items || empty(`Tidak ada antrean ${typeLabel(type)}.`)}</div>
    </section>`;
  }

  function bindStaffQueue(body) {
    body.querySelectorAll(".td-tk").forEach((card) => {
      const id = card.getAttribute("data-ticket");
      card.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-act]");
        if (!btn || btn.disabled) return;
        const act = btn.getAttribute("data-act");
        btn.disabled = true;
        try {
          if (act === "call") {
            await call(`/staff/queue/self-service/${encodeURIComponent(id)}/call`, { method: "POST" });
            toast("Customer dipanggil");
          } else if (act === "noshow") {
            if (!window.confirm("Tandai customer ini tidak hadir?")) { btn.disabled = false; return; }
            await call(`/staff/queue/self-service/${encodeURIComponent(id)}/no-show`, { method: "POST" });
            toast("Ditandai tidak hadir");
          } else if (act === "activate") {
            const machineId = card.querySelector(".td-sel")?.value;
            if (!machineId) { toast("Pilih mesin dulu"); btn.disabled = false; return; }
            await call(`/staff/queue/self-service/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({ machineId }) });
            toast(`Mesin ${machineId} diaktifkan`);
          }
        } catch (error) {
          toast(error.message || "Aksi gagal.");
        }
        loadStaffQueue();
        U.refreshDashboard();
      });
    });
  }

  function openStaffQueue() {
    const body = U.openPage({ key: "queue", title: "Antrean Self-Service" });
    body.innerHTML = loading();
    loadStaffQueue();
    stopQueueTimer();
    queueTimer = setInterval(() => { if (U.isOpen("queue")) loadStaffQueue(); else stopQueueTimer(); }, 15000);
  }

  /* ---------- customer ---------- */
  async function loadCustomerQueue() {
    if (!U.isOpen("queue")) return;
    const body = U.body();
    try {
      const [board, mine] = await Promise.all([call("/queue/self-service/board"), call("/queue/self-service/mine")]);
      if (!U.isOpen("queue")) return;
      const tickets = mine.tickets || [];
      const has = (type) => tickets.some((t) => t.machineType === type);
      const boardCard = (type, b) => `
        <div class="td-q"><span>${typeLabel(type)}</span><em>${Number(b?.waitingCount ?? 0)}</em></div>`;
      const called = [board.washer?.calledDisplayCode, board.dryer?.calledDisplayCode].filter(Boolean);
      body.innerHTML = `
        <div class="td-form">
          <section class="td-c ca"><h2>Antrean saat ini</h2>
            <div class="td-two">${boardCard("WASHER", board.washer)}${boardCard("DRYER", board.dryer)}</div>
            <p class="td-note">${called.length ? `Sedang dipanggil: ${called.map(esc).join(", ")}` : "Angka menunjukkan jumlah yang sedang menunggu."}</p>
          </section>
          <section class="td-c cb"><h2>Ambil nomor antrean</h2>
            <div class="td-act">
              <button type="button" class="p" data-join="WASHER" ${has("WASHER") ? "disabled" : ""}>Ambil Nomor Washer</button>
              <button type="button" class="p" data-join="DRYER" ${has("DRYER") ? "disabled" : ""}>Ambil Nomor Dryer</button>
            </div>
            <p class="td-note">Satu nomor aktif untuk tiap jenis mesin.</p>
          </section>
          <section class="td-c cc"><h2>Nomor antrean saya</h2>
            <div class="td-list">${tickets.length ? tickets.map(myTicket).join("") : '<div class="td-empty">Belum ada nomor antrean.</div>'}</div>
          </section>
        </div>`;
      body.querySelectorAll("[data-join]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const r = await call("/queue/self-service/join", { method: "POST", body: JSON.stringify({ machineType: b.getAttribute("data-join") }) });
          toast(`Nomor antrean Anda: ${r.ticket?.displayCode || ""}`);
        } catch (error) { toast(error.message || "Gagal mengambil nomor."); }
        loadCustomerQueue(); U.refreshDashboard();
      }));
      body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
        if (!window.confirm("Batalkan nomor antrean ini?")) return;
        b.disabled = true;
        try {
          await call(`/queue/self-service/${encodeURIComponent(b.getAttribute("data-cancel"))}/cancel`, { method: "POST" });
          toast("Antrean dibatalkan");
        } catch (error) { toast(error.message || "Gagal membatalkan."); }
        loadCustomerQueue(); U.refreshDashboard();
      }));
    } catch (error) {
      if (U.isOpen("queue")) body.innerHTML = empty(error.message || "Gagal memuat antrean.");
    }
  }

  function myTicket(t) {
    const called = t.status === "CALLED";
    return `<article class="td-c">
      <div class="td-rq-top"><h2>${esc(t.displayCode)}</h2>${called ? badge("Dipanggil", "m") : badge("Menunggu")}</div>
      ${infoRow("box", `${typeLabel(t.machineType)}${t.position ? ` · posisi ${t.position}` : ""}`)}
      ${called ? infoRow("check", "Giliran Anda — silakan temui staff.", "mu") : ""}
      <div class="td-act"><button type="button" class="d" data-cancel="${esc(t.ticketId)}">Batalkan</button></div>
    </article>`;
  }

  function openCustomerQueue() {
    const body = U.openPage({ key: "queue", title: "Antrean Self-Service" });
    body.innerHTML = loading();
    loadCustomerQueue();
    stopQueueTimer();
    queueTimer = setInterval(() => { if (U.isOpen("queue")) loadCustomerQueue(); else stopQueueTimer(); }, 15000);
  }

  /* ============================================================ *
   * 2. DROP-OFF
   * ============================================================ */
  function openDropoff() {
    return role() === "STAFF" ? openStaffDropoff() : openCustomerDropoff();
  }

  /* ---------- staff ---------- */
  let dropEstimateHours = 24;
  let clockTimer = null;

  function orderStatus(o) {
    if (o.status === "COMPLETED") return badge("Siap diambil", "m");
    return badge("Diproses");
  }

  function staffOrderCard(o) {
    return `<article class="td-c" data-order="${esc(o.order_id)}">
      <div class="td-rq-top"><h2>${esc(o.customer_name || "Tanpa nama")}</h2>${orderStatus(o)}</div>
      ${infoRow("note", `<b>${esc(o.order_id)}</b>`)}
      ${infoRow("phone", `<a href="${phoneHref(o.phone)}">${esc(o.phone || o.phone_masked || "–")}</a>`)}
      ${o.customer_address ? infoRow("pin", esc(o.customer_address)) : ""}
      ${infoRow("scale", `${esc(o.weight_kg)} kg · ${esc(o.item_count || 1)} ${unitLabel(o.item_unit)}`)}
      ${infoRow("cal", `Diterima ${esc(fmtDT(o.received_at))}`)}
      ${infoRow("clock", `Estimasi selesai ${esc(fmtDT(o.est_done_at))}`, "mu")}
      <div class="td-act">
        ${o.status === "RECEIVED" ? `<button type="button" class="p" data-act="complete">${ico("check")}Tandai selesai</button>` : `<button type="button" class="p" data-act="pickup">${ico("check")}Sudah diambil</button>`}
      </div>
    </article>`;
  }

  async function loadStaffOrders() {
    const box = $("tdOrders");
    if (!box || !U.isOpen("dropoff")) return;
    try {
      const data = await call("/staff/dropoff/active");
      const orders = data.orders || [];
      box.innerHTML = orders.length ? orders.map(staffOrderCard).join("") : empty("Belum ada pesanan drop-off aktif.");
      const cnt = $("tdOrdersCount");
      if (cnt) cnt.textContent = String(orders.length);
    } catch (error) {
      box.innerHTML = empty(error.message || "Gagal memuat pesanan.");
    }
  }

  function openStaffDropoff() {
    const body = U.openPage({ key: "dropoff", title: "Drop-off", sticky: true });
    body.innerHTML = `
      <div class="td-form">
        <section class="td-c ca"><h2>Customer</h2><div class="td-fs">
          ${field("dphone", "No. HP", '<input class="td-in" id="td_dphone" type="tel" inputmode="tel" maxlength="20" autocomplete="off" placeholder="08xxxxxxxxxx">')}
          <div class="td-note" id="tdLookupNote">Isi nomor HP; nama &amp; alamat terisi otomatis bila customer sudah terdaftar.</div>
          ${field("dname", "Nama", '<input class="td-in" id="td_dname" type="text" maxlength="60" autocomplete="off">')}
          ${field("daddr", "Alamat", '<textarea class="td-ta s" id="td_daddr" rows="2" maxlength="250"></textarea>', false)}
        </div></section>
        <section class="td-c cc"><h2>Cucian</h2><div class="td-fs">
          <div class="td-g2">
            ${field("dweight", "Berat", '<div class="td-suffix"><input class="td-in" id="td_dweight" type="number" inputmode="decimal" min="0.1" step="0.1" placeholder="0"><span>kg</span></div>')}
            <div class="td-f"><span class="td-lb">Jumlah<span class="td-req-star">*</span></span>
              <div class="td-stp"><button type="button" id="tdDMinus" aria-label="Kurangi">${ico("minus", "td-ico")}</button><output id="tdDCount">1</output><button type="button" id="tdDPlus" aria-label="Tambah">${ico("plus", "td-ico")}</button></div></div>
          </div>
          <div class="td-f"><span class="td-lb">Satuan jumlah<span class="td-req-star">*</span></span>
            <div class="td-seg"><button type="button" data-du="BASKET" aria-pressed="true">Keranjang</button><button type="button" data-du="BAG" aria-pressed="false">Bungkus</button></div></div>
          <div class="td-f"><span class="td-lb">Diterima (otomatis)</span><div class="td-in td-ro" id="tdNow"></div></div>
          ${field("dest", "Estimasi selesai", '<input class="td-in" id="td_dest" type="datetime-local">')}
        </div></section>
        <section class="td-c cb">
          <div class="td-sec-h"><h2>Pesanan aktif</h2>${badge("0", "g").replace("<span", '<span id="tdOrdersCount"')}</div>
          <div class="td-list" id="tdOrders">${loading()}</div>
        </section>
      </div>`;
    U.sticky().innerHTML = '<button type="button" class="td-btn" id="tdDSubmit">Terima Drop-off</button>';

    const f = { count: 1, unit: "BASKET", touchedName: false, touchedAddr: false };
    const nowEl = $("tdNow");
    const tick = () => { if (nowEl) nowEl.textContent = fmtWib(new Date().toISOString()); };
    tick(); clearInterval(clockTimer); clockTimer = setInterval(() => { if (U.isOpen("dropoff")) tick(); else clearInterval(clockTimer); }, 30000);

    const setEst = (hours) => { $("td_dest").value = dtLocalValue(new Date(Date.now() + hours * 3600 * 1000)); };
    setEst(dropEstimateHours);
    call("/program/settings").then((r) => {
      const h = Number(r.settings?.dropoff?.estimateHours);
      if (h >= 1) { dropEstimateHours = h; if (U.isOpen("dropoff")) setEst(h); }
    }).catch(() => {});

    const sync = () => { $("tdDCount").textContent = String(f.count); $("tdDMinus").disabled = f.count <= 1; $("tdDPlus").disabled = f.count >= 99; };
    $("tdDMinus").addEventListener("click", () => { f.count = Math.max(1, f.count - 1); sync(); });
    $("tdDPlus").addEventListener("click", () => { f.count = Math.min(99, f.count + 1); sync(); });
    sync();
    body.querySelectorAll("[data-du]").forEach((b) => b.addEventListener("click", () => {
      f.unit = b.getAttribute("data-du");
      body.querySelectorAll("[data-du]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    $("td_dname").addEventListener("input", () => { f.touchedName = true; setErr(body, "dname", ""); });
    $("td_daddr").addEventListener("input", () => { f.touchedAddr = true; });

    const lookup = debounce(async () => {
      const raw = $("td_dphone").value.trim();
      const note = $("tdLookupNote");
      if (raw.replace(/\D/g, "").length < 9) { note.textContent = "Isi nomor HP; nama & alamat terisi otomatis bila customer sudah terdaftar."; return; }
      try {
        const r = await call(`/staff/customers/lookup?phone=${encodeURIComponent(raw)}`);
        if (!U.isOpen("dropoff")) return;
        if (r.found) {
          if (!f.touchedName || !$("td_dname").value) $("td_dname").value = r.name || "";
          if (!f.touchedAddr || !$("td_daddr").value) $("td_daddr").value = r.address || "";
          note.textContent = r.name ? `Customer terdaftar${r.isMember ? " · member" : ""}. Data bisa diubah.` : "Customer terdaftar tanpa nama. Isi nama.";
        } else {
          note.textContent = "Customer baru — isi nama dan alamat.";
        }
      } catch { note.textContent = ""; }
    }, 350);
    $("td_dphone").addEventListener("input", () => { setErr(body, "dphone", ""); lookup(); });
    $("td_dweight").addEventListener("input", () => setErr(body, "dweight", ""));

    $("tdDSubmit").addEventListener("click", async () => {
      const phone = $("td_dphone").value.trim();
      const name = $("td_dname").value.trim();
      const address = $("td_daddr").value.trim();
      const weight = Number($("td_dweight").value);
      const est = parseDtLocal($("td_dest").value);
      const errs = {};
      if (phone.replace(/\D/g, "").length < 9) errs.dphone = "Nomor HP tidak valid.";
      if (name.length < 2) errs.dname = "Nama wajib diisi.";
      if (!Number.isFinite(weight) || weight <= 0) errs.dweight = "Berat wajib diisi.";
      const hours = est ? (est.getTime() - Date.now()) / 3600000 : NaN;
      if (!est || !(hours >= 1)) errs.dest = "Estimasi minimal 1 jam dari sekarang.";
      ["dphone", "dname", "dweight", "dest"].forEach((k) => setErr(body, k, errs[k] || ""));
      const first = Object.keys(errs)[0];
      if (first) { body.querySelector(`.td-f[data-f="${first}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }

      const btn = $("tdDSubmit");
      btn.disabled = true; btn.textContent = "Menyimpan…";
      try {
        const r = await call("/staff/dropoff/receive", {
          method: "POST",
          body: JSON.stringify({ phone, name, address, weightKg: weight, itemCount: f.count, itemUnit: f.unit, estimateHours: Math.min(720, Math.round(hours * 100) / 100) }),
        });
        toast(`Drop-off diterima${r.order?.order_id ? ` · ${r.order.order_id}` : ""}`);
        ["td_dphone", "td_dname", "td_daddr", "td_dweight"].forEach((id) => { $(id).value = ""; });
        f.count = 1; f.touchedName = false; f.touchedAddr = false; sync(); setEst(dropEstimateHours);
        $("tdLookupNote").textContent = "Isi nomor HP; nama & alamat terisi otomatis bila customer sudah terdaftar.";
        loadStaffOrders(); U.refreshDashboard();
      } catch (error) {
        toast(error.message || "Gagal menyimpan drop-off.");
      } finally {
        btn.disabled = false; btn.textContent = "Terima Drop-off";
      }
    });

    $("tdOrders").addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.closest("[data-order]").getAttribute("data-order");
      const act = btn.getAttribute("data-act");
      if (!window.confirm(act === "complete" ? "Tandai cucian ini selesai dikerjakan?" : "Tandai cucian ini sudah diambil customer?")) return;
      btn.disabled = true;
      try {
        await call(`/staff/dropoff/${encodeURIComponent(id)}/${act}`, { method: "POST" });
        toast(act === "complete" ? "Ditandai selesai" : "Ditandai sudah diambil");
      } catch (error) { toast(error.message || "Aksi gagal."); }
      loadStaffOrders(); U.refreshDashboard();
    });
    loadStaffOrders();
  }

  /* ---------- customer ---------- */
  async function loadCustomerOrders() {
    if (!U.isOpen("dropoff")) return;
    const body = U.body();
    try {
      const data = await call("/dropoff/mine");
      if (!U.isOpen("dropoff")) return;
      const orders = data.orders || (data.order ? [data.order] : []);
      const who = data.customer || {};
      if (!orders.length) { body.innerHTML = empty("Belum ada laundry drop-off aktif."); return; }
      body.innerHTML = `<div class="td-grid">${orders.map((o) => `
        <article class="td-c">
          <div class="td-rq-top"><h2>${esc(o.order_id)}</h2>${orderStatus(o)}</div>
          ${infoRow("cal", `Diterima staff <b>${esc(fmtDT(o.received_at))}</b>`)}
          ${infoRow("clock", `Estimasi selesai <b>${esc(fmtDT(o.est_done_at))}</b>`)}
          ${infoRow("users", esc(who.name || "–"))}
          ${infoRow("phone", esc(who.phone || "–"))}
          ${infoRow("scale", `${esc(o.weight_kg)} kg · ${esc(o.item_count || 1)} ${unitLabel(o.item_unit)} diserahkan`)}
          ${o.status === "COMPLETED" ? infoRow("check", "Cucian selesai — silakan diambil.", "mu") : ""}
        </article>`).join("")}</div>`;
    } catch (error) {
      if (U.isOpen("dropoff")) body.innerHTML = empty(error.message || "Gagal memuat drop-off.");
    }
  }

  function openCustomerDropoff() {
    const body = U.openPage({ key: "dropoff", title: "Drop-off" });
    body.innerHTML = loading();
    loadCustomerOrders();
  }

  /* ============================================================ *
   * 3. MEMBER
   * ============================================================ */
  function openMember() {
    return role() === "STAFF" ? openStaffMembers() : openCustomerMember();
  }

  const statusBadge = (isMember) => (isMember ? badge("Member", "m") : badge("Belum member", "g"));

  /* ---------- staff: daftar ---------- */
  let memberQuery = "";

  async function loadStaffMembers() {
    if (!U.isOpen("members")) return;
    const box = $("tdMTable");
    try {
      const data = await call(`/staff/members?q=${encodeURIComponent(memberQuery)}`);
      if (!U.isOpen("members")) return;
      $("tdMTotC").textContent = String(data.totalCustomers ?? 0);
      $("tdMTotM").textContent = String(data.totalMembers ?? 0);
      const rows = data.customers || [];
      box.innerHTML = rows.length ? `
        <table class="td-tbl"><thead><tr><th>Nama</th><th>No. HP</th><th>Status</th></tr></thead><tbody>
          ${rows.map((c) => `<tr tabindex="0" data-cid="${esc(c.customerId)}"><td>${esc(c.name || "Tanpa nama")}</td><td>${esc(c.phone)}</td><td>${statusBadge(c.isMember)}</td></tr>`).join("")}
        </tbody></table>` : empty("Customer tidak ditemukan.");
      box.querySelectorAll("tr[data-cid]").forEach((tr) => {
        const open = () => openStaffMemberDetail(tr.getAttribute("data-cid"));
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      });
    } catch (error) {
      if (box) box.innerHTML = empty(error.message || "Gagal memuat customer.");
    }
  }

  function openStaffMembers() {
    const body = U.openPage({ key: "members", title: "Member" });
    body.innerHTML = `
      <div class="td-two td-stats">
        <div class="td-c td-stat"><small>Total customer</small><em id="tdMTotC">0</em></div>
        <div class="td-c td-stat"><small>Total member</small><em id="tdMTotM">0</em></div>
      </div>
      <input class="td-in" id="tdMSearch" type="search" placeholder="Cari nama atau nomor HP" value="${esc(memberQuery)}" aria-label="Cari customer">
      <div class="td-c td-tblwrap" id="tdMTable">${loading()}</div>`;
    $("tdMSearch").addEventListener("input", debounce((e) => { memberQuery = e.target.value.trim(); loadStaffMembers(); }, 300));
    loadStaffMembers();
  }

  /* ---------- staff: detail ---------- */
  async function renderStaffMemberDetail(cid) {
    const body = U.body();
    body.innerHTML = loading();
    try {
      const d = await call(`/staff/members/${encodeURIComponent(cid)}`);
      if (!U.isOpen("member-detail")) return;
      const c = d.customer;
      const s = d.settings || {};
      let memberHtml = "";
      if (c.isMember) {
        const p = d.progress || {};
        const avail = d.rewards?.available || [];
        memberHtml = `
          <section class="td-c"><h2>Koin</h2>
            <div class="td-two td-stats">
              <div class="td-stat"><small>Total koin dibeli</small><em>${esc(p.totalCoinsPurchased ?? 0)}</em></div>
              <div class="td-stat"><small>Siklus ke-${esc(p.cycleNumber ?? 1)}</small><em>${esc(p.cycleCoins ?? 0)}/${esc(s.bagAtCoins ?? 40)}</em></div>
            </div>
            <div class="td-bar-prog"><i style="width:${Math.min(100, ((p.cycleCoins ?? 0) / (s.bagAtCoins || 40)) * 100)}%"></i></div>
            <p class="td-note">${esc(p.coinsToNextBonus ?? 0)} koin lagi untuk bonus berikutnya · ${esc(p.coinsToBag ?? 0)} koin lagi untuk laundry bag.</p>
            ${s.enabled ? "" : '<p class="td-note td-warn">Program member sedang dinonaktifkan Owner; pembelian koin tidak dapat dicatat.</p>'}
            <div class="td-fs">
              ${field("coin", "Jumlah koin yang dibeli", '<input class="td-in" id="td_coin" type="number" inputmode="numeric" min="1" step="1" placeholder="0">')}
              <button type="button" class="td-btn" id="tdCoinSave" ${s.enabled ? "" : "disabled"}>Simpan</button>
            </div>
            <p class="td-note">Aturan (diatur Owner): tiap ${esc(s.bonusEveryCoins)} koin → +${esc(s.bonusCoins)} koin bonus; tiap ${esc(s.bagAtCoins)} koin → 1 laundry bag, lalu siklus mulai dari 0.</p>
          </section>
          <section class="td-c"><h2>Reward tersedia</h2>
            <div class="td-list">${avail.length ? avail.map((r) => `
              <div class="td-rw"><span>${r.type === "LAUNDRY_BAG" ? "1 laundry bag" : `${esc(s.bonusCoins ?? 1)} koin bonus`} <small>(${esc(r.milestone)} koin)</small>${r.claimedAt ? ` ${badge("Diklaim", "m")}` : ""}</span>
              <button type="button" class="td-mini-btn" data-fulfill="${esc(r.rewardId)}">Serahkan</button></div>`).join("") : '<div class="td-empty">Belum ada reward.</div>'}</div>
          </section>
          <section class="td-c"><h2>Riwayat pembelian</h2>
            <div class="td-list">${(d.purchases || []).length ? d.purchases.map((x) => `<div class="td-rw"><span>+${esc(x.quantity)} koin</span><small>${esc(fmtDT(x.createdAt))}</small></div>`).join("") : '<div class="td-empty">Belum ada pembelian.</div>'}</div>
          </section>`;
      } else {
        memberHtml = `<section class="td-c"><div class="td-empty">Customer belum menjadi member. Customer bergabung sendiri lewat aplikasi (menu Member).</div></section>`;
      }
      body.innerHTML = `
        <section class="td-c"><div class="td-rq-top"><h2>${esc(c.name || "Tanpa nama")}</h2>${statusBadge(c.isMember)}</div>
          ${infoRow("phone", `<a href="${phoneHref(c.phone)}">${esc(c.phone)}</a>`)}
          ${infoRow("pin", esc(c.address || "Alamat belum diisi"), c.address ? "" : "mu")}
          ${infoRow("star", `Total koin: <b>${esc(c.totalCoins)}</b>`)}
        </section>${memberHtml}`;

      $("tdCoinSave")?.addEventListener("click", async () => {
        const q = Number($("td_coin").value);
        if (!Number.isInteger(q) || q < 1) { setErr(body, "coin", "Isi jumlah koin (angka bulat ≥ 1)."); return; }
        setErr(body, "coin", "");
        const btn = $("tdCoinSave"); btn.disabled = true;
        try {
          const r = await call("/staff/member/purchase", { method: "POST", body: JSON.stringify({ phone: c.phone, quantity: q, purchaseId: uuid() }) });
          const n = (r.newRewards || []).length;
          toast(n ? `Tersimpan · ${n} reward baru` : "Koin tersimpan");
          renderStaffMemberDetail(cid);
        } catch (error) { toast(error.message || "Gagal menyimpan koin."); btn.disabled = false; }
      });
      body.querySelectorAll("[data-fulfill]").forEach((b) => b.addEventListener("click", async () => {
        if (!window.confirm("Serahkan reward ini ke customer?")) return;
        b.disabled = true;
        try {
          await call(`/staff/member/reward/${encodeURIComponent(b.getAttribute("data-fulfill"))}/fulfill`, { method: "POST" });
          toast("Reward diserahkan");
        } catch (error) { toast(error.message || "Gagal."); }
        renderStaffMemberDetail(cid);
      }));
    } catch (error) {
      if (U.isOpen("member-detail")) body.innerHTML = empty(error.message || "Gagal memuat detail.");
    }
  }

  function openStaffMemberDetail(cid) {
    U.openPage({ key: "member-detail", title: "Detail Customer", onBack: () => openStaffMembers() });
    renderStaffMemberDetail(cid);
  }

  /* ---------- customer ---------- */
  async function renderCustomerMember() {
    const body = U.body();
    body.innerHTML = loading();
    try {
      const d = await call("/member/me");
      if (!U.isOpen("member")) return;
      const s = d.settings || {};
      if (!d.isMember) {
        body.innerHTML = empty("Anda belum menjadi member.");
        return;
      }
      const p = d.progress || {};
      const avail = d.rewards?.available || [];
      const hist = d.rewards?.history || [];
      const target = s.bagAtCoins || 40;
      const reminder = s.enabled
        ? `Beli ${p.coinsToNextBonus} koin lagi untuk mendapat ${s.bonusCoins} koin bonus, dan ${p.coinsToBag} koin lagi untuk 1 laundry bag cantik.`
        : "Program member sedang tidak aktif.";
      body.innerHTML = `
        <section class="td-c"><h2>Koin saya</h2>
          <div class="td-two td-stats">
            <div class="td-stat"><small>Total koin dibeli</small><em>${esc(p.totalCoinsPurchased ?? 0)}</em></div>
            <div class="td-stat"><small>Siklus ke-${esc(p.cycleNumber ?? 1)}</small><em>${esc(p.cycleCoins ?? 0)}/${esc(target)}</em></div>
          </div>
          <div class="td-bar-prog"><i style="width:${Math.min(100, ((p.cycleCoins ?? 0) / target) * 100)}%"></i></div>
          <p class="td-note td-remind">${esc(reminder)}</p>
        </section>
        <section class="td-c"><h2>Reward bonus saya</h2>
          <div class="td-list">${avail.length ? avail.map((r) => `
            <div class="td-rw"><span>${r.type === "LAUNDRY_BAG" ? "1 laundry bag" : `${esc(s.bonusCoins ?? 1)} koin bonus`} <small>(dari ${esc(r.milestone)} koin)</small></span>
            ${r.claimedAt ? badge("Menunggu diserahkan", "m") : `<button type="button" class="td-mini-btn" data-claim="${esc(r.rewardId)}">Klaim</button>`}</div>`).join("") : '<div class="td-empty">Belum ada reward. Terus kumpulkan koin!</div>'}
          </div>
        </section>
        <section class="td-c"><h2>Riwayat transaksi koin</h2>
          <div class="td-list">${(d.purchases || []).length ? d.purchases.map((x) => `<div class="td-rw"><span>+${esc(x.quantity)} koin</span><small>${esc(fmtDT(x.createdAt))}</small></div>`).join("") : '<div class="td-empty">Belum ada pembelian koin.</div>'}</div>
        </section>
        ${hist.length ? `<section class="td-c"><h2>Reward diterima</h2><div class="td-list">${hist.map((r) => `<div class="td-rw"><span>${r.type === "LAUNDRY_BAG" ? "1 laundry bag" : `${esc(s.bonusCoins ?? 1)} koin bonus`}</span><small>${esc(fmtDT(r.fulfilledAt))}</small></div>`).join("")}</div></section>` : ""}`;
      body.querySelectorAll("[data-claim]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await call(`/member/rewards/${encodeURIComponent(b.getAttribute("data-claim"))}/claim`, { method: "POST" });
          toast("Klaim diajukan. Tunjukkan ke staff.");
        } catch (error) { toast(error.message || "Gagal klaim."); }
        renderCustomerMember();
      }));
    } catch (error) {
      if (U.isOpen("member")) body.innerHTML = empty(error.message || "Gagal memuat member.");
    }
  }

  function showJoinPrompt(settings) {
    let el = $("tdJoin");
    if (el) el.remove();
    el = document.createElement("div");
    el.id = "tdJoin";
    el.className = "td-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "tdJoinT");
    const every = settings?.bonusEveryCoins ?? 10;
    const bonus = settings?.bonusCoins ?? 1;
    const bag = settings?.bagAtCoins ?? 40;
    el.innerHTML = `<div class="td-modal-card">
      <h2 id="tdJoinT">Reward Member</h2>
      <p>Dapatkan reward bonus ${esc(bonus)} koin setiap pembelian ${esc(every)} koin, dan dapatkan reward bonus 1 laundry bag cantik untuk pembelian ${esc(bag)} koin.</p>
      <div class="td-act"><button type="button" id="tdJoinNo">Tidak</button><button type="button" class="p" id="tdJoinYes">Join</button></div>
    </div>`;
    document.body.appendChild(el);
    $("tdJoinNo").addEventListener("click", () => el.remove());
    $("tdJoinYes").addEventListener("click", async () => {
      const b = $("tdJoinYes"); b.disabled = true;
      try {
        await call("/member/join", { method: "POST" });
        el.remove();
        toast("Selamat bergabung sebagai member");
        openCustomerMemberPage();
      } catch (error) { toast(error.message || "Gagal bergabung."); b.disabled = false; }
    });
    $("tdJoinYes").focus();
  }

  function openCustomerMemberPage() {
    U.openPage({ key: "member", title: "Member" });
    renderCustomerMember();
  }

  async function openCustomerMember() {
    try {
      const d = await call("/member/me");
      if (d.isMember) return openCustomerMemberPage();
      if (d.settings && d.settings.enabled === false) { toast("Program member sedang tidak aktif."); return; }
      showJoinPrompt(d.settings);
    } catch (error) { toast(error.message || "Gagal memuat member."); }
  }

  /* ============================================================ *
   * 4. NOTIFIKASI ANTREAN (dashboard customer)
   * ============================================================ */
  const SEEN_KEY = "td_seen_notices";
  const seen = () => { try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } };
  const markSeen = (id) => { try { const s = seen(); s.add(id); sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-30))); } catch { /* abaikan */ } };

  function showNotice(id, title, text) {
    if (seen().has(id) || $("tdNotice")) return;
    const el = document.createElement("div");
    el.id = "tdNotice";
    el.className = "td-notice";
    el.setAttribute("role", "alert");
    el.innerHTML = `<div class="td-ib">${ico("check")}</div><div class="td-txt"><b>${esc(title)}</b><small>${esc(text)}</small></div><button type="button" aria-label="Tutup">×</button>`;
    document.body.appendChild(el);
    const close = () => { markSeen(id); el.remove(); };
    el.querySelector("button").addEventListener("click", close);
    setTimeout(() => { if (el.isConnected) close(); }, 20000);
  }

  function machineText(type, machineId) {
    return machineId ? `${typeLabel(type)} ${machineId}` : typeLabel(type);
  }

  async function pollCustomerNotices() {
    if (role() !== "CUSTOMER" || !$("tdDash") || $("tdDash").hidden) return;
    try {
      const mine = await call("/queue/self-service/mine");
      for (const t of mine.recentActivated || []) {
        showNotice(`act-${t.ticketId}`, "Mesin diaktifkan staff", `Antrean ${t.displayCode}: mesin ${machineText(t.machineType, t.activatedMachineId)} sudah aktif. Silakan menuju mesin.`);
      }
      for (const t of mine.tickets || []) {
        if (t.status === "CALLED") showNotice(`call-${t.ticketId}`, "Giliran Anda", `Antrean ${t.displayCode} (${typeLabel(t.machineType)}) dipanggil. Silakan temui staff.`);
      }
    } catch { /* abaikan */ }
  }

  function onRealtime(message) {
    if (!message || typeof message !== "object") return;
    const t = message.type;
    const p = message.payload || {};
    if (t === "SELF_SERVICE_TICKET_ACTIVATED" || t === "SELF_SERVICE_TICKET_CALLED") {
      if (role() === "CUSTOMER") pollCustomerNotices();
    }
    if (t === "SELF_SERVICE_QUEUE_UPDATED") {
      if (U.isOpen("queue")) (role() === "STAFF" ? loadStaffQueue : loadCustomerQueue)();
      U.refreshDashboard();
    }
    if (t === "DROPOFF_ORDER_UPDATED") {
      if (U.isOpen("dropoff")) (role() === "STAFF" ? loadStaffOrders : loadCustomerOrders)();
      U.refreshDashboard();
    }
    if (t === "MEMBER_PROGRESS_UPDATED" || t === "MEMBER_REWARD_FULFILLED") {
      if (U.isOpen("members")) loadStaffMembers();
      if (U.isOpen("member")) renderCustomerMember();
      void p;
    }
  }

  function installRealtime() {
    const orig = window.handleRealtimeMessage;
    if (typeof orig !== "function" || orig.__tdPages) return;
    const w = function (...args) {
      try { onRealtime(args[0]); } catch { /* abaikan */ }
      return orig.apply(this, args);
    };
    w.__tdPages = true;
    window.handleRealtimeMessage = w;
  }

  /* ============================================================ *
   * 5. OWNER — Program Member & Drop-off (hanya Owner)
   * ============================================================ */
  function installOwnerProgram() {
    const nav = document.querySelector(".owner-tabbar");
    const ownerSection = $("owner");
    if (!nav || !ownerSection || $("tdOwnerProgramBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tdOwnerProgramBtn";
    btn.innerHTML = '<span class="owner-nav-icon" data-owner-icon="reward"></span><span>Program</span>';
    nav.appendChild(btn);

    const view = document.createElement("section");
    view.id = "tdOwnerProgram";
    view.className = "td-owner-prog";
    view.hidden = true;
    view.innerHTML = `
      <div class="td-c"><h2>Program Member</h2>
        <p class="td-note">Hanya Owner yang dapat membuat dan mengaktifkan / menonaktifkan program. Staff hanya mencatat pembelian koin; customer hanya melihat dan klaim.</p>
        <div class="td-fs">
          <label class="td-sw"><input type="checkbox" id="tdPEnabled"> <span>Program member aktif</span></label>
          ${field("pevery", "Kelipatan koin untuk bonus", '<input class="td-in" id="td_pevery" type="number" min="1" step="1">')}
          ${field("pbonus", "Jumlah koin bonus", '<input class="td-in" id="td_pbonus" type="number" min="1" step="1">')}
          ${field("pbag", "Target koin untuk 1 laundry bag (lalu siklus mulai ulang)", '<input class="td-in" id="td_pbag" type="number" min="1" step="1">')}
        </div>
      </div>
      <div class="td-c"><h2>Drop-off</h2>
        <div class="td-fs">${field("phours", "Estimasi pengerjaan (jam)", '<input class="td-in" id="td_phours" type="number" min="1" max="720" step="1">')}</div>
      </div>
      <div class="td-c"><button type="button" class="td-btn" id="tdPSave" style="position:static">Simpan pengaturan</button><p class="td-note" id="tdPMsg" aria-live="polite"></p></div>`;
    ownerSection.appendChild(view);

    const hideAllOwnerViews = () => {
      try {
        Object.values(typeof ownerViews === "function" ? ownerViews() : {}).forEach((e) => { if (e && e !== view) e.hidden = true; });
      } catch { /* abaikan */ }
      document.querySelectorAll("[data-owner-view]").forEach((b) => b.classList.remove("active"));
    };
    async function load() {
      try {
        const r = await call("/owner/program-settings");
        const m = r.settings.member, d = r.settings.dropoff;
        $("tdPEnabled").checked = m.enabled;
        $("td_pevery").value = m.bonusEveryCoins; $("td_pbonus").value = m.bonusCoins; $("td_pbag").value = m.bagAtCoins;
        $("td_phours").value = d.estimateHours;
        $("tdPMsg").textContent = "";
      } catch (error) { $("tdPMsg").textContent = error.message || "Gagal memuat."; }
    }
    btn.addEventListener("click", () => {
      hideAllOwnerViews();
      btn.classList.add("active");
      view.hidden = false;
      load();
    });
    document.querySelectorAll("[data-owner-view]").forEach((b) => b.addEventListener("click", () => { view.hidden = true; btn.classList.remove("active"); }));

    $("tdPSave").addEventListener("click", async () => {
      const payload = {
        member: { enabled: $("tdPEnabled").checked, bonusEveryCoins: Number($("td_pevery").value), bonusCoins: Number($("td_pbonus").value), bagAtCoins: Number($("td_pbag").value) },
        dropoff: { estimateHours: Number($("td_phours").value) },
      };
      const b = $("tdPSave"); b.disabled = true;
      try {
        await call("/owner/program-settings", { method: "PUT", body: JSON.stringify(payload) });
        $("tdPMsg").textContent = "Pengaturan tersimpan.";
      } catch (error) { $("tdPMsg").textContent = error.message || "Gagal menyimpan."; }
      b.disabled = false;
    });
  }

  /* ------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------ */
  let noticeTimer = null;
  function onDashboard(r) {
    if (r !== "CUSTOMER") return;
    setTimeout(pollCustomerNotices, 400);
    if (!noticeTimer) noticeTimer = setInterval(pollCustomerNotices, 20000);
  }

  function start() {
    installRealtime();
    installOwnerProgram();
    const ownerWatch = new MutationObserver(() => installOwnerProgram());
    if ($("owner")) ownerWatch.observe($("owner"), { attributes: true, attributeFilter: ["hidden"] });
  }

  window.TdPages = { openQueue, openDropoff, openMember, onDashboard };
  if ($("tdDash") && role()) onDashboard(role());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
