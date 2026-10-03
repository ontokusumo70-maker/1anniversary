/* ==========================================================================
   TERAS LAUNDRY — Standar UI v1.0
   Layar login:
   - Customer (/customer): kartu NAMA + NOMOR HP di atas background
     customer-bg-clean.png. Nomor belum terdaftar -> otomatis daftar.
   - Staff (/staff): kartu nomor HP di atas background staff-bg-clean.png.
   Juga: pemulihan sesi customer saat halaman dimuat ulang, dan logout
   customer yang benar-benar kembali ke layar login.
   Dimuat SETELAH delivery.js dan td-pages.js.
   ========================================================================== */
(() => {
  "use strict";
  if (window.__tdAuth) return;
  window.__tdAuth = true;

  const $ = (id) => document.getElementById(id);
  const AUTH_KEY = "td_customer_auth";
  const LEGACY_IDENTITY_KEY = "teras_customer_identity";
  const routeName = () => (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();

  /* ------------------------------------------------------------ *
   * Penyimpanan identitas customer (nama + nomor HP)
   * ------------------------------------------------------------ */
  const readAuth = () => {
    try {
      const v = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return v && v.phone && v.name ? v : null;
    } catch { return null; }
  };
  const writeAuth = (v) => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(v)); } catch { /* abaikan */ } };
  const clearAuth = () => {
    try { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(LEGACY_IDENTITY_KEY); } catch { /* abaikan */ }
  };

  /* Logout: identitas dihapus SEBELUM handler lama berjalan (fase capture).
     Tanpa ini aplikasi langsung memulihkan sesi dan customer "tidak bisa logout". */
  document.addEventListener("click", (event) => {
    const hit = event.target.closest && event.target.closest("#customerLogout, #tdLogout");
    if (hit && (window.TdUi?.role?.() === "CUSTOMER" || routeName() === "customer")) clearAuth();
  }, true);

  /* ------------------------------------------------------------ *
   * Layer login (memakai kanvas yang sama dengan dashboard)
   * ------------------------------------------------------------ */
  let layer = null;
  let layerKind = "";
  let busy = false;

  function build(kind) {
    const isC = kind === "CUSTOMER";
    const el = document.createElement("div");
    el.id = "tdAuth";
    el.className = `td-dash td-auth ${isC ? "td-d-customer" : "td-d-staff"}`;
    el.innerHTML = `
      <div class="td-d-wrap"><div class="td-canvas">
        ${isC ? '<img class="td-logo" src="/assets/branding/branding.png" alt="Teras Laundry">' : ""}
        <div class="td-flow">
          <section class="td-card td-pad" aria-labelledby="tdAuthT">
            <h2 id="tdAuthT">${isC ? "Masuk / Daftar" : "Login Staff"}</h2>
            <p class="td-note" id="tdAuthHint">${isC ? "Isi nama dan nomor HP. Bila belum terdaftar, akun dibuat otomatis." : "Masukkan nomor HP Staff."}</p>
            <div class="td-fs" id="tdAuthForm">
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

  function show(kind, { loading = false } = {}) {
    if (layer && layerKind !== kind) { layer.remove(); layer = null; }
    if (!layer || !layer.isConnected) { layer = build(kind); layerKind = kind; }
    if (layer.hidden) layer.hidden = false;
    const form = $("tdAuthForm");
    if (form && form.hidden !== loading) form.hidden = loading;
    const hint = $("tdAuthHint");
    if (hint) hint.textContent = loading ? "Memuat…" : (kind === "CUSTOMER"
      ? "Isi nama dan nomor HP. Bila belum terdaftar, akun dibuat otomatis."
      : "Masukkan nomor HP Staff.");
    document.documentElement.classList.add("td-dash-on");
  }

  function hide() {
    if (layer && !layer.hidden) layer.hidden = true;
    if (!$("tdDash") || $("tdDash").hidden) document.documentElement.classList.remove("td-dash-on");
  }

  const setMsg = (t) => { const m = $("tdAuthMsg"); if (m && m.textContent !== (t || "")) m.textContent = t || ""; };
  const setBusy = (b, label) => { const g = $("tdAuthGo"); if (g) { g.disabled = b; g.textContent = b ? "Memproses…" : label; } };

  function applySession(data) {
    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt = data.expiresAt || null;
    saveSession();
  }

  /* ------------------------------------------------------------ *
   * Customer
   * ------------------------------------------------------------ */
  async function customerLogin(name, phone) {
    const data = await api("/auth/customer-access", { method: "POST", body: JSON.stringify({ name, phone }) });
    if (data.role !== "CUSTOMER" || !data.token || data.guest) throw new Error("Data customer tidak valid.");
    applySession(data);
    writeAuth({ name: data.name || name, phone, userId: data.userId });
    return data;
  }

  async function submitCustomer() {
    if (busy) return;
    const name = ($("tdAuthName")?.value || "").trim().replace(/\s+/g, " ");
    const phone = ($("tdAuthPhone")?.value || "").trim();
    if (name.length < 2) return setMsg("Nama wajib diisi (minimal 2 karakter).");
    if (phone.replace(/\D/g, "").length < 8) return setMsg("Nomor HP tidak valid.");
    setMsg(""); busy = true; setBusy(true);
    try {
      await customerLogin(name, phone);
      verified = true;
      hide();
      showRole();
    } catch (error) {
      setMsg(error.message || "Tidak dapat masuk.");
    } finally {
      busy = false; setBusy(false, "Masuk / Daftar");
    }
  }

  /* Pemulihan sesi: identitas tersimpan + sesi aplikasi masih milik customer itu. */
  let verified = false;
  let restoring = false;

  async function ensureCustomer() {
    if (restoring) return;
    const a = readAuth();
    if (!a) { verified = false; show("CUSTOMER"); return; }
    if (verified) { hide(); return; }

    restoring = true;
    show("CUSTOMER", { loading: true });
    try {
      const sameUser = state.token && state.role === "CUSTOMER" && state.userId === a.userId;
      if (sameUser) {
        await api("/member/me"); // sesi masih berlaku?
      } else {
        await customerLogin(a.name, a.phone);
        showRole();
      }
      verified = true;
      hide();
    } catch {
      try {
        await customerLogin(a.name, a.phone); // sesi kedaluwarsa -> masuk ulang otomatis
        verified = true;
        showRole();
        hide();
      } catch {
        clearAuth(); verified = false; show("CUSTOMER");
      }
    } finally {
      restoring = false;
    }
  }

  /* ------------------------------------------------------------ *
   * Staff
   * ------------------------------------------------------------ */
  async function submitStaff() {
    if (busy) return;
    const phone = ($("tdAuthPhone")?.value || "").trim();
    if (!phone) return setMsg("Nomor Staff wajib diisi.");
    setMsg(""); busy = true; setBusy(true);
    try {
      const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ phone }) });
      if (data.role !== "STAFF") throw new Error("Akses Staff tidak valid.");
      applySession(data);
      hide();
      showRole();
    } catch (error) {
      setMsg(error.message || "Login gagal.");
    } finally {
      busy = false; setBusy(false, "Login");
    }
  }

  /* ------------------------------------------------------------ *
   * Kapan layer tampil
   * ------------------------------------------------------------ */
  function sync() {
    const r = routeName();
    if (r === "customer") { ensureCustomer(); return; }
    if (r === "staff") {
      const legacy = $("staffAuth");
      if (legacy && !legacy.hidden) show("STAFF"); else hide();
      return;
    }
    hide();
  }

  function start() {
    sync();
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("pageshow", sync);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.TdAuth = { sync, clearAuth };
})();
