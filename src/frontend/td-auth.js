/* ==========================================================================
   TERAS LAUNDRY — Standar UI v1.0
   Layar login Customer (nama + nomor HP, otomatis daftar bila baru) dan
   Staff, memakai background customer-bg-clean.png / staff-bg-clean.png.
   Juga memperbaiki logout customer (identitas tersimpan membuat customer
   langsung masuk kembali ke dashboard).
   Dimuat SETELAH delivery.js dan td-pages.js.
   ========================================================================== */
(() => {
  "use strict";
  if (window.__tdAuth) return;
  window.__tdAuth = true;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const AUTH_KEY = "td_customer_auth";
  const LEGACY_IDENTITY_KEY = "teras_customer_identity";
  const route = () => (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();

  const readAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; } };
  const writeAuth = (v) => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(v)); } catch { /* abaikan */ } };
  const clearAuth = () => {
    try { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(LEGACY_IDENTITY_KEY); } catch { /* abaikan */ }
  };

  /* Logout: hapus identitas tersimpan SEBELUM handler lama berjalan (fase capture). */
  document.addEventListener("click", (event) => {
    if (event.target.closest && event.target.closest("#customerLogout, #tdLogout")) {
      if (window.TdUi?.role?.() === "CUSTOMER" || route() === "customer") clearAuth();
    }
  }, true);

  const ICON = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  };
  const ico = (n) => `<svg class="td-ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

  let layer = null;
  let layerKind = "";

  function build(kind) {
    const isC = kind === "CUSTOMER";
    const el = document.createElement("div");
    el.id = "tdAuth";
    el.dataset.kind = kind;
    el.className = `td-dash td-auth ${isC ? "td-d-customer" : "td-d-staff"}`;
    el.innerHTML = `
      <div class="td-d-wrap"><div class="td-canvas">
        ${isC ? '<img class="td-logo" src="/assets/branding/branding.png" alt="Teras Laundry">' : ""}
        <div class="td-flow">
          <section class="td-card td-pad" aria-labelledby="tdAuthT">
            <h2 id="tdAuthT">${isC ? "Masuk / Daftar" : "Login Staff"}</h2>
            <p class="td-note">${isC ? "Isi nama dan nomor HP. Bila belum terdaftar, akun dibuat otomatis." : "Masukkan nomor HP Staff."}</p>
            <div class="td-fs">
              ${isC ? `<div class="td-f"><label for="tdAuthName">Nama<span class="td-req-star">*</span></label>
                <input class="td-in" id="tdAuthName" type="text" maxlength="60" autocomplete="name" placeholder="Nama lengkap"></div>` : ""}
              <div class="td-f"><label for="tdAuthPhone">No. HP<span class="td-req-star">*</span></label>
                <input class="td-in" id="tdAuthPhone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="08xxxxxxxxxx"></div>
              <p class="td-note td-err" id="tdAuthMsg" role="alert" aria-live="polite"></p>
              <button type="button" class="td-btn" id="tdAuthGo" style="position:static">${isC ? "Masuk / Daftar" : "Login"}</button>
            </div>
          </section>
        </div>
      </div></div>`;
    document.body.appendChild(el);

    const go = isC ? submitCustomer : submitStaff;
    $("tdAuthGo").addEventListener("click", go);
    el.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }));
    return el;
  }

  function show(kind) {
    if (layer && layerKind !== kind) { layer.remove(); layer = null; }
    if (!layer || !layer.isConnected) { layer = build(kind); layerKind = kind; }
    if (layer.hidden) layer.hidden = false;
    document.documentElement.classList.add("td-dash-on");
  }

  function hide() {
    if (layer && !layer.hidden) layer.hidden = true;
    if (!$("tdDash") || $("tdDash").hidden) document.documentElement.classList.remove("td-dash-on");
  }

  const setMsg = (t) => { const m = $("tdAuthMsg"); if (m) m.textContent = t || ""; };
  const setBusy = (b, label) => { const g = $("tdAuthGo"); if (g) { g.disabled = b; g.textContent = b ? "Memproses…" : label; } };

  async function submitCustomer() {
    const name = ($("tdAuthName")?.value || "").trim().replace(/\s+/g, " ");
    const phone = ($("tdAuthPhone")?.value || "").trim();
    if (name.length < 2) return setMsg("Nama wajib diisi (minimal 2 karakter).");
    if (phone.replace(/\D/g, "").length < 8) return setMsg("Nomor HP tidak valid.");
    setMsg(""); setBusy(true);
    try {
      const data = await api("/auth/customer-access", { method: "POST", body: JSON.stringify({ name, phone }) });
      if (data.role !== "CUSTOMER" || !data.token || data.guest) throw new Error("Data customer tidak valid.");
      state.token = data.token;
      state.role = data.role;
      state.userId = data.userId;
      state.expiresAt = data.expiresAt || null;
      saveSession();
      writeAuth({ phone, name: data.name || name, userId: data.userId });
      hide();
      showRole();
      try { await refreshCustomerDashboardMachines(); } catch { /* abaikan */ }
    } catch (error) {
      setMsg(error.message || "Tidak dapat masuk.");
    } finally {
      setBusy(false, "Masuk / Daftar");
    }
  }

  async function submitStaff() {
    const phone = ($("tdAuthPhone")?.value || "").trim();
    if (!phone) return setMsg("Nomor Staff wajib diisi.");
    setMsg(""); setBusy(true);
    try {
      const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ phone }) });
      if (data.role !== "STAFF") throw new Error("Akses Staff tidak valid.");
      state.token = data.token;
      state.role = data.role;
      state.userId = data.userId;
      state.expiresAt = data.expiresAt || null;
      saveSession();
      hide();
      showRole();
    } catch (error) {
      setMsg(error.message || "Login gagal.");
    } finally {
      setBusy(false, "Login");
    }
  }

  /* ------------------------------------------------------------ *
   * Kapan layer login tampil
   * ------------------------------------------------------------ */
  let customerVerified = false;
  let customerChecking = false;

  async function verifyCustomer() {
    if (customerChecking || customerVerified) return;
    customerChecking = true;
    try {
      await api("/member/me");
      customerVerified = true;
    } catch {
      clearAuth();
      customerVerified = false;
    }
    customerChecking = false;
    sync();
  }

  function sync() {
    const r = route();
    if (r === "customer") {
      const a = readAuth();
      if (!a || !a.userId) { show("CUSTOMER"); return; }
      if (!customerVerified) { verifyCustomer(); return; }
      hide();
      return;
    }
    if (r === "staff") {
      const sa = $("staffAuth");
      if (sa && !sa.hidden) show("STAFF"); else hide();
      return;
    }
    hide();
  }

  function start() {
    sync();
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    setTimeout(sync, 800);
    window.addEventListener("pageshow", sync);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.TdAuth = { sync, clearAuth };
})();
