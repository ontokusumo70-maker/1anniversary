/* ==========================================================================
   TERAS LAUNDRY — Standar UI v1.0
   Layar login:
   - Customer (/customer): NAMA + NOMOR HP di atas customer-bg-clean.png.
       Customer lama  -> langsung masuk ke dashboard.
       Customer baru  -> muncul notifikasi "Daftar"; setelah diklik, akun dibuat
                         dan customer masuk ke dashboard.
   - Staff (/staff): nomor HP Staff di atas staff-bg-clean.png.
   Juga: pemulihan sesi customer saat halaman dimuat ulang, dan logout customer
   yang benar-benar kembali ke layar login.
   Dimuat SETELAH delivery.js dan td-pages.js.
   ========================================================================== */
(() => {
  "use strict";
  if (window.__tdAuth) return;
  window.__tdAuth = true;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const AUTH_KEY = "td_customer_auth";
  const routeName = () => (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();

  /* ------------------------------------------------------------ *
   * Profil customer yang tersimpan (nama + nomor HP)
   * ------------------------------------------------------------ */
  const readProfile = () => {
    try {
      const v = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return v && v.phone && v.name ? v : null;
    } catch { return null; }
  };
  const writeProfile = (v) => {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(v)); } catch { /* abaikan */ }
    window.TdUi?.setProfile?.(v);
  };
  const clearProfile = () => {
    try { localStorage.removeItem(AUTH_KEY); } catch { /* abaikan */ }
  };

  /* Logout: profil dihapus SEBELUM handler lama berjalan (fase capture); tanpa ini
     aplikasi langsung memulihkan sesi dan customer "tidak bisa logout". */
  document.addEventListener("click", (event) => {
    const hit = event.target.closest && event.target.closest("#customerLogout, #tdLogout");
    if (hit && (window.TdUi?.role?.() === "CUSTOMER" || routeName() === "customer")) clearProfile();
  }, true);

  /* ------------------------------------------------------------ *
   * Layer login (kanvas yang sama dengan dashboard)
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
            <h2 id="tdAuthT">${isC ? "Masuk" : "Login Staff"}</h2>
            <p class="td-note" id="tdAuthHint">${isC ? "Isi nama dan nomor HP Anda." : "Masukkan nomor HP Staff."}</p>
            <div class="td-fs" id="tdAuthForm">
              ${isC ? `<div class="td-f"><label for="tdAuthName">Nama<span class="td-req-star">*</span></label>
                <input class="td-in" id="tdAuthName" type="text" maxlength="60" autocomplete="name" placeholder="Nama lengkap"></div>` : ""}
              <div class="td-f"><label for="tdAuthPhone">No. HP<span class="td-req-star">*</span></label>
                <input class="td-in" id="tdAuthPhone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="08xxxxxxxxxx"></div>
              <p class="td-note td-err" id="tdAuthMsg" role="alert" aria-live="polite"></p>
              <button type="button" class="td-btn" id="tdAuthGo" style="position:static">${isC ? "Masuk" : "Login"}</button>
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
    const text = loading ? "Memuat…" : (kind === "CUSTOMER" ? "Isi nama dan nomor HP Anda." : "Masukkan nomor HP Staff.");
    if (hint && hint.textContent !== text) hint.textContent = text;
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
  const accessCustomer = (name, phone, register = false) =>
    api("/auth/customer-access", { method: "POST", body: JSON.stringify(register ? { name, phone, register: true } : { name, phone }) });

  function finishCustomerLogin(data, name, phone) {
    if (data.role !== "CUSTOMER" || !data.token) throw new Error("Data customer tidak valid.");
    applySession(data);
    writeProfile({ name: data.name || name, phone: data.phone || phone, userId: data.userId });
    verified = true;
    hide();
    showRole();
  }

  /* Notifikasi: nomor belum terdaftar -> tombol Daftar membuat akun lalu masuk. */
  function askRegister(name, phone) {
    $("tdRegister")?.remove();
    const el = document.createElement("div");
    el.id = "tdRegister";
    el.className = "td-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "tdRegisterT");
    el.innerHTML = `<div class="td-modal-card">
      <h2 id="tdRegisterT">Nomor belum terdaftar</h2>
      <p>Nomor <b>${esc(phone)}</b> belum terdaftar. Klik <b>Daftar</b> untuk membuat akun atas nama <b>${esc(name)}</b> dan langsung masuk.</p>
      <p class="td-note td-err" id="tdRegisterMsg" role="alert"></p>
      <div class="td-act"><button type="button" id="tdRegisterNo">Batal</button><button type="button" class="p" id="tdRegisterYes">Daftar</button></div>
    </div>`;
    document.body.appendChild(el);
    $("tdRegisterNo").addEventListener("click", () => el.remove());
    $("tdRegisterYes").addEventListener("click", async () => {
      const yes = $("tdRegisterYes");
      yes.disabled = true;
      try {
        const data = await accessCustomer(name, phone, true);
        el.remove();
        finishCustomerLogin(data, name, phone);
      } catch (error) {
        $("tdRegisterMsg").textContent = error.message || "Gagal mendaftar.";
        yes.disabled = false;
      }
    });
    $("tdRegisterYes").focus();
  }

  async function submitCustomer() {
    if (busy) return;
    const name = ($("tdAuthName")?.value || "").trim().replace(/\s+/g, " ");
    const phone = ($("tdAuthPhone")?.value || "").trim();
    if (name.length < 2) return setMsg("Nama wajib diisi (minimal 2 karakter).");
    if (phone.replace(/\D/g, "").length < 8) return setMsg("Nomor HP tidak valid.");
    setMsg(""); busy = true; setBusy(true);
    try {
      const data = await accessCustomer(name, phone);
      if (data.needsRegister) askRegister(name, phone);
      else finishCustomerLogin(data, name, phone);
    } catch (error) {
      setMsg(error.message || "Tidak dapat masuk.");
    } finally {
      busy = false; setBusy(false, "Masuk");
    }
  }

  /* Pemulihan sesi: profil tersimpan + sesi aplikasi masih milik customer itu. */
  let verified = false;
  let restoring = false;

  async function ensureCustomer() {
    if (restoring) return;
    const profile = readProfile();
    if (!profile) { verified = false; show("CUSTOMER"); return; }
    if (verified) { hide(); return; }

    restoring = true;
    show("CUSTOMER", { loading: true });
    try {
      const sameUser = state.token && state.role === "CUSTOMER" && state.userId === profile.userId;
      let ok = false;
      if (sameUser) {
        try { await api("/member/me"); ok = true; } catch { ok = false; }
      }
      if (ok) {
        verified = true;
        window.TdUi?.setProfile?.(profile);
        hide();
      } else {
        const data = await accessCustomer(profile.name, profile.phone); // masuk ulang otomatis
        if (data.needsRegister) throw new Error("Akun tidak ditemukan.");
        finishCustomerLogin(data, profile.name, profile.phone);
      }
    } catch {
      clearProfile(); verified = false; show("CUSTOMER");
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
  window.TdAuth = { sync, profile: readProfile };
})();
