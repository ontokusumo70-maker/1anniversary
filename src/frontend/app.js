const state = {
  token: null,
  role: null,
  userId: null,
  playId: null,
  sessionId: null,
  rewardId: null,
};

const SESSION_KEY = "teras_laundry_auth_session";

const LOGIN_ROUTES = {
  OWNER: "/owner",
  STAFF: "/staff",
  CUSTOMER: "/customer",
};

const ROLE_ROUTES = {
  OWNER: "/owner/role owner",
  STAFF: "/staff/role staff",
  CUSTOMER: "/customer/role customer",
};

const $ = (id) => document.getElementById(id);
const msg = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

let apiBase =
  "https://1anniversary.ontokusumo70.workers.dev";

let assetBasePath = "/assets/";

const ownerActiveEventObjectUrls = new Map();

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(
    `${apiBase}${path}`,
    {
      ...options,
      headers,
      cache: "no-store",
    },
  );

  const data = await response
    .json()
    .catch(() => ({
      ok: false,
      error: "INVALID_RESPONSE",
    }));

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `HTTP ${response.status}`,
    );
  }

  return data;
}

async function apiBlob(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }
  return response.blob();
}

function saveSession() {
  if (!state.token || !state.role) {
    return;
  }

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: state.token,
      role: state.role,
      userId: state.userId,
      expiresAt: state.expiresAt || null,
    }),
  );
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);

  state.token = null;
  state.role = null;
  state.userId = null;
  state.expiresAt = null;
}

function restoreSession() {
  try {
    const raw =
      localStorage.getItem(
        SESSION_KEY,
      );

    if (!raw) {
      return false;
    }

    const saved = JSON.parse(raw);

    if (
      !saved ||
      !saved.token ||
      !saved.role
    ) {
      clearSession();
      return false;
    }

    if (
      saved.expiresAt &&
      Date.now() >=
        new Date(
          saved.expiresAt,
        ).getTime()
    ) {
      clearSession();
      return false;
    }

    state.token = saved.token;
    state.role = saved.role;
    state.userId = saved.userId || null;
    state.expiresAt =
      saved.expiresAt || null;

    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function loadConfig() {
  try {
    const config =
      await api("/config");

    if (
      config?.assets?.basePath
    ) {
      assetBasePath =
        config.assets.basePath;

      if ($("brand")) {
        $("brand").src =
          `${assetBasePath}branding/branding.png`;
      }

      document.documentElement.style.setProperty(
        "--game-bg",
        `url("${assetBasePath}background/game/game-bg.PNG")`,
      );

      document.documentElement.style.setProperty(
        "--owner-bg",
        `url("${assetBasePath}background/owner/owner-bg.PNG")`,
      );

      if (coinImage) {
        coinImage.src =
          `${assetBasePath}coin/coin_1st_front.png`;
      }
    }
  } catch {
    // Keep production defaults.
  }
}

function revokeActiveEventImage(role) {
  const url = activeEventObjectUrls.get(role);
  if (url) URL.revokeObjectURL(url);
  activeEventObjectUrls.delete(role);
}

function renderRoleActiveEvent(role, data) {
  const prefix = role === "STAFF" ? "staff" : "customer";
  const card = $(`${prefix}ActiveEvent`);
  if (!card) return;
  revokeActiveEventImage(role);
  if (!data?.active || !data.event) {
    card.hidden = true;
    return;
  }
  const event = data.event;
  $(`${prefix}ActiveEventTitle`).textContent = event.title || "—";
  $(`${prefix}ActiveEventPeriod`).textContent = formatDateRange(event.startsAt, event.endsAt);
  const description = $(`${prefix}ActiveEventDescription`);
  if (description) {
    description.textContent = event.description || "";
    description.hidden = !event.description;
  }
  const image = $(`${prefix}ActiveEventImage`);
  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
  }
  card.hidden = false;
  if (image && event.imageUrl) {
    apiBlob(event.imageUrl).then((blob) => {
      if (card.hidden) return;
      const objectUrl = URL.createObjectURL(blob);
      activeEventObjectUrls.set(role, objectUrl);
      image.src = objectUrl;
      image.hidden = false;
    }).catch(() => {});
  }
}

async function loadActiveEventForRole(role) {
  try {
    const data = await api("/event/active");
    if (role === "STAFF") {
      staffActiveEventData = data;
      renderRoleActiveEvent(role, data);
      renderStaffDashboardEvent(data);
    } else if (role === "CUSTOMER") {
      renderCustomerDashboardEvent(data);
    }
  } catch {
    if (role === "STAFF") {
      renderRoleActiveEvent(role, null);
      renderStaffDashboardEvent(null);
    } else if (role === "CUSTOMER") {
      renderCustomerDashboardEvent(null);
    }
  }
}

let staffDashboardClockTimer = null;

function renderStaffDashboardDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).formatToParts(now);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday");
  const update = $("staffDashboardUpdate");

  if (update) {
    update.textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
  }
}

function showStaffDashboard() {
  if ($("staffDashboard")) {
    $("staffDashboard").hidden = false;
  }
  if ($("staffTools")) {
    $("staffTools").hidden = true;
  }

  renderStaffDashboardDate();

  if (staffDashboardClockTimer) {
    window.clearInterval(staffDashboardClockTimer);
  }

  staffDashboardClockTimer = window.setInterval(() => {
    if (state.role === "STAFF" && $("staffDashboard") && !$("staffDashboard").hidden) {
      renderStaffDashboardDate();
    }
  }, 1000);
}

let customerDashboardClockTimer = null;

function renderCustomerDashboardDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("id-ID", {
    weekday: "long", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const update = $("customerDashboardUpdate");
  if (update) {
    const weekday = get("weekday");
    update.textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
  }
}

function showCustomerDashboard() {
  if ($("customerDashboard")) $("customerDashboard").hidden = false;
  renderCustomerDashboardDate();
  if (customerDashboardClockTimer) window.clearInterval(customerDashboardClockTimer);
  customerDashboardClockTimer = window.setInterval(() => {
    if (state.role === "CUSTOMER" && $("customerDashboard") && !$("customerDashboard").hidden) {
      renderCustomerDashboardDate();
    }
  }, 1000);
}

function renderCustomerDashboardMachineSummary(machines) {
  const list = Array.isArray(machines) ? machines : [];
  const washer = list.filter((machine) => machine?.type === "WASHER");
  const dryer = list.filter((machine) => machine?.type === "DRYER");
  const count = (items, status) => items.filter((machine) => machine?.status === status).length;
  const set = (id, value) => { const element = $(id); if (element) element.textContent = String(value); };
  set("customerWasherTotal", washer.length || 5);
  set("customerWasherIdle", count(washer, "IDLE"));
  set("customerWasherBusy", count(washer, "IN_USE"));
  set("customerDryerTotal", dryer.length || 5);
  set("customerDryerIdle", count(dryer, "IDLE"));
  set("customerDryerBusy", count(dryer, "IN_USE"));
}

async function refreshCustomerDashboardMachines() {
  try {
    const data = await api("/machines");
    customerMachineData = Array.isArray(data.machines) ? data.machines : [];
    renderCustomerDashboardMachineSummary(customerMachineData);
  } catch {
    renderCustomerDashboardMachineSummary([]);
  }
}

let customerMachineData = [];
let customerMachineFilter = "ALL";
let customerMachineStatusTimer = null;
let customerEventInfoImageObjectUrl = null;
let customerActiveEventData = null;

function renderCustomerDashboardEvent(data) {
  const title = $("customerDashboardEventTitle");
  const period = $("customerDashboardEventPeriod");
  if (!title || !period) return;
  customerActiveEventData = data || null;
  if (!data?.active || !data.event) {
    title.textContent = "Belum ada event";
    period.textContent = "—";
    return;
  }
  title.textContent = data.event.title || "Event Aktif";
  period.textContent = formatDateRange(data.event.startsAt, data.event.endsAt);
}

function renderStaffDashboardMachineSummary() {
  const machines = Array.isArray(staffMachineData) ? staffMachineData : [];
  const washer = machines.filter((machine) => machine?.type === "WASHER");
  const dryer = machines.filter((machine) => machine?.type === "DRYER");
  const count = (items, status) => items.filter((machine) => machine?.status === status).length;

  const set = (id, value) => {
    const element = $(id);
    if (element) element.textContent = String(value);
  };

  set("staffWasherTotal", washer.length || 5);
  set("staffWasherIdle", count(washer, "IDLE"));
  set("staffWasherBusy", count(washer, "IN_USE"));
  set("staffDryerTotal", dryer.length || 5);
  set("staffDryerIdle", count(dryer, "IDLE"));
  set("staffDryerBusy", count(dryer, "IN_USE"));
}

function renderStaffDashboardEvent(data) {
  const title = $("staffDashboardEventTitle");
  const period = $("staffDashboardEventPeriod");
  if (!title || !period) return;
  if (!data?.active || !data.event) {
    title.textContent = "Belum ada event";
    period.textContent = "—";
    return;
  }
  title.textContent = data.event.title || "Event Aktif";
  period.textContent = formatDateRange(data.event.startsAt, data.event.endsAt);
}

function normalizePathname(rawPath = window.location.pathname || "/") {
  let decodedPath = rawPath || "/";

  for (let i = 0; i < 3; i += 1) {
    try {
      const nextPath = decodeURIComponent(decodedPath);
      if (nextPath === decodedPath) break;
      decodedPath = nextPath;
    } catch {
      break;
    }
  }

  return decodedPath.replace(/\/+$/, "") || "/";
}

function resolveRolePath(rawPath = window.location.pathname || "/") {
  const pathname = normalizePathname(rawPath);
  const segments = pathname.split("/").filter(Boolean);
  const root = (segments[0] || "").toLowerCase();

  if (root === "owner") return "OWNER";
  if (root === "staff") return "STAFF";
  if (root === "customer") return "CUSTOMER";
  return null;
}

function setRoleRoute(role) {
  const route = ROLE_ROUTES[role];
  if (!route) return;
  document.documentElement.dataset.initialRoute = `${role}_ROLE`;
  if (normalizePathname() !== route) {
    window.history.replaceState({ role }, "", route);
  }
  window.scrollTo(0, 0);
}

const CUSTOMER_IDENTITY_KEY = "teras_customer_identity";

function saveCustomerIdentity(identity) {
  try {
    localStorage.setItem(CUSTOMER_IDENTITY_KEY, JSON.stringify(identity));
  } catch {}
}

function loadCustomerIdentity() {
  try {
    const raw = localStorage.getItem(CUSTOMER_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.phone || !value?.email) return null;
    return value;
  } catch {
    return null;
  }
}

function clearCustomerIdentity() {
  try { localStorage.removeItem(CUSTOMER_IDENTITY_KEY); } catch {}
}

function openCustomerIdentityPopup() {
  const modal = $("customerIdentityModal");
  if (!modal || !modal.hidden) return;
  const identity = loadCustomerIdentity();
  if ($("customerIdentityPhone")) $("customerIdentityPhone").value = identity?.phone || "";
  if ($("customerIdentityEmail")) $("customerIdentityEmail").value = identity?.email || "";
  if ($("customerIdentityMsg")) $("customerIdentityMsg").textContent = "";
  modal.hidden = false;
}

function closeCustomerIdentityPopup() {
  const modal = $("customerIdentityModal");
  if (modal) modal.hidden = true;
}

async function createCustomerGuestSession() {
  const data = await api("/auth/customer-access", { method: "POST" });
  if (data.role !== "CUSTOMER" || !data.token) throw new Error("Customer session tidak valid.");
  state.token = data.token;
  state.role = data.role;
  state.userId = data.userId;
  state.expiresAt = data.expiresAt || null;
  saveSession();
  return data;
}

async function restoreCustomerIdentitySession(identity) {
  const data = await api("/auth/customer-access", {
    method: "POST",
    body: JSON.stringify({ phone: identity.phone, email: identity.email }),
  });
  if (data.role !== "CUSTOMER" || !data.token || data.guest) {
    throw new Error("Customer session tidak valid.");
  }
  state.token = data.token;
  state.role = data.role;
  state.userId = data.userId;
  state.expiresAt = data.expiresAt || null;
  saveSession();
  return data;
}

async function submitCustomerIdentity() {
  const phone = $("customerIdentityPhone")?.value.trim() || "";
  const email = $("customerIdentityEmail")?.value.trim() || "";
  const button = $("customerIdentitySubmit");

  if (!phone || !email) return;
  if (button) button.disabled = true;

  try {
    const data = await api("/auth/customer-access", {
      method: "POST",
      body: JSON.stringify({ phone, email }),
    });

    if (data.role !== "CUSTOMER" || !data.token || data.guest) {
      throw new Error("Customer session tidak valid.");
    }

    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt = data.expiresAt || null;
    saveSession();
    saveCustomerIdentity({ phone, email, userId: data.userId });
    closeCustomerIdentityPopup();
  } catch (error) {
    const message = $("customerIdentityMsg");
    if (message) message.textContent = error.message || "Data tidak dapat diproses.";
  } finally {
    if (button) button.disabled = false;
  }
}

function showRootLanding() {
  if ($("rootLanding")) $("rootLanding").hidden = false;
  if ($("ownerAuth")) $("ownerAuth").hidden = true;
  if ($("staffAuth")) $("staffAuth").hidden = true;
  if ($("auth")) $("auth").hidden = true;
  if ($("customer")) $("customer").hidden = true;
  if ($("staff")) $("staff").hidden = true;
  if ($("owner")) $("owner").hidden = true;
  document.body.dataset.role = "ROOT";
  document.documentElement.dataset.initialRoute = "ROOT";
  window.scrollTo(0, 0);
}

const CUSTOMER_VIEW_KEY = "teras_customer_view";

function saveCustomerView(view) {
  try {
    sessionStorage.setItem(CUSTOMER_VIEW_KEY, view);
  } catch {}
}

function getCustomerView() {
  try {
    return sessionStorage.getItem(CUSTOMER_VIEW_KEY) || "DASHBOARD";
  } catch {
    return "DASHBOARD";
  }
}

function clearCustomerView() {
  try {
    sessionStorage.removeItem(CUSTOMER_VIEW_KEY);
  } catch {}
}

function restoreCustomerView() {
  const view = getCustomerView();
  if (view === "STATUS") {
    openCustomerMachineStatus();
  } else if (view === "SERVICES") {
    openCustomerServices();
  } else if (view === "EVENT") {
    openCustomerEvent();
  } else {
    saveCustomerView("DASHBOARD");
  }
}

function showRole() {
  if ($("rootLanding")) {
    $("rootLanding").hidden = true;
  }
  document.body.dataset.role = state.role || "CUSTOMER";
  if ($("ownerAuth")) {
    $("ownerAuth").hidden = true;
  }
  if ($("staffAuth")) {
    $("staffAuth").hidden = true;
  }
  if ($("staffAuth")) {
    $("staffAuth").hidden = true;
  }
  if ($("auth")) {
    $("auth").hidden = true;
  }

  if ($("customer")) {
    $("customer").hidden = true;
  }

  if ($("staff")) {
    $("staff").hidden = true;
  }

  if ($("owner")) {
    $("owner").hidden = true;
  }

  if (state.role === "CUSTOMER") {
    setRoleRoute("CUSTOMER");
    $("customer").hidden = false;
    showCustomerDashboard();
    refreshCustomerDashboardMachines();
    loadActiveEventForRole("CUSTOMER");
    restoreCustomerView();
    if (state.userId?.startsWith("guest_")) {
      openCustomerIdentityPopup();
    }
    return;
  }

  if (state.role === "STAFF") {
    setRoleRoute("STAFF");
    document.documentElement.style.setProperty("--game-bg", `url("${assetBasePath}background/game/game-bg.PNG")`);
    $("staff").hidden = false;
    showStaffDashboard();
    refreshStaffMachines();
    loadActiveEventForRole("STAFF");
    return;
  }

  if (state.role === "OWNER") {
    setRoleRoute("OWNER");
    document.documentElement.style.setProperty("--game-bg", `url("${assetBasePath}background/owner/owner-bg.PNG")`);
    $("owner").hidden = false;
    loadOwner();
  }
}

function showOwnerLogin(clearMessage = true) {
  if ($("ownerAuth")) {
    $("ownerAuth").hidden = false;
  }
  if ($("auth")) {
    $("auth").hidden = true;
  }
  if ($("customer")) {
    $("customer").hidden = true;
  }
  if ($("staff")) {
    $("staff").hidden = true;
  }
  if ($("owner")) {
    $("owner").hidden = true;
  }
  document.body.dataset.role = "OWNER_LOGIN";
  document.documentElement.style.setProperty(
    "--owner-bg",
    `url("${assetBasePath}background/owner/owner-bg.PNG")`,
  );
  if (clearMessage) {
    msg("ownerAuthMsg", "");
  }
}

async function loginOwner() {
  try {
    const phone = $("ownerPhone")?.value.trim() || "";

    if (!phone) {
      msg("ownerAuthMsg", "Nomor Owner wajib diisi.");
      return;
    }

    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    if (data.role !== "OWNER") {
      throw new Error("Akses Owner tidak valid.");
    }

    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt = data.expiresAt || null;

    saveSession();
    msg("ownerAuthMsg", "");
    showRole();
  } catch (error) {
    msg("ownerAuthMsg", error.message);
  }
}

function showStaffLogin(clearMessage = true) {
  if ($("ownerAuth")) {
    $("ownerAuth").hidden = true;
  }
  if ($("staffAuth")) {
    $("staffAuth").hidden = false;
  }
  if ($("auth")) {
    $("auth").hidden = true;
  }
  if ($("customer")) {
    $("customer").hidden = true;
  }
  if ($("staff")) {
    $("staff").hidden = true;
  }
  if ($("owner")) {
    $("owner").hidden = true;
  }
  document.body.dataset.role = "STAFF_LOGIN";
  document.documentElement.style.setProperty(
    "--staff-bg",
    `url("${assetBasePath}background/staff/staff-bg.PNG")`,
  );
  if (clearMessage) {
    msg("staffAuthMsg", "");
  }
}

async function loginStaffStandalone() {
  try {
    const phone = $("staffPhone")?.value.trim() || "";

    if (!phone) {
      msg("staffAuthMsg", "Nomor Staff wajib diisi.");
      return;
    }

    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });

    if (data.role !== "STAFF") {
      throw new Error("Akses Staff tidak valid.");
    }

    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt = data.expiresAt || null;

    saveSession();
    msg("staffAuthMsg", "");
    showRole();
  } catch (error) {
    msg("staffAuthMsg", error.message);
  }
}

if ($("ownerLogin")) {
  $("ownerLogin").onclick = loginOwner;
}

if ($("ownerPhone")) {
  $("ownerPhone").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loginOwner();
    }
  });
}

if ($("staffLoginStandalone")) {
  $("staffLoginStandalone").onclick = loginStaffStandalone;
}

if ($("staffPhone")) {
  $("staffPhone").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loginStaffStandalone();
    }
  });
}

let raf = 0;
let score = 0;
let coins = [];
let gameTimer = null;

const canvas = $("game");
const ctx =
  canvas?.getContext("2d");

const coinImage = new Image();

coinImage.src =
  "/assets/coin/coin_1st_front.png";

function spawn() {
  if (!canvas) {
    return;
  }

  coins.push({
    x:
      18 +
      Math.random() *
        (canvas.width - 36),
    y:
      42 +
      Math.random() *
        (canvas.height - 60),
    r: 18,
  });
}

function draw() {
  if (!canvas || !ctx) {
    return;
  }

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  for (const coin of coins) {
    if (
      coinImage.complete &&
      coinImage.naturalWidth
    ) {
      ctx.drawImage(
        coinImage,
        coin.x - coin.r,
        coin.y - coin.r,
        coin.r * 2,
        coin.r * 2,
      );
    } else {
      ctx.beginPath();
      ctx.arc(
        coin.x,
        coin.y,
        coin.r,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#e5b72b";
      ctx.fill();
    }
  }

  raf =
    requestAnimationFrame(draw);
}

function hit(x, y) {
  for (
    let i = coins.length - 1;
    i >= 0;
    i--
  ) {
    const coin = coins[i];

    if (
      Math.hypot(
        x - coin.x,
        y - coin.y,
      ) <=
      coin.r + 18
    ) {
      coins.splice(i, 1);
      score += 10;

      if ($("score")) {
        $("score").textContent =
          score;
      }

      spawn();
      break;
    }
  }
}

if (canvas) {
  canvas.onpointerdown =
    (event) => {
      const rect =
        canvas.getBoundingClientRect();

      hit(
        (event.clientX -
          rect.left) *
          (canvas.width /
            rect.width),
        (event.clientY -
          rect.top) *
          (canvas.height /
            rect.height),
      );
    };
}

async function finish() {
  clearInterval(gameTimer);
  cancelAnimationFrame(raf);

  if ($("gameBox")) {
    $("gameBox").hidden = true;
  }

  try {
    const data =
      await api(
        "/finish",
        {
          method: "POST",
          body: JSON.stringify({
            playId:
              state.playId,
            sessionId:
              state.sessionId,
            result: {
              score,
            },
            idempotencyKey:
              crypto.randomUUID(),
          }),
        },
      );

    state.rewardId =
      data.rewardId;

    msg(
      "gameMsg",
      "Kamu menang. Klaim reward.",
    );

    if (!$("claimButton")) {
      const button =
        document.createElement(
          "button",
        );

      button.id =
        "claimButton";

      button.textContent =
        "Klaim Reward";

      button.onclick =
        claim;

      $("gameMsg").after(
        button,
      );
    }
  } catch (error) {
    msg(
      "gameMsg",
      error.message,
    );
  }
}

async function start() {
  try {
    const transactionId =
      $("transactionId")
        .value.trim();

    if (!transactionId) {
      msg(
        "gameMsg",
        "ID transaksi wajib diisi.",
      );
      return;
    }

    score = 0;
    coins = [];

    spawn();

    $("gameMsg").textContent =
      "";

    $("rewardBox").hidden =
      true;

    state.playId = null;

    const data =
      await api(
        "/start",
        {
          method: "POST",
          body: JSON.stringify({
            transactionId,
            idempotencyKey:
              crypto.randomUUID(),
          }),
        },
      );

    state.playId =
      data.playId;

    state.sessionId =
      data.sessionId;

    $("gameBox").hidden =
      false;

    $("score").textContent =
      "0";

    $("time").textContent =
      "15";

    const end =
      Date.now() + 15000;

    clearInterval(gameTimer);

    gameTimer =
      setInterval(() => {
        const left =
          Math.max(
            0,
            Math.ceil(
              (end -
                Date.now()) /
                1000,
            ),
          );

        $("time").textContent =
          left;

        if (left <= 0) {
          finish();
        }
      }, 200);

    cancelAnimationFrame(
      raf,
    );

    draw();
  } catch (error) {
    msg(
      "gameMsg",
      error.message,
    );
  }
}

async function claim() {
  try {
    const data =
      await api(
        "/claim",
        {
          method: "POST",
          body: JSON.stringify({
            rewardId:
              state.rewardId,
            idempotencyKey:
              crypto.randomUUID(),
          }),
        },
      );

    $("rewardBox").hidden =
      false;

    $("rewardType").textContent =
      `Reward: ${data.rewardType}`;

    $("token").textContent =
      data.tokenRef;

    $("qr").innerHTML =
      makeQrSvg(
        data.tokenRef,
      );

    $("claimButton")?.remove();
  } catch (error) {
    msg(
      "gameMsg",
      error.message,
    );
  }
}

if ($("startGame")) {
  $("startGame").onclick =
    start;
}

function renderMachines(
  target,
  machines,
  staff = false,
) {
  if (!target) return;
  target.innerHTML = "";
  for (const machine of machines) {
    const card = document.createElement("div");
    card.className = "machine";
    const title = document.createElement("b");
    title.textContent = `${machine.type === "WASHER" ? "Wash" : "Dry"} ${machine.machineNumber}`;
    const status = document.createElement("span");
    status.textContent = machine.statusLabel + (machine.remainingSeconds ? ` • ${Math.ceil(machine.remainingSeconds / 60)} mnt` : "");
    status.className = machine.status === "IN_USE" ? "busy" : "idle";
    card.append(title, status);
    if (staff && machine.status === "IDLE") {
      const button = document.createElement("button");
      button.textContent = "Aktifkan";
      button.onclick = () => activateMachine(machine.machineId);
      card.append(button);
    }
    target.append(card);
  }
}

let staffMachineData = [];
let staffMachineFilter = "ALL";
let staffMachineStatusTimer = null;
let staffMachineActivationBusy = false;
let staffSelectedMachine = null;

function formatStaffMachineElapsed(machine) {
  if (!machine?.startedAt || machine.status !== "IN_USE") return "00:00 mnt";
  const startedMs = Date.parse(machine.startedAt);
  if (!Number.isFinite(startedMs)) return "00:00 mnt";
  const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} mnt`;
}

function formatStaffWibDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday");
  return {
    date: `${weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : ""}, ${get("day")} ${get("month")} ${get("year")}`,
    time: `${get("hour")}:${get("minute")} WIB`,
  };
}

function staffMachineTypeLabel(machine) {
  return machine?.type === "DRYER" ? "Dryer" : "Washer";
}

function renderStaffMachineStatusList() {
  const target = $("staffMachineStatusList");
  if (!target) return;
  const filtered = staffMachineData.filter((machine) => staffMachineFilter === "ALL" || machine.type === staffMachineFilter);
  target.innerHTML = "";
  for (const machine of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `staff-machine-status-row ${machine.status === "IN_USE" ? "is-busy" : "is-idle"}`;
    const icon = document.createElement("span");
    icon.className = "staff-machine-row-icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M8 7h1M11 7h1"/></svg>`;
    const id = document.createElement("strong");
    id.textContent = `${machine.type === "WASHER" ? "W" : "D"}${machine.machineNumber}`;
    const type = document.createElement("span");
    type.className = "staff-machine-row-type";
    type.textContent = staffMachineTypeLabel(machine);
    const status = document.createElement("span");
    status.className = `staff-machine-row-status ${machine.status === "IN_USE" ? "busy" : "idle"}`;
    status.textContent = machine.status === "IN_USE" ? "Terpakai" : "Idle";
    const time = document.createElement("span");
    time.className = "staff-machine-row-time";
    time.textContent = formatStaffMachineElapsed(machine);
    const arrow = document.createElement("span");
    arrow.className = "staff-machine-row-arrow";
    arrow.textContent = "›";
    row.append(icon, id, type, status, time, arrow);
    row.onclick = () => { if (machine.status === "IDLE") openStaffMachineActivation(machine); };
    target.append(row);
  }
}

function updateStaffMachineRealtime() {
  renderStaffMachineStatusList();
  renderStaffMachineStatusMeta();
}

function updateStaffMachineFilterButtons() {
  document.querySelectorAll("#staffMachineFilters [data-staff-machine-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.staffMachineFilter === staffMachineFilter);
  });
}

function renderStaffMachineStatusMeta() {
  const dateEl = $("staffMachineStatusDate");
  const timeEl = $("staffMachineStatusTime");
  if (!dateEl || !timeEl) return;
  const value = formatStaffWibDateTime();
  dateEl.textContent = value.date;
  timeEl.textContent = value.time;
}

function stopStaffMachineStatusTimer() {
  if (staffMachineStatusTimer) {
    window.clearInterval(staffMachineStatusTimer);
    staffMachineStatusTimer = null;
  }
}

function startStaffMachineStatusTimer() {
  stopStaffMachineStatusTimer();
  staffMachineStatusTimer = window.setInterval(() => {
    if (state.role === "STAFF" && $("staffMachineStatusView") && !$("staffMachineStatusView").hidden) {
      updateStaffMachineRealtime();
    }
  }, 1000);
}


function scrollCustomerTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const tools = $("customerTools");
  if (tools) tools.scrollTop = 0;
}

function openCustomerMachineDetail(machine) {
  if (!machine) return;
  const modal = $("customerMachineDetailModal");
  if (!modal) return;
  const id = `${machine.type === "WASHER" ? "W" : "D"}${machine.machineNumber}`;
  const type = staffMachineTypeLabel(machine);
  const status = machine.status === "IN_USE" ? "Terpakai" : "Idle";
  const duration = Number(machine.durationMinutes || (machine.type === "DRYER" ? 50 : 32));
  const time = formatStaffMachineElapsed(machine);
  $("customerMachineDetailTitle").textContent = id;
  $("customerMachineDetailMachineId").textContent = "";
  $("customerMachineDetailType").textContent = type;
  $("customerMachineDetailStatus").textContent = status;
  $("customerMachineDetailDuration").textContent = `${duration} menit`;
  $("customerMachineDetailTime").textContent = time;
  modal.hidden = false;
  document.body.classList.add("customer-machine-detail-open");
  scrollCustomerTop();
}

function closeCustomerMachineDetail() {
  const modal = $("customerMachineDetailModal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("customer-machine-detail-open");
}

function renderCustomerMachineStatusList() {
  const target = $("customerMachineStatusList");
  if (!target) return;
  const filtered = customerMachineData.filter((machine) => customerMachineFilter === "ALL" || machine.type === customerMachineFilter);
  target.innerHTML = "";
  for (const machine of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `staff-machine-status-row ${machine.status === "IN_USE" ? "is-busy" : "is-idle"}`;
    const icon = document.createElement("span");
    icon.className = "staff-machine-row-icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M8 7h1M11 7h1"/></svg>`;
    const id = document.createElement("strong");
    id.textContent = `${machine.type === "WASHER" ? "W" : "D"}${machine.machineNumber}`;
    const type = document.createElement("span");
    type.className = "staff-machine-row-type";
    type.textContent = staffMachineTypeLabel(machine);
    const status = document.createElement("span");
    status.className = `staff-machine-row-status ${machine.status === "IN_USE" ? "busy" : "idle"}`;
    status.textContent = machine.status === "IN_USE" ? "Terpakai" : "Idle";
    const time = document.createElement("span");
    time.className = "staff-machine-row-time";
    time.textContent = formatStaffMachineElapsed(machine);
    const arrow = document.createElement("span");
    arrow.className = "staff-machine-row-arrow";
    arrow.textContent = "›";
    row.append(icon, id, type, status, time, arrow);
    row.onclick = () => openCustomerMachineDetail(machine);
    target.append(row);
  }
}

function renderCustomerMachineStatusMeta() {
  const dateEl = $("customerMachineStatusDate");
  const timeEl = $("customerMachineStatusTime");
  if (!dateEl || !timeEl) return;
  const value = formatStaffWibDateTime();
  dateEl.textContent = value.date;
  timeEl.textContent = value.time;
}

function stopCustomerMachineStatusTimer() {
  if (customerMachineStatusTimer) {
    window.clearInterval(customerMachineStatusTimer);
    customerMachineStatusTimer = null;
  }
}

function startCustomerMachineStatusTimer() {
  stopCustomerMachineStatusTimer();
  customerMachineStatusTimer = window.setInterval(() => {
    if (state.role === "CUSTOMER" && $("customerMachineStatusView") && !$("customerMachineStatusView").hidden) {
      renderCustomerMachineStatusList();
      renderCustomerMachineStatusMeta();
    }
  }, 1000);
}

async function openCustomerMachineStatus() {
  saveCustomerView("STATUS");
  closeCustomerMachineDetail();
  if ($("customer")) {
    $("customer").hidden = false;
  }
  document.body.dataset.role = "CUSTOMER";
  if (normalizePathname() !== ROLE_ROUTES.CUSTOMER) {
    window.history.replaceState({ role: "CUSTOMER" }, "", ROLE_ROUTES.CUSTOMER);
  }
  scrollCustomerTop();
  if ($("customerDashboard")) $("customerDashboard").hidden = true;
  if ($("customerTools")) $("customerTools").hidden = false;
  if ($("customerMachineStatusView")) $("customerMachineStatusView").hidden = false;
  if ($("customerServicesView")) $("customerServicesView").hidden = true;
  if ($("customerEventView")) $("customerEventView").hidden = true;
  renderCustomerMachineStatusMeta();
  renderCustomerMachineStatusList();
  await refreshCustomerDashboardMachines();
  renderCustomerMachineStatusList();
  startCustomerMachineStatusTimer();
  requestAnimationFrame(scrollCustomerTop);
}

function closeCustomerMachineStatus() {
  saveCustomerView("DASHBOARD");
  closeCustomerMachineDetail();
  stopCustomerMachineStatusTimer();
  if ($("customerMachineStatusView")) $("customerMachineStatusView").hidden = true;
  if ($("customerTools")) $("customerTools").hidden = true;
  showCustomerDashboard();
  scrollCustomerTop();
}

function openCustomerServices() {
  saveCustomerView("SERVICES");
  scrollCustomerTop();
  closeCustomerMachineDetail();
  if ($("customerDashboard")) $("customerDashboard").hidden = true;
  if ($("customerTools")) $("customerTools").hidden = false;
  if ($("customerMachineStatusView")) $("customerMachineStatusView").hidden = true;
  if ($("customerServicesView")) $("customerServicesView").hidden = false;
  if ($("customerEventView")) $("customerEventView").hidden = true;
  stopCustomerMachineStatusTimer();
  requestAnimationFrame(scrollCustomerTop);
}

function closeCustomerServices() {
  saveCustomerView("DASHBOARD");
  if ($("customerServicesView")) $("customerServicesView").hidden = true;
  showCustomerDashboard();
}

function revokeCustomerEventInfoImage() {
  if (customerEventInfoImageObjectUrl) {
    URL.revokeObjectURL(customerEventInfoImageObjectUrl);
    customerEventInfoImageObjectUrl = null;
  }
}

function renderCustomerEventRewards(event) {
  const target = $("customerEventRewards");
  if (!target) return;

  const rewards = Array.isArray(event?.rewards) && event.rewards.length
    ? event.rewards
    : (event?.rewardType ? [{
        rewardType: event.rewardType,
        rewardQuantity: event.rewardQuantity,
        remaining: event.rewardRemaining ?? event.remaining,
        terms: event.rewardTerms || event.terms || "—",
      }] : []);

  target.innerHTML = rewards.length ? rewards.map((reward) => {
    const name = escapeHtml(reward.rewardType || reward.name || "—");
    const quantity = Number(reward.remaining ?? reward.rewardQuantity ?? reward.quantity ?? 0);
    return `<section class="staff-event-detail-card staff-event-reward-card">
      <span class="staff-event-detail-icon staff-event-gift-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M9 19h30v23H9z"/><path d="M24 19v23"/><path d="M7 12h34v8H7z"/><path d="M24 12c-1-6-5-9-9-8-4 1-4 6 0 8h9Z"/><path d="M24 12c1-6 5-9 9-8 4 1 4 6 0 8h-9Z"/></svg></span>
      <div class="staff-event-reward-copy">
        <div class="staff-event-reward-top"><h3>Reward</h3><span>Stok Tersedia</span></div>
        <p>${name}</p>
        <strong>${Number.isFinite(quantity) ? quantity.toLocaleString("id-ID") : "0"}</strong>
      </div>
    </section>`;
  }).join("") : `<section class="staff-event-detail-card staff-event-reward-card">
    <span class="staff-event-detail-icon staff-event-gift-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M9 19h30v23H9z"/><path d="M24 19v23"/><path d="M7 12h34v8H7z"/><path d="M24 12c-1-6-5-9-9-8-4 1-4 6 0 8h9Z"/><path d="M24 12c1-6 5-9 9-8 4 1 4 6 0 8h-9Z"/></svg></span>
    <div class="staff-event-reward-copy"><div class="staff-event-reward-top"><h3>Reward</h3><span>Stok Tersedia</span></div><p>—</p><strong>0</strong></div>
  </section>`;
}

function renderCustomerEventInfo(data) {
  const image = $("customerEventInfoImage");
  const title = $("customerEventInfoTitle");
  const period = $("customerEventInfoPeriod");
  const periodText = $("customerEventPeriodText");
  const description = $("customerEventInfoDescription");
  const terms = $("customerEventInfoTerms");
  revokeCustomerEventInfoImage();
  if (!data?.active || !data.event) {
    if (image) image.hidden = true;
    if (title) { title.textContent = "Belum ada event"; title.classList.add("empty-state"); }
    if (periodText) periodText.textContent = "—";
    if (description) description.textContent = "Belum ada event aktif.";
    if (terms) terms.textContent = "—";
    renderCustomerEventRewards(null);
    return;
  }
  const event = data.event;
  if (title) { title.textContent = event.title || "Event Aktif"; title.classList.remove("empty-state"); }
  if (periodText) periodText.textContent = formatDateRange(event.startsAt, event.endsAt);
  if (description) description.textContent = event.description || "—";
  if (terms) {
    const rewards = Array.isArray(event.rewards) && event.rewards.length
      ? event.rewards
      : (event.rewardType ? [event] : []);
    const termsList = rewards.map((reward) => reward.rewardTerms || reward.terms).filter(Boolean);
    terms.innerHTML = termsList.length > 1
      ? `<ol>${termsList.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
      : escapeHtml(termsList[0] || "—");
  }
  renderCustomerEventRewards(event);
  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
    if (event.imageUrl) {
      apiBlob(event.imageUrl).then((blob) => {
        if (!$("customerEventView") || $("customerEventView").hidden) return;
        customerEventInfoImageObjectUrl = URL.createObjectURL(blob);
        image.src = customerEventInfoImageObjectUrl;
        image.hidden = false;
      }).catch(() => {});
    }
  }
}

function openCustomerEvent() {
  saveCustomerView("EVENT");
  scrollCustomerTop();
  closeCustomerMachineDetail();
  if ($("customerDashboard")) $("customerDashboard").hidden = true;
  if ($("customerTools")) $("customerTools").hidden = false;
  if ($("customerMachineStatusView")) $("customerMachineStatusView").hidden = true;
  if ($("customerServicesView")) $("customerServicesView").hidden = true;
  if ($("customerEventView")) $("customerEventView").hidden = false;
  stopCustomerMachineStatusTimer();
  renderCustomerEventInfo(customerActiveEventData);
  requestAnimationFrame(scrollCustomerTop);
}

function closeCustomerEvent() {
  saveCustomerView("DASHBOARD");
  if ($("customerEventView")) $("customerEventView").hidden = true;
  revokeCustomerEventInfoImage();
  showCustomerDashboard();
}

let staffEventInfoImageObjectUrl = null;
let staffActiveEventData = null;

function revokeStaffEventInfoImage() {
  if (staffEventInfoImageObjectUrl) {
    URL.revokeObjectURL(staffEventInfoImageObjectUrl);
    staffEventInfoImageObjectUrl = null;
  }
}

function renderStaffEventRewards(event) {
  const target = $("staffEventRewards");
  if (!target) return;

  const rewards = Array.isArray(event?.rewards) && event.rewards.length
    ? event.rewards
    : (event?.rewardType ? [{
        rewardType: event.rewardType,
        rewardQuantity: event.rewardQuantity,
        remaining: event.rewardRemaining ?? event.remaining,
        terms: event.rewardTerms || event.terms || "—",
      }] : []);

  target.innerHTML = rewards.length ? rewards.map((reward) => {
    const name = escapeHtml(reward.rewardType || reward.name || "—");
    const quantity = Number(reward.remaining ?? reward.rewardQuantity ?? reward.quantity ?? 0);
    return `<section class="staff-event-detail-card staff-event-reward-card">
      <span class="staff-event-detail-icon staff-event-gift-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M9 19h30v23H9z"/><path d="M24 19v23"/><path d="M7 12h34v8H7z"/><path d="M24 12c-1-6-5-9-9-8-4 1-4 6 0 8h9Z"/><path d="M24 12c1-6 5-9 9-8 4 1 4 6 0 8h-9Z"/></svg></span>
      <div class="staff-event-reward-copy">
        <div class="staff-event-reward-top"><h3>Reward</h3><span>Stok Tersedia</span></div>
        <p>${name}</p>
        <strong>${Number.isFinite(quantity) ? quantity.toLocaleString("id-ID") : "0"}</strong>
      </div>
    </section>`;
  }).join("") : `<section class="staff-event-detail-card staff-event-reward-card">
    <span class="staff-event-detail-icon staff-event-gift-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M9 19h30v23H9z"/><path d="M24 19v23"/><path d="M7 12h34v8H7z"/><path d="M24 12c-1-6-5-9-9-8-4 1-4 6 0 8h9Z"/><path d="M24 12c1-6 5-9 9-8 4 1 4 6 0 8h-9Z"/></svg></span>
    <div class="staff-event-reward-copy"><div class="staff-event-reward-top"><h3>Reward</h3><span>Stok Tersedia</span></div><p>—</p><strong>0</strong></div>
  </section>`;
}

function renderStaffEventInfo(data) {
  const event = data?.event;
  staffActiveEventData = data || null;
  const image = $("staffEventInfoImage");
  const title = $("staffEventInfoTitle");
  const period = $("staffEventInfoPeriod");
  const description = $("staffEventInfoDescription");
  const terms = $("staffEventInfoTerms");
  if (!title || !period || !description || !terms) return;

  revokeStaffEventInfoImage();
  if (!data?.active || !event) {
    title.classList.add("empty-state");
    title.textContent = "Belum ada event";
    period.textContent = "—";
    description.textContent = "—";
    terms.textContent = "—";
    renderStaffEventRewards(null);
    if (image) { image.hidden = true; image.removeAttribute("src"); }
    return;
  }

  title.classList.remove("empty-state");
  title.textContent = event.title || "—";
  period.textContent = formatDateRange(event.startsAt, event.endsAt);
  description.textContent = event.description || "—";

  const rewards = Array.isArray(event.rewards) && event.rewards.length
    ? event.rewards
    : (event.rewardType ? [event] : []);
  const termsList = rewards.map((reward) => reward.rewardTerms || reward.terms).filter(Boolean);
  terms.innerHTML = termsList.length > 1
    ? `<ol>${termsList.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : escapeHtml(termsList[0] || "—");

  renderStaffEventRewards(event);

  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
    if (event.imageUrl) {
      apiBlob(event.imageUrl).then((blob) => {
        if (!( $("staffEventView") && !$('staffEventView').hidden)) return;
        staffEventInfoImageObjectUrl = URL.createObjectURL(blob);
        image.src = staffEventInfoImageObjectUrl;
        image.hidden = false;
      }).catch(() => {});
    }
  }
}

function openStaffEvent() {
  if ($("staffDashboard")) $("staffDashboard").hidden = true;
  if ($("staffTools")) $("staffTools").hidden = false;
  if ($("staffMachineStatusView")) $("staffMachineStatusView").hidden = true;
  if ($("staffServicesView")) $("staffServicesView").hidden = true;
  if ($("staffActiveEvent")) $("staffActiveEvent").hidden = true;
  if ($("staffEventView")) $("staffEventView").hidden = true;
  if ($("staffScannerTool")) $("staffScannerTool").hidden = true;
  if ($("staffMachineTool")) $("staffMachineTool").hidden = true;
  if ($("staffToolsBack")) $("staffToolsBack").hidden = true;
  if ($("staffEventView")) $("staffEventView").hidden = false;
  renderStaffEventInfo(staffActiveEventData);
}

function closeStaffEvent() {
  if ($("staffEventView")) $("staffEventView").hidden = true;
  revokeStaffEventInfoImage();
  showStaffDashboard();
}

function openStaffServices() {
  if ($("staffDashboard")) $("staffDashboard").hidden = true;
  if ($("staffTools")) $("staffTools").hidden = false;
  if ($("staffMachineStatusView")) $("staffMachineStatusView").hidden = true;
  if ($("staffServicesView")) $("staffServicesView").hidden = false;
  if ($("staffToolsBack")) $("staffToolsBack").hidden = true;
  if ($("staffActiveEvent")) $("staffActiveEvent").hidden = true;
  if ($("staffEventView")) $("staffEventView").hidden = true;
  if ($("staffScannerTool")) $("staffScannerTool").hidden = true;
  if ($("staffMachineTool")) $("staffMachineTool").hidden = true;
}

function closeStaffServices() {
  if ($("staffServicesView")) $("staffServicesView").hidden = true;
  showStaffDashboard();
}

function openStaffMachineStatus() {
  if ($("staffDashboard")) $("staffDashboard").hidden = true;
  if ($("staffTools")) $("staffTools").hidden = false;
  if ($("staffMachineStatusView")) $("staffMachineStatusView").hidden = false;
  if ($("staffActiveEvent")) $("staffActiveEvent").hidden = true;
  if ($("staffEventView")) $("staffEventView").hidden = true;
  if ($("staffScannerTool")) $("staffScannerTool").hidden = true;
  if ($("staffMachineTool")) $("staffMachineTool").hidden = true;
  renderStaffMachineStatusMeta();
  refreshStaffMachines();
  startStaffMachineStatusTimer();
}

function closeStaffMachineStatus() {
  closeStaffMachineActivation();
  stopStaffMachineStatusTimer();
  if ($("staffMachineStatusView")) $("staffMachineStatusView").hidden = true;
  showStaffDashboard();
}

function openStaffMachineActivation(machine) {
  if (!machine || machine.status !== "IDLE") return;
  staffSelectedMachine = machine;
  staffMachineActivationBusy = false;
  if ($("staffActivationMsg")) $("staffActivationMsg").textContent = "";
  if ($("staffActivationStart")) {
    $("staffActivationStart").disabled = false;
    $("staffActivationStart").textContent = "▶  Mulai Mesin";
  }
  const type = staffMachineTypeLabel(machine);
  const id = `${machine.type === "WASHER" ? "W" : "D"}${machine.machineNumber}`;
  $("staffActivationMachineId").textContent = `${id} - ${type}`;
  $("staffActivationMachineType").textContent = type;
  $("staffActivationDuration").textContent = `${Number(machine.durationMinutes || (machine.type === "DRYER" ? 50 : 32))} menit`;
  const end = new Date(Date.now() + Number(machine.durationMinutes || (machine.type === "DRYER" ? 50 : 32)) * 60000);
  $("staffActivationEnd").textContent = formatStaffWibDateTime(end).time;
  $("staffMachineActivationModal").hidden = false;
  document.body.classList.add("staff-machine-modal-open");
}

function closeStaffMachineActivation() {
  const modal = $("staffMachineActivationModal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("staff-machine-modal-open");
  staffSelectedMachine = null;
  staffMachineActivationBusy = false;
}

async function confirmStaffMachineActivation() {
  if (!staffSelectedMachine || staffMachineActivationBusy) return;
  staffMachineActivationBusy = true;
  const button = $("staffActivationStart");
  if (button) { button.disabled = true; button.textContent = "Memulai..."; }
  try {
    await api(`/staff/machines/${encodeURIComponent(staffSelectedMachine.machineId)}/activate`, { method: "POST", body: "{}" });
    closeStaffMachineActivation();
    await refreshStaffMachines();
  } catch (error) {
    const message = $("staffActivationMsg");
    if (message) message.textContent = error.message;
    staffMachineActivationBusy = false;
    if (button) { button.disabled = false; button.textContent = "▶  Mulai Mesin"; }
  }
}

async function refreshStaffMachines() {
  try {
    const data = await api("/machines");
    staffMachineData = Array.isArray(data.machines) ? data.machines : [];
    renderStaffDashboardMachineSummary();
    renderMachines($("staffMachines"), staffMachineData, true);
    renderStaffMachineStatusList();
    renderStaffMachineStatusMeta();
  } catch (error) {
    if ($("staffMachines")) $("staffMachines").textContent = error.message;
    if ($("staffMachineStatusList")) $("staffMachineStatusList").textContent = error.message;
  }
}

async function activateMachine(id) {
  try {
    await api(`/staff/machines/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" });
    await refreshStaffMachines();
  } catch (error) {
    msg("scannerSupport", error.message);
  }
}

if ($("refreshMachines")) {
  $("refreshMachines").onclick = refreshMachines;
}

if ($("staffMachineFilters")) {
  $("staffMachineFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-staff-machine-filter]");
    if (!button) return;
    staffMachineFilter = button.dataset.staffMachineFilter || "ALL";
    updateStaffMachineFilterButtons();
    renderStaffMachineStatusList();
  });
}

if ($("staffMachineRefresh")) {
  $("staffMachineRefresh").onclick = refreshStaffMachines;
}

if ($("staffMachineStatusBack")) {
  $("staffMachineStatusBack").onclick = closeStaffMachineStatus;
}

if ($("staffActivationClose")) {
  $("staffActivationClose").onclick = closeStaffMachineActivation;
}

if ($("staffActivationCancel")) {
  $("staffActivationCancel").onclick = closeStaffMachineActivation;
}

if ($("staffActivationStart")) {
  $("staffActivationStart").onclick = confirmStaffMachineActivation;
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-staff-machine-modal]")) {
    closeStaffMachineActivation();
  }
});

if ($("staffServicesCard")) {
  $("staffServicesCard").addEventListener("click", openStaffServices);
}

if ($("staffServicesBack")) {
  $("staffServicesBack").addEventListener("click", closeStaffServices);
}

if ($("staffEventCard")) {
  $("staffEventCard").addEventListener("click", openStaffEvent);
  $("staffEventCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openStaffEvent();
    }
  });
}

if ($("staffEventBack")) $("staffEventBack").addEventListener("click", closeStaffEvent);
if ($("staffEventBackBottom")) $("staffEventBackBottom").addEventListener("click", closeStaffEvent);

const STAFF_LAUNDRY_MAP_URL = "https://maps.app.goo.gl/3KfFnHuLeZRsBnYG6?g_st=ic";
const staffServicesLocationIcon = document.querySelector("#staffServicesView .staff-services-info-address .staff-services-icon-box");
if (staffServicesLocationIcon) {
  staffServicesLocationIcon.addEventListener("click", () => {
    window.location.href = STAFF_LAUNDRY_MAP_URL;
  });
}

if ($("staffStatusCard")) {
  $("staffStatusCard").addEventListener("click", openStaffMachineStatus);
  $("staffStatusCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openStaffMachineStatus();
    }
  });
}

if ($("customerServicesCard")) {
  $("customerServicesCard").addEventListener("click", openCustomerServices);
}

const CUSTOMER_LAUNDRY_MAP_URL = "https://maps.app.goo.gl/3KfFnHuLeZRsBnYG6?g_st=ic";
const customerServicesLocationIcon = document.querySelector("#customerServicesView .staff-services-info-address .staff-services-icon-box");
if (customerServicesLocationIcon) {
  customerServicesLocationIcon.setAttribute("role", "button");
  customerServicesLocationIcon.setAttribute("tabindex", "0");
  customerServicesLocationIcon.addEventListener("click", () => {
    window.location.href = CUSTOMER_LAUNDRY_MAP_URL;
  });
  customerServicesLocationIcon.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.location.href = CUSTOMER_LAUNDRY_MAP_URL;
    }
  });
}
if ($("customerStatusCard")) {
  $("customerStatusCard").addEventListener("click", openCustomerMachineStatus);
  $("customerStatusCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCustomerMachineStatus();
    }
  });
}
if ($("customerEventCard")) {
  $("customerEventCard").addEventListener("click", openCustomerEvent);
  $("customerEventCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCustomerEvent();
    }
  });
}
if ($("customerMachineFilters")) {
  $("customerMachineFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-customer-machine-filter]");
    if (!button) return;
    customerMachineFilter = button.dataset.customerMachineFilter || "ALL";
    $("customerMachineFilters").querySelectorAll("[data-customer-machine-filter]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    renderCustomerMachineStatusList();
  });
}
if ($("customerMachineStatusBack")) $("customerMachineStatusBack").addEventListener("click", closeCustomerMachineStatus);
if ($("customerMachineDetailClose")) $("customerMachineDetailClose").addEventListener("click", closeCustomerMachineDetail);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-customer-machine-detail]")) closeCustomerMachineDetail();
});
if ($("customerServicesBack")) $("customerServicesBack").addEventListener("click", closeCustomerServices);
if ($("customerEventBack")) $("customerEventBack").addEventListener("click", closeCustomerEvent);
if ($("customerEventBackBottom")) $("customerEventBackBottom").addEventListener("click", closeCustomerEvent);
if ($("customerMachineRefresh")) $("customerMachineRefresh").addEventListener("click", async () => {
  await refreshCustomerDashboardMachines();
  renderCustomerMachineStatusList();
  renderCustomerMachineStatusMeta();
});

$("customerLogout")?.addEventListener("click", () => {
  clearSession();
  clearCustomerIdentity();
  clearCustomerView();
  window.location.href = LOGIN_ROUTES.CUSTOMER;
});

$("staffLogout")?.addEventListener("click", () => {
  clearSession();
  window.location.href = LOGIN_ROUTES.STAFF;
});

$("customerIdentitySubmit")?.addEventListener("click", submitCustomerIdentity);
$("customerIdentityPhone")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitCustomerIdentity();
});
$("customerIdentityEmail")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitCustomerIdentity();
});

let cameraStream = null;

if ($("scanCamera")) {
  $("scanCamera").onclick =
    async () => {
      if (
        !window.BarcodeDetector
      ) {
        msg(
          "scannerSupport",
          "Browser ini tidak menyediakan pemindai QR native.",
        );
        return;
      }

      try {
        const detector =
          new BarcodeDetector({
            formats: [
              "qr_code",
            ],
          });

        const video =
          $("camera");

        cameraStream =
          await navigator
            .mediaDevices
            .getUserMedia({
              video: {
                facingMode:
                  "environment",
              },
              audio: false,
            });

        video.srcObject =
          cameraStream;

        video.hidden =
          false;

        const loop =
          async () => {
            if (
              video.hidden
            ) {
              return;
            }

            try {
              const codes =
                await detector.detect(
                  video,
                );

              if (
                codes[0]
                  ?.rawValue
              ) {
                video.hidden =
                  true;

                cameraStream
                  .getTracks()
                  .forEach(
                    (track) =>
                      track.stop(),
                  );

                cameraStream =
                  null;

                const data =
                  await api(
                    `/staff/scan/${encodeURIComponent(
                      codes[0].rawValue,
                    )}`,
                  );

                $("staffResult").textContent =
                  JSON.stringify(
                    data,
                    null,
                    2,
                  );

                if (
                  data.redeemable
                ) {
                  const redeem =
                    await api(
                      "/staff/redeem",
                      {
                        method:
                          "POST",
                        body:
                          JSON.stringify({
                            rewardId:
                              data.rewardId,
                          }),
                      },
                    );

                  $("staffResult").textContent =
                    JSON.stringify(
                      {
                        ...data,
                        redeem,
                      },
                      null,
                      2,
                    );
                }

                return;
              }
            } catch (error) {
              $("staffResult").textContent =
                error.message;
            }

            requestAnimationFrame(
              loop,
            );
          };

        loop();
      } catch (error) {
        msg(
          "scannerSupport",
          error.message,
        );
      }
    };
}

let ownerData = null;
let ownerServerTimeReceivedAt = 0;
let ownerRealtimeTimer = null;
let ownerCurrentView = "overview";
let ownerOperationPeriod = "daily";
let ownerCustomerPage = 1;
let ownerCustomerSearch = "";
let ownerCustomerScope = "all";
let ownerCustomerData = { total: 0, page: 1, pageSize: 10, items: [] };
let ownerSelectedCustomerId = null;

function getWibDateInputValue(offsetDays = 0) {
  const now = new Date(Date.now() + (7 * 60 * 60 * 1000));
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + (offsetDays * 86400000);
  const date = new Date(utcMidnight);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function ensureOwnerDateRange() {
  const from = $("ownerDateFrom");
  const to = $("ownerDateTo");
  if (!from || !to) return;
  if (!from.value) from.value = getWibDateInputValue();
  if (!to.value) to.value = from.value;
  if (from.value > to.value) to.value = from.value;
}

function ownerDateRangeParams() {
  ensureOwnerDateRange();
  const from = $("ownerDateFrom")?.value || getWibDateInputValue();
  const to = $("ownerDateTo")?.value || from;
  return { from, to };
}

let ownerEventFilter = "ACTIVE";
let ownerMachineFilter = "ALL";
let editingEventId = null;
let editingRewardType = null;
let ownerRewardFilter = "ACTIVE";
let selectedRewardType = null;
let selectedEventId = null;

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function formatDateRange(start, end) {
  const a = formatDateTime(start);
  const b = formatDateTime(end);
  return `${a} – ${b}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes} mnt`;
}

function ownerRealtimeNow() {
  const serverTime = Date.parse(ownerData?.serverTime || "");
  if (!Number.isFinite(serverTime)) return Date.now();
  const receivedAt = Number(ownerServerTimeReceivedAt || Date.now());
  return serverTime + Math.max(0, Date.now() - receivedAt);
}

function formatOwnerRealtime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sept", "Okt", "Nov", "Des"];
  const month = monthNames[Math.max(0, Number(get("month")) - 1)] || get("month");
  return `${get("weekday")}, ${get("day")} ${month} ${get("year")}   ${get("hour")}.${get("minute")} WIB`;
}

function ownerIconSvg(name) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true"';
  const icons = {
    overview: `<svg ${common}><path d="M4 14h4v6H4zM10 10h4v10h-4zM16 4h4v16h-4z"/><path d="M4 8l4-3 4 2 4-4 4 2"/></svg>`,
    reward: `<svg ${common}><path d="M7 8h10l-1 12H8L7 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M4 11h16"/><path d="M12 11v4M10 13h4"/></svg>`,
    customer: `<svg ${common}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.5-3 2.3-5 5.5-5s5 2 5.5 5M14 15c2.8-.2 5 1.2 5.5 4"/></svg>`,
    event: `<svg ${common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16M8 13h3M8 16h5"/></svg>`,
    audit: `<svg ${common}><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/><path d="M4 7v12a2 2 0 0 0 2 2"/></svg>`,
    csv: `<svg ${common}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>`,
    calendar: `<svg ${common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16M8 13h3"/></svg>`,
    clock: `<svg ${common}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`,
    washer: `<svg ${common}><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M8 7h1M11 7h1"/></svg>`,
    dryer: `<svg ${common}><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M8 7h8"/></svg>`,
    user: `<svg ${common}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3-6 7-6s6.2 2 7 6"/></svg>`,
    gift: `<svg ${common}><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M12 9v11M3 9h18M6 9a2.5 2.5 0 1 1 2.5-2.5C8.5 8 12 9 12 9s3.5-1 3.5-2.5A2.5 2.5 0 1 1 18 9"/></svg>`,
    percent: `<svg ${common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h.01M15 15h.01M8 16l8-8"/></svg>`
  };
  return icons[name] || '';
}

function mountOwnerIcons() {
  document.querySelectorAll('[data-owner-icon]').forEach((node) => {
    const name = node.dataset.ownerIcon;
    if (name) node.innerHTML = ownerIconSvg(name);
  });
}

function ownerViews() {
  return {
    overview: $("ownerViewOverview"),
    machines: $("ownerViewMachines"),
    events: $("ownerViewEvents"),
    "reward-pool": $("ownerViewRewardPool"),
    "customer-trace": $("ownerViewCustomerTrace"),
    "csv-export": $("ownerViewCsvExport"),
  };
}

function setOwnerView(view) {
  const views = ownerViews();
  const target = views[view];
  if (!target) return Promise.resolve();
  ownerCurrentView = view;

  for (const [name, element] of Object.entries(views)) {
    if (element) element.hidden = name !== view;
  }

  document.querySelectorAll("[data-owner-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.ownerView === view);
  });

  if (view === "machines") {
    renderOwnerMachines();
    return Promise.resolve();
  }
  if (view === "events") return loadOwnerEvents();
  if (view === "reward-pool") return loadOwnerRewardPool();
  if (view === "customer-trace") return loadOwnerCustomers();
  return Promise.resolve();
}

function renderOwnerMetrics() {
  const data = ownerData?.metrics;
  const target = $("ownerMetrics");
  if (!target || !data) return;

  const totalRewardSupplied = Number(data.totalRewardSupplied || 0);
  const claimed = Number(data.claimed || 0);
  const redeemed = Number(data.redeemed || 0);
  const claimedPercentage = totalRewardSupplied > 0
    ? Math.round((claimed / totalRewardSupplied) * 100)
    : 0;
  const redeemedPercentage = totalRewardSupplied > 0
    ? Math.round((redeemed / totalRewardSupplied) * 100)
    : 0;

  const items = [
    ["Total Customer", data.participants, "user", data.participantsChangePct, true, "active-event-customer"],
    ["Reward Claimed", claimed, "gift", claimedPercentage, false, "active-event-reward"],
    ["Reward Redeemed", redeemed, "percent", redeemedPercentage, false, ""],
  ];

  target.innerHTML = items.map(([label, value, icon, percentage, vsPrevious, actionName]) => {
    const numericPercentage = Number(percentage || 0);
    const arrow = vsPrevious
      ? (numericPercentage > 0 ? "↑" : numericPercentage < 0 ? "↓" : "→")
      : "";
    const percentageText = vsPrevious
      ? (label === "Total Customer"
        ? `${Math.abs(numericPercentage)}%`
        : `${arrow} ${Math.abs(numericPercentage)}%`)
      : `${Math.abs(numericPercentage)}%`;
    const note = (vsPrevious || label === "Reward Claimed" || label === "Reward Redeemed") ? `<span class="owner-metric-note">vs sebelumnya</span>` : "";
    const action = actionName ? ` data-owner-metric-action="${actionName}" role="button" tabindex="0"` : "";
    const aria = actionName === "active-event-customer"
      ? ` aria-label="Lihat customer aktif event"`
      : actionName === "active-event-reward"
        ? ` aria-label="Lihat detail reward event aktif"`
        : "";
    return `<div class="owner-metric-card${actionName ? " clickable" : ""}"${action}${aria}><span class="owner-metric-icon ${icon}">${ownerIconSvg(icon)}</span><small>${label}</small><b>${Number(value || 0).toLocaleString("id-ID")}</b><em>${percentageText}</em>${note}</div>`;
  }).join("");

  const activeCustomerCard = target.querySelector('[data-owner-metric-action="active-event-customer"]');
  if (activeCustomerCard) {
    activeCustomerCard.onclick = () => openOwnerActiveEventCustomerList();
    activeCustomerCard.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openOwnerActiveEventCustomerList();
      }
    };
  }

  const claimedCard = target.querySelector('[data-owner-metric-action="active-event-reward"]');
  if (claimedCard) {
    claimedCard.onclick = () => openOwnerActiveEventRewardDetail();
    claimedCard.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openOwnerActiveEventRewardDetail();
      }
    };
  }
}

async function openOwnerActiveEventCustomerList() {
  ownerCustomerScope = "active-event";
  ownerCustomerPage = 1;
  ownerCustomerSearch = "";
  const search = $("ownerCustomerSearch");
  if (search) search.value = "";
  setOwnerView("customer-trace");
}

async function openOwnerActiveEventRewardDetail() {
  try {
    msg("ownerResult", "");

    // Resolve the ACTIVE event from the authoritative Owner Events endpoint.
    // Do not rely on a stale overview snapshot for navigation.
    const eventData = await api("/owner/events");
    const events = Array.isArray(eventData?.items) ? eventData.items : [];
    const activeEvents = events
      .filter((event) => eventCategory(event) === "ACTIVE")
      .sort((a, b) => {
        const startDiff = Date.parse(b.startsAt) - Date.parse(a.startsAt);
        return Number.isFinite(startDiff) && startDiff !== 0
          ? startDiff
          : String(b.eventId || "").localeCompare(String(a.eventId || ""));
      });
    const activeEvent = activeEvents[0] || null;

    if (!activeEvent) {
      msg("ownerResult", "Tidak ada event aktif saat ini.");
      return;
    }

    ownerData = ownerData || {};
    ownerData.events = events;
    ownerData.activeEvents = activeEvents;

    // Load the Reward Pool once and wait for it before resolving the detail.
    await setOwnerView("reward-pool");

    const rewardPool = ownerData?.rewardPool || [];
    const item = rewardPool.find((row) =>
      String(row.rewardType || "") === String(activeEvent.rewardType || "") &&
      (row.events || []).some((event) =>
        String(event.eventId) === String(activeEvent.eventId) &&
        event.active &&
        eventCategory(event) === "ACTIVE"
      )
    );

    if (!item) {
      msg("rewardDetailMsg", "Reward untuk event aktif tidak ditemukan.");
      return;
    }

    openRewardDetail(item.rewardType, activeEvent.eventId);
  } catch (error) {
    msg("ownerResult", error.message);
  }
}


function renderOwnerMachineSummary() {
  const target = $("ownerMachineSummary");
  if (!target) return;
  const machines = ownerData?.machines || [];
  const washer = machines.filter((machine) => machine.type === "WASHER");
  const dryer = machines.filter((machine) => machine.type === "DRYER");
  const card = (label, type, list) => {
    const used = list.filter((machine) => machine.status === "IN_USE").length;
    const idle = Math.max(0, list.length - used);
    const icon = type === "WASHER" ? "washer" : "dryer";
    return `<button type="button" class="owner-machine-summary-card" data-owner-view="machines"><span class="owner-machine-icon ${type.toLowerCase()}">${ownerIconSvg(icon)}</span><strong>${label} (${list.length})</strong><span><i class="idle-dot"></i> Idle <b>${idle}</b></span><span><i class="busy-dot"></i> Terpakai <b>${used}</b></span></button>`;
  };
  target.innerHTML = `${card("Washer", "WASHER", washer)}${card("Dryer", "DRYER", dryer)}`;
  target.querySelectorAll('[data-owner-view="machines"]').forEach((button) => button.addEventListener("click", () => setOwnerView("machines")));
}

function formatOwnerShortDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}

function renderOwnerOperations() {
  const target = $("ownerOperationStats");
  if (!target || !ownerData?.operatingTime) return;
  document.querySelectorAll("#operationPeriods button").forEach((button) => button.classList.toggle("active", button.dataset.period === ownerOperationPeriod));
  const data = ownerData.operatingTime[ownerOperationPeriod] || { washer: 0, dryer: 0 };
  target.innerHTML = `
    <div class="operation-stat"><span class="operation-stat-icon washer-clock">${ownerIconSvg("clock")}</span><div><span>Total Waktu Operasi<br>Washer</span><b>${formatDuration(Number(data.washer || 0))}</b></div></div>
    <div class="operation-stat"><span class="operation-stat-icon dryer-clock">${ownerIconSvg("clock")}</span><div><span>Total Waktu Operasi<br>Dryer</span><b>${formatDuration(Number(data.dryer || 0))}</b></div></div>
  `;
}

function revokeOwnerActiveEventImages() {
  for (const url of ownerActiveEventObjectUrls.values()) URL.revokeObjectURL(url);
  ownerActiveEventObjectUrls.clear();
}

function renderOwnerActiveEvents() {
  const target = $("ownerActiveEvents");
  if (!target) return;
  const events = ownerData?.activeEvents || [];
  revokeOwnerActiveEventImages();
  if (!events.length) {
    target.innerHTML = `<div class="owner-list-item"><small>Tidak ada event aktif.</small></div>`;
    return;
  }
  target.innerHTML = events.map((event, index) => `
    <button class="active-event" type="button" data-open-events="1">
      <span class="active-event-icon">${ownerIconSvg("calendar")}</span>
      <span class="active-event-copy">${event.imageUrl ? `<img class="active-event-image" data-owner-event-image="${escapeHtml(event.eventId)}" alt="Image Event Aktif">` : ""}<b>${escapeHtml(event.title)}</b><span>${escapeHtml(formatDateRange(event.startsAt, event.endsAt))}</span></span>
      <span class="arrow">›</span>
    </button>
  `).join("");
  events.forEach((event) => {
    if (!event.imageUrl) return;
    const image = Array.from(target.querySelectorAll("[data-owner-event-image]")).find((item) => item.dataset.ownerEventImage === event.eventId);
    if (!image) return;
    apiBlob(event.imageUrl).then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      ownerActiveEventObjectUrls.set(event.eventId, objectUrl);
      image.src = objectUrl;
    }).catch(() => {});
  });
  target.querySelectorAll("[data-open-events]").forEach((button) => button.onclick = () => setOwnerView("events"));
}

function renderOwnerOverview() {
  renderOwnerMetrics();
  renderOwnerMachineSummary();
  renderOwnerOperations();
  renderOwnerActiveEvents();
  mountOwnerIcons();
}

function formatRemaining(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function renderOwnerMachines() {
  const target = $("ownerAllMachines");
  if (!target) return;
  const clock = $("ownerMachineRealtime");
  if (clock) clock.textContent = formatOwnerRealtime(ownerRealtimeNow());
  const machines = ownerData?.machines || [];
  const washerCount = machines.filter((m) => m.type === "WASHER").length || 5;
  const dryerCount = machines.filter((m) => m.type === "DRYER").length || 5;
  const filters = document.querySelectorAll("#machineFilters [data-machine-filter]");
  filters.forEach((button) => {
    const type = button.dataset.machineFilter;
    const count = type === "ALL" ? machines.length || 10 : type === "WASHER" ? washerCount : dryerCount;
    button.textContent = `${type === "ALL" ? "Semua" : type === "WASHER" ? "Washer" : "Dryer"} (${count})`;
    button.classList.toggle("active", ownerMachineFilter === type);
  });
  const filtered = ownerMachineFilter === "ALL" ? machines : machines.filter((machine) => machine.type === ownerMachineFilter);
  target.innerHTML = filtered.map((machine) => {
    const remaining = Number(machine.remainingSeconds || 0);
    const inUse = machine.status === "IN_USE";
    const type = machine.type === "WASHER" ? "Washer" : "Dryer";
    const icon = machine.type === "WASHER" ? "washer" : "dryer";
    const elapsedSeconds = inUse && machine.startedAt
      ? Math.max(0, Math.floor((ownerRealtimeNow() - Date.parse(machine.startedAt)) / 1000))
      : 0;
    const time = formatDuration(elapsedSeconds);
    return `<div class="owner-machine-row"><span class="machine-row-icon">${ownerIconSvg(icon)}</span><span class="machine-row-id">${type === "Washer" ? "W" : "D"}${escapeHtml(machine.machineNumber)}</span><span class="machine-row-type">${type}</span><span class="machine-row-status ${inUse ? "busy" : "idle"}">${inUse ? "Terpakai" : "Idle"}</span><span class="machine-row-time">${time}</span></div>`;
  }).join("") || `<div class="owner-machine-row-empty">Tidak ada mesin.</div>`;
  mountOwnerIcons();
}

function renderRewardOptions() {
  const select = $("eventRewardType");
  if (!select) return;
  const pools = (ownerData?.rewardPool || []).filter((pool) => pool.active);
  select.innerHTML = pools.length
    ? `<option value="">Pilih reward dari Reward Pool</option>${pools.map((pool) => `<option value="${escapeHtml(pool.rewardType)}">${escapeHtml(pool.rewardType)}</option>`).join("")}`
    : `<option value="">Belum ada reward aktif</option>`;
  updateEventRewardStock();
}

function updateEventRewardStock() {
  const select = $("eventRewardType");
  const note = $("eventRewardStock");
  if (!select || !note) return;
  const pool = (ownerData?.rewardPool || []).find((item) => item.rewardType === select.value);
  note.textContent = pool ? `Stok tersedia di pool: ${Number(pool.remaining).toLocaleString("id-ID")}` : "";
}

function renderOwnerRewardList(items = ownerData?.rewardPool || []) {
  const target = $("ownerRewardList");
  if (!target) return;
  const active = items.filter((item) => item.active);
  const inactive = items.filter((item) => !item.active);
  const rows = ownerRewardFilter === "ACTIVE" ? active : ownerRewardFilter === "INACTIVE" ? inactive : items;
  $("activeRewardCount") && ($( "activeRewardCount").textContent = String(active.length));
  $("inactiveRewardCount") && ($( "inactiveRewardCount").textContent = String(inactive.length));
  $("allRewardCount") && ($( "allRewardCount").textContent = String(items.length));
  const totalBudget = items.reduce((sum, item) => sum + Number(item.budgetTotal || 0), 0);
  $("rewardBudgetTotal") && ($("rewardBudgetTotal").textContent = `Rp ${totalBudget.toLocaleString("id-ID")}`);
  target.innerHTML = rows.length ? rows.map((item) => {
    const event = (item.events || [])[0];
    const activeEvent = (item.events || []).find((row) => row.active && eventCategory(row) === "ACTIVE");
    return `<article class="locked-reward-card">
      <button class="locked-reward-card-main" type="button" data-open-reward="${escapeHtml(item.rewardType)}">
        <span class="locked-card-main">
          <span class="locked-card-title-row"><b>${escapeHtml(item.rewardType)}</b><em class="locked-status ${item.active ? "active" : "inactive"}">${item.active ? "Aktif" : "Nonaktif"}</em></span>
          <span class="locked-stock-row"><span>${ownerIconSvg("gift")} Total Stok: <b>${Number(item.quotaTotal).toLocaleString("id-ID")}</b></span><span>Sisa: <b>${Number(item.remaining).toLocaleString("id-ID")}</b></span><span>Digunakan: <b>${Number(item.quotaUsed).toLocaleString("id-ID")}</b></span></span>
          <span class="locked-used-label">Digunakan di Event:</span>
          ${event ? `<span class="locked-event-reference"><span class="locked-reference-icon">${ownerIconSvg("calendar")}</span><span><b>${escapeHtml(event.title)}</b><small>${escapeHtml(formatOwnerShortDate(event.startsAt))} – ${escapeHtml(formatOwnerShortDate(event.endsAt))}</small></span></span>` : `<span class="locked-no-event">Belum digunakan pada event</span>`}
        </span>
        <span class="locked-card-arrow">›</span>
      </button>
      ${activeEvent ? `<span class="locked-reward-card-actions"><button type="button" class="owner-outline-button reward-card-edit" data-edit-reward="${escapeHtml(item.rewardType)}">Edit</button><button type="button" class="danger-button reward-card-delete" data-delete-reward="${escapeHtml(item.rewardType)}">Hapus</button></span>` : ""}
    </article>`;
  }).join("") : `<div class="locked-empty">Belum ada reward.</div>`;
  target.querySelectorAll("[data-open-reward]").forEach((button) => {
    button.onclick = () => openRewardDetail(button.dataset.openReward);
  });
  target.querySelectorAll("[data-edit-reward]").forEach((button) => {
    button.onclick = (event) => { event.stopPropagation(); openRewardForm(button.dataset.editReward); };
  });
  target.querySelectorAll("[data-delete-reward]").forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      selectedRewardType = button.dataset.deleteReward;
      await deleteReward();
    };
  });
}

async function loadOwnerRewardPool() {
  try {
    const { from, to } = ownerDateRangeParams();
    const params = new URLSearchParams({ from, to });
    const data = await api(`/owner/reward-pool?${params.toString()}`);
    ownerData = ownerData || {};
    ownerData.rewardPool = data.items || [];
    renderOwnerRewardList();
    renderRewardOptions();
  } catch (error) {
    msg("rewardFormMsg", error.message);
  }
}

function resetRewardForm() {
  editingRewardType = null;
  $("ownerRewardType").disabled = false;
  $("ownerRewardType").value = "";
  $("rewardDescription").value = "";
  $("rewardDescriptionCount").textContent = "0/200";
  $("rewardQuota").value = "";
  $("rewardTerms").value = "";
  $("rewardTermsCount").textContent = "0/200";
  $("rewardActive").value = "ACTIVE";
}

function openRewardForm(rewardType = null) {
  editingRewardType = rewardType;
  $("rewardPoolListView").hidden = true;
  $("rewardDetailView").hidden = true;
  $("rewardFormCard").hidden = false;
  const item = (ownerData?.rewardPool || []).find((row) => row.rewardType === rewardType);
  $("rewardFormTitle").textContent = rewardType ? "Edit Reward" : "Tambah Reward";
  $("lockedRewardFormSubtitle") && ($("lockedRewardFormSubtitle").textContent = rewardType ? "Ubah informasi reward" : "Buat reward baru untuk event");
  $("ownerRewardType").disabled = Boolean(rewardType);
  $("ownerRewardType").value = rewardType || "";
  $("rewardDescription").value = item?.description || "";
  $("rewardDescriptionCount").textContent = `${($( "rewardDescription").value || "").length}/200`;
  $("rewardQuota").value = item?.quotaTotal ?? "";
  $("rewardTerms").value = item?.terms || "";
  $("rewardTermsCount").textContent = `${($( "rewardTerms").value || "").length}/200`;
  $("rewardActive").value = item ? (item.active ? "ACTIVE" : "INACTIVE") : "ACTIVE";
  msg("rewardFormMsg", "");
}

function openRewardDetail(rewardType, eventId = null) {
  const item = (ownerData?.rewardPool || []).find((row) => row.rewardType === rewardType);
  if (!item) return;
  selectedRewardType = rewardType;
  $("rewardPoolListView").hidden = true;
  $("rewardFormCard").hidden = true;
  $("rewardDetailView").hidden = false;
  const allEvents = item.events || [];
  const events = eventId ? allEvents.filter((event) => event.eventId === eventId) : allEvents;
  $("rewardDetailCard").innerHTML = `
    <div class="locked-detail-rows">
      <div><span>Nama Reward</span><b>${escapeHtml(item.rewardType)}</b></div>
      <div><span>Deskripsi</span><b>${escapeHtml(item.description || "—")}</b></div>
      <div><span>Total Stok</span><b>${Number(item.quotaTotal).toLocaleString("id-ID")}</b></div>
      <div><span>Budget Reward</span><b>Rp ${Number(item.budgetTotal || 0).toLocaleString("id-ID")}</b></div>
      <div><span>Stok Tersisa</span><b>${Number(item.remaining).toLocaleString("id-ID")}</b></div>
      <div><span>Reward Claimed</span><b>${Number(item.rewardClaimed || 0).toLocaleString("id-ID")}</b></div>
      <div class="locked-detail-event-row"><span>Digunakan di Event (${events.length})</span><div class="locked-detail-events">${events.length ? events.map((event) => `<section><b>${escapeHtml(event.title)}</b><small>${ownerIconSvg("calendar")} ${escapeHtml(formatOwnerShortDate(event.startsAt))} – ${escapeHtml(formatOwnerShortDate(event.endsAt))}</small><small>${ownerIconSvg("gift")} Jumlah dialokasikan: ${Number(event.rewardQuantity || 0).toLocaleString("id-ID")}</small><small>${ownerIconSvg("gift")} Reward Claimed: ${Number(item.rewardClaimed || 0).toLocaleString("id-ID")}</small></section>`).join("") : `<span class="locked-no-event">Belum digunakan pada event</span>`}</div></div>
      <div><span>Syarat &amp; Ketentuan</span><b>${escapeHtml(item.terms || "—")}</b></div>
      <div><span>Status</span><b><em class="locked-status ${item.active ? "active" : "inactive"}">${item.active ? "Aktif" : "Nonaktif"}</em></b></div>
    </div>`;
  msg("rewardDetailMsg", "");
}


function closeRewardViews() {
  $("rewardFormCard").hidden = true;
  $("rewardDetailView").hidden = true;
  $("rewardPoolListView").hidden = false;
  selectedRewardType = null;
  resetRewardForm();
}

async function saveReward() {
  try {
    const body = {
      rewardType: $("ownerRewardType").value.trim(),
      description: $("rewardDescription").value.trim(),
      quotaTotal: Number($("rewardQuota").value),
      terms: $("rewardTerms").value.trim(),
      active: $("rewardActive").value === "ACTIVE",
    };
    if (!body.rewardType || !Number.isInteger(body.quotaTotal) || body.quotaTotal < 1) throw new Error("Nama reward dan total stok wajib diisi.");
    const path = editingRewardType ? `/owner/reward-pool/${encodeURIComponent(editingRewardType)}` : "/owner/reward-pool";
    await api(path, { method: editingRewardType ? "PATCH" : "POST", body: JSON.stringify(body) });
    closeRewardViews();
    await loadOwnerData();
    setOwnerView("reward-pool");
  } catch (error) {
    msg("rewardFormMsg", error.message);
  }
}

async function deleteReward() {
  if (!selectedRewardType) return;
  if (!window.confirm("Hapus reward ini?")) return;
  try {
    await api(`/owner/reward-pool/${encodeURIComponent(selectedRewardType)}`, { method: "DELETE" });
    ownerData = ownerData || {};
    ownerData.rewardPool = (ownerData.rewardPool || []).filter((item) => item.rewardType !== selectedRewardType);
    renderOwnerRewardList(ownerData.rewardPool);
    renderRewardOptions();
    closeRewardViews();
    setOwnerView("reward-pool");
  } catch (error) {
    msg("rewardDetailMsg", error.message);
  }
}

function eventCategory(event) {
  const now = Date.now();
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "COMPLETED";
  if (event.active && now >= start && now < end) return "ACTIVE";
  if (event.active && now < start) return "UPCOMING";
  return "COMPLETED";
}

function eventStatusLabel(category) {
  return category === "ACTIVE" ? "Aktif" : category === "UPCOMING" ? "Akan Datang" : "Selesai";
}

function renderEventCard(event) {
  const category = eventCategory(event);
  return `<button class="locked-event-card" type="button" data-open-event="${escapeHtml(event.eventId)}">
    <span class="locked-event-icon">${ownerIconSvg("calendar")}</span>
    <span class="locked-event-copy">
      <span class="locked-card-title-row"><b>${escapeHtml(event.title)}</b><em class="locked-status ${category === "ACTIVE" ? "active" : "inactive"}">${eventStatusLabel(category)}</em></span>
      <small class="locked-event-line">${ownerIconSvg("calendar")} ${escapeHtml(formatOwnerShortDate(event.startsAt))} – ${escapeHtml(formatOwnerShortDate(event.endsAt))}</small>
      <small class="locked-event-line">${ownerIconSvg("gift")} Reward: ${escapeHtml(event.rewardType || "—")}</small>
      <small class="locked-event-line">${ownerIconSvg("gift")} Jumlah Reward: ${Number(event.rewardQuantity || 0).toLocaleString("id-ID")}</small>
    </span>
    <span class="locked-card-arrow">›</span>
  </button>`;
}

function renderOwnerEvents(items = []) {
  const target = $("ownerEventsList");
  if (!target) return;
  const active = items.filter((event) => eventCategory(event) === "ACTIVE");
  const upcoming = items.filter((event) => eventCategory(event) === "UPCOMING");
  const completed = items.filter((event) => eventCategory(event) === "COMPLETED");
  $("activeEventCount") && ($("activeEventCount").textContent = String(active.length));
  $("upcomingEventCount") && ($("upcomingEventCount").textContent = String(upcoming.length));
  $("completedEventCount") && ($("completedEventCount").textContent = String(completed.length));
  const rows = ({ ACTIVE: active, UPCOMING: upcoming, COMPLETED: completed })[ownerEventFilter] || active;
  target.innerHTML = rows.length ? rows.map(renderEventCard).join("") : `<div class="locked-empty">Tidak ada event pada filter ini.</div>`;
  target.querySelectorAll("[data-open-event]").forEach((button) => button.onclick = () => openEventDetail(button.dataset.openEvent));
}

async function loadOwnerEvents() {
  try {
    const data = await api("/owner/events");
    ownerData = ownerData || {};
    ownerData.events = data.items || [];
    renderOwnerEvents(ownerData.events);
    renderRewardOptions();
  } catch (error) {
    msg("eventFormMsg", error.message);
  }
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function openEventDetail(eventId) {
  const event = (ownerData?.events || []).find((row) => row.eventId === eventId);
  if (!event) return;
  selectedEventId = eventId;
  $("eventListView").hidden = true;
  $("eventDetailView").hidden = false;
  const category = eventCategory(event);
  $("eventDetailCard").innerHTML = `<div class="locked-detail-rows">
    <div><span>Nama Event</span><b>${escapeHtml(event.title)}</b></div>
    <div><span>Periode Event</span><b>${escapeHtml(formatOwnerShortDate(event.startsAt))} – ${escapeHtml(formatOwnerShortDate(event.endsAt))}</b></div>
    <div><span>Reward</span><b>${escapeHtml(event.rewardType || "—")}</b></div>
    <div><span>Jumlah Reward</span><b>${Number(event.rewardQuantity || 0).toLocaleString("id-ID")}</b></div>
    <div><span>Deskripsi</span><b>${escapeHtml(event.description || "—")}</b></div>
    <div><span>Status</span><b><em class="locked-status ${category === "ACTIVE" ? "active" : "inactive"}">${eventStatusLabel(category)}</em></b></div>
  </div>`;
  msg("eventDetailMsg", "");
}

function closeEventViews() {
  $("eventDetailView").hidden = true;
  $("eventFormCard").hidden = true;
  $("eventListView").hidden = false;
  selectedEventId = null;
  editingEventId = null;
}

function revokeEventImagePreview() {
  if (eventImageObjectUrl) {
    URL.revokeObjectURL(eventImageObjectUrl);
    eventImageObjectUrl = null;
  }
}

function resetEventImageUI() {
  revokeEventImagePreview();
  const input = $("eventImage");
  const preview = $("eventImagePreview");
  const remove = $("removeEventImageButton");
  if (input) { input.value = ""; input.disabled = false; }
  if (preview) { preview.hidden = true; preview.removeAttribute("src"); }
  if (remove) remove.hidden = true;
  msg("eventImageMsg", "");
}

function setEventImagePreview(src, revokePrevious = false) {
  const preview = $("eventImagePreview");
  if (!preview) return;
  if (revokePrevious) revokeEventImagePreview();
  preview.src = src;
  preview.hidden = false;
  $("removeEventImageButton") && ($("removeEventImageButton").hidden = false);
}

async function loadOwnerEventImage(eventId) {
  try {
    const blob = await apiBlob(`/owner/events/${encodeURIComponent(eventId)}/image`);
    revokeEventImagePreview();
    eventImageObjectUrl = URL.createObjectURL(blob);
    setEventImagePreview(eventImageObjectUrl);
  } catch {
    // No image is a valid state.
  }
}

function eventFormImageIsActive(event = null) {
  if (event && $("eventStatus")?.value === "INACTIVE") return false;
  const start = $("eventStartsAt")?.value || (event ? toDateInput(event.startsAt) : "");
  const end = $("eventEndsAt")?.value || (event ? toDateInput(event.endsAt) : "");
  if (!start || !end) return false;
  const now = Date.now();
  const startMs = Date.parse(`${start}T00:00:00+07:00`);
  const endMs = Date.parse(`${end}T23:59:59+07:00`);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && now >= startMs && now < endMs;
}

function updateEventImageAvailability(event = null) {
  const input = $("eventImage");
  if (!input) return;
  input.disabled = !eventFormImageIsActive(event);
}

async function uploadEventImage(eventId) {
  const input = $("eventImage");
  const file = input?.files?.[0];
  if (!file) return false;
  const prepared = await prepareEventImage(file);
  await fetch(`${apiBase}/owner/events/${encodeURIComponent(eventId)}/image`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${state.token}`, "Content-Type": prepared.type },
    body: prepared.blob,
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
  });
  return true;
}

async function deleteEventImage(eventId) {
  await api(`/owner/events/${encodeURIComponent(eventId)}/image`, { method: "DELETE" });
}

async function prepareEventImage(file) {
  if (!file || !/^image\/(jpeg|webp)$/i.test(file.type)) throw new Error("Image harus JPG atau WebP.");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(1, 1200 / image.naturalWidth, 1200 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image tidak dapat diproses.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = "image/webp";
    for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      if (blob && blob.size <= 307200) return { blob, type };
    }
    throw new Error("Image tetap lebih dari 300 KB setelah kompresi.");
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function openEventForm(eventId = null) {
  editingEventId = eventId;
  $("eventDetailView").hidden = true;
  $("eventListView").hidden = true;
  $("eventFormCard").hidden = false;
  const event = (ownerData?.events || []).find((row) => row.eventId === eventId);
  $("eventFormTitle").textContent = event ? "Edit Event" : "Buat Event";
  $("eventFormCard").querySelector(".locked-form-subtitle").textContent = event ? "Ubah informasi event" : "Buat event baru";
  $("eventTitle").value = event?.title || "";
  $("eventStartsAt").value = toDateInput(event?.startsAt);
  $("eventEndsAt").value = toDateInput(event?.endsAt);
  renderRewardOptions();
  $("eventRewardType").value = event?.rewardType || "";
  $("eventRewardQuantity").value = event?.rewardQuantity || "";
  $("eventDescription").value = event?.description || "";
  $("eventDescriptionCount").textContent = `${($("eventDescription").value || "").length}/200`;
  $("eventStatusField").hidden = !event;
  if (event) $("eventStatus").value = event.active ? "ACTIVE" : "INACTIVE";
  resetEventImageUI();
  updateEventImageAvailability(event);
  if (event && eventCategory(event) === "ACTIVE") {
    loadOwnerEventImage(event.eventId);
  }
  updateEventRewardStock();
  msg("eventFormMsg", "");
}

async function saveEvent() {
  try {
    const start = $("eventStartsAt").value;
    const end = $("eventEndsAt").value;
    const body = {
      title: $("eventTitle").value.trim(),
      startsAt: start ? new Date(`${start}T00:00:00+07:00`).toISOString() : "",
      endsAt: end ? new Date(`${end}T23:59:59+07:00`).toISOString() : "",
      rewardType: $("eventRewardType").value,
      rewardQuantity: Number($("eventRewardQuantity").value),
      description: $("eventDescription").value.trim(),
      active: editingEventId ? $("eventStatus").value === "ACTIVE" : true,
    };
    if (!body.title || !start || !end || !body.rewardType || !Number.isInteger(body.rewardQuantity) || body.rewardQuantity < 1) throw new Error("Lengkapi data event.");
    const path = editingEventId ? `/owner/events/${encodeURIComponent(editingEventId)}` : "/owner/events";
    const saved = await api(path, { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(body) });
    if (body.active && editingEventId && eventFormImageIsActive(ownerData?.events?.find((row) => row.eventId === editingEventId)) && $("eventImage")?.files?.[0]) {
      await uploadEventImage(editingEventId);
    } else if (body.active && !editingEventId && saved.eventId && eventFormImageIsActive(null) && $("eventImage")?.files?.[0]) {
      await uploadEventImage(saved.eventId);
    }
    closeEventViews();
    await loadOwnerData();
    setOwnerView("events");
  } catch (error) {
    msg("eventFormMsg", error.message);
  }
}

async function deleteEvent() {
  if (!selectedEventId) return;
  if (!window.confirm("Hapus event ini?")) return;
  try {
    await api(`/owner/events/${encodeURIComponent(selectedEventId)}`, { method: "DELETE" });
    closeEventViews();
    await loadOwnerData();
    setOwnerView("events");
  } catch (error) {
    msg("eventDetailMsg", error.message);
  }
}

function formatCustomerDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}

function formatCustomerTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(date).replace(",", "");
}

function renderCustomerTraceList(data) {
  const target = $("ownerCustomerList");
  if (!target) return;
  ownerCustomerData = data || { total: 0, page: 1, pageSize: 10, items: [] };
  const items = ownerCustomerData.items || [];
  const total = Number(ownerCustomerData.total || 0);
  const page = Number(ownerCustomerData.page || 1);
  const pageSize = Number(ownerCustomerData.pageSize || 10);
  const from = total ? ((page - 1) * pageSize) + 1 : 0;
  const to = Math.min(page * pageSize, total);
  $("ownerCustomerTotal") && ($("ownerCustomerTotal").textContent = `${total.toLocaleString("id-ID")} Customers`);
  const heading = $("ownerCustomerHeading");
  if (heading) heading.textContent = ownerCustomerScope === "active-event" ? "Customer Aktif" : "Customer Trace";
  target.innerHTML = items.length ? `<div class="owner-customer-table-wrap"><table class="owner-customer-table"><thead><tr><th>#</th><th>Email ID</th><th>No. HP</th><th>Play</th><th>Reward</th><th>Status</th><th></th></tr></thead><tbody>${items.map((item, index) => `<tr data-customer-id="${escapeHtml(item.customerId)}"><td>${from + index}</td><td>${escapeHtml(item.email || "—")}</td><td>${escapeHtml(item.phoneMasked || "—")}</td><td>${Number(item.totalPlay || 0)}</td><td>${Number(item.totalReward || 0)}</td><td><span class="owner-customer-status">Active</span></td><td><button type="button" class="owner-customer-open" aria-label="Buka detail customer">›</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="owner-customer-empty">Belum ada customer terdaftar.</div>`;
  target.querySelectorAll("[data-customer-id]").forEach((row) => row.addEventListener("click", () => openCustomerDetail(row.dataset.customerId)));
  renderCustomerPagination(total, page, pageSize);
}

function renderCustomerPagination(total, page, pageSize) {
  const target = $("ownerCustomerPagination");
  const summary = $("ownerCustomerPaginationSummary");
  if (!target) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (summary) summary.textContent = total ? `${((page - 1) * pageSize) + 1} – ${Math.min(page * pageSize, total)} dari ${total}` : "0 dari 0";
  if (totalPages <= 1) { target.innerHTML = ""; return; }
  const buttons = [];
  buttons.push(`<button type="button" data-customer-page="${Math.max(1, page - 1)}" ${page === 1 ? "disabled" : ""}>‹</button>`);
  const pages = [];
  if (totalPages <= 7) for (let i = 1; i <= totalPages; i++) pages.push(i);
  else {
    pages.push(1);
    if (page > 4) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 3) pages.push("…");
    pages.push(totalPages);
  }
  pages.forEach((item) => buttons.push(item === "…" ? `<span class="owner-customer-page-gap">…</span>` : `<button type="button" data-customer-page="${item}" class="${item === page ? "active" : ""}">${item}</button>`));
  buttons.push(`<button type="button" data-customer-page="${Math.min(totalPages, page + 1)}" ${page === totalPages ? "disabled" : ""}>›</button>`);
  target.innerHTML = buttons.join("");
  target.querySelectorAll("[data-customer-page]").forEach((button) => button.addEventListener("click", () => { ownerCustomerPage = Number(button.dataset.customerPage); loadOwnerCustomers(); }));
}

async function loadOwnerCustomers() {
  try {
    const params = new URLSearchParams({ page: String(ownerCustomerPage), pageSize: "10" });
    if (ownerCustomerScope === "active-event") params.set("scope", "active-event");
    if (ownerCustomerSearch) params.set("search", ownerCustomerSearch);
    renderCustomerTraceList(await api(`/owner/customers?${params.toString()}`));
  } catch (error) {
    const target = $("ownerCustomerList");
    if (target) target.innerHTML = `<div class="owner-customer-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function openCustomerDetail(customerId) {
  ownerSelectedCustomerId = customerId;
  const listView = $("ownerCustomerListView");
  const detailView = $("ownerCustomerDetailView");
  if (listView) listView.hidden = true;
  if (detailView) detailView.hidden = false;
  const target = $("ownerCustomerDetail");
  if (target) target.innerHTML = `<div class="owner-customer-loading">Memuat customer...</div>`;
  try {
    renderCustomerTrace(await api(`/owner/customer/${encodeURIComponent(customerId)}`));
  } catch (error) {
    if (target) target.innerHTML = `<div class="owner-customer-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderCustomerTrace(data) {
  const target = $("ownerCustomerDetail");
  if (!target) return;
  const customer = data.customer || {};
  const event = data.event || null;
  const transactions = data.transactions || [];
  const plays = data.plays || [];
  const rewards = data.rewards || [];

  const latestTransaction = transactions[0] || null;
  const latestPlay = plays[0] || null;
  const latestReward = rewards[0] || null;
  const hasTransaction = transactions.length > 0;
  const hasPlay = plays.length > 0;
  const hasReward = rewards.length > 0;
  const hasQr = rewards.some((row) => row.token_ref);
  const hasRedeem = rewards.some((row) => row.redeemed_at);
  const hasClaimed = rewards.some((row) => row.claimed_at);

  const journey = [
    {
      title: "Transaction",
      active: hasTransaction,
      text: hasTransaction ? `${latestTransaction.transaction_id || "—"} · ${latestTransaction.service_type || "Transaction"}` : "Belum ada aktivitas",
      at: hasTransaction ? latestTransaction.created_at : null,
    },
    {
      title: "Play",
      active: hasPlay,
      text: hasPlay ? `${latestPlay.session_id || latestPlay.play_id || "—"}${latestPlay.status ? ` · ${latestPlay.status}` : ""}` : "Belum ada aktivitas",
      at: hasPlay ? latestPlay.created_at : null,
    },
    {
      title: "Reward",
      active: hasReward,
      text: hasReward ? `${latestReward.reward_id || "—"}${latestReward.type ? ` (${latestReward.type})` : ""}` : "Belum ada aktivitas",
      at: hasReward ? latestReward.created_at : null,
    },
    {
      title: "QR Reference",
      active: hasQr,
      text: hasQr ? String(rewards.find((row) => row.token_ref)?.token_ref || "—") : "Belum ada aktivitas",
      at: hasQr ? (rewards.find((row) => row.token_ref)?.created_at || null) : null,
    },
    {
      title: "Redeem",
      active: hasRedeem,
      text: hasRedeem ? "Reward redeemed" : "Belum ada aktivitas",
      at: hasRedeem ? (rewards.find((row) => row.redeemed_at)?.redeemed_at || null) : null,
    },
    {
      title: "Claimed",
      active: hasClaimed,
      text: hasClaimed ? "" : "Belum ada aktivitas",
      at: hasClaimed ? (rewards.find((row) => row.claimed_at)?.claimed_at || null) : null,
    },
  ];

  const totalPlay = plays.length;
  const totalReward = rewards.length;
  const totalRedeemed = rewards.filter((row) => row.redeemed_at).length;
  const eventName = event?.event_title || "—";
  const eventPeriod = event ? `${formatCustomerDate(event.event_starts_at)} – ${formatCustomerDate(event.event_ends_at)}` : "—";

  target.innerHTML = `<div class="owner-customer-detail-heading"><h1>Customer Detail</h1><p>${escapeHtml(customer.customer_id || "—")}</p></div>
    <div class="owner-customer-info-card"><div><span>Alamat Email</span><b>${escapeHtml(customer.email || "—")}</b></div><div><span>No. HP</span><b>${escapeHtml(customer.phone_masked || "—")}</b></div><div><span>Registrasi</span><b>${escapeHtml(formatCustomerDate(customer.created_at))}</b></div><div><span>Event</span><b>${escapeHtml(eventName)}</b></div><div><span>Periode Event</span><b>${escapeHtml(eventPeriod)}</b></div><div><span>Total Play</span><b>${totalPlay}</b></div><div><span>Total Reward</span><b>${totalReward}</b></div><div><span>Total Redeemed</span><b>${totalRedeemed}</b></div><div><span>Status</span><b><em class="owner-customer-status">Active</em></b></div></div>
    <h2 class="owner-customer-journey-title">Customer Journey</h2>
    <div class="owner-customer-journey">${journey.map((item, index) => `<div class="owner-journey-item${item.active ? "" : " inactive"}"><span class="owner-journey-dot"></span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.text)}</small></div><time>${escapeHtml(item.at ? formatCustomerTime(item.at) : "—")}</time></div>`).join("")}</div>`;
}

async function loadOwnerAudit() {
  try {
    const data = await api("/owner/audit?limit=100");
    const query = ($("auditSearch")?.value || "").trim().toLowerCase();
    const items = (data.items || []).filter((item) => !query || `${item.entity_type} ${item.entity_id} ${item.action} ${item.actor} ${item.result}`.toLowerCase().includes(query));
    const target = $("ownerAuditList");
    target.innerHTML = items.length ? items.map((item) => `<div class="owner-list-item audit-item"><div class="row"><b>${escapeHtml(item.action)}</b><span class="status-pill ${item.result === "SUCCESS" ? "" : "off"}">${escapeHtml(item.result)}</span></div><small>${escapeHtml(formatDateTime(item.timestamp))}</small><div class="meta"><div>Entity<strong>${escapeHtml(item.entity_type)}</strong></div><div>ID<strong>${escapeHtml(item.entity_id)}</strong></div><div>Source<strong>${escapeHtml(item.actor)}</strong></div></div></div>`).join("") : `<div class="owner-list-item"><small>Tidak ada audit.</small></div>`;
  } catch (error) {
    $("ownerAuditList").textContent = error.message;
  }
}

async function loadOwnerData(range = null) {
  try {
    const selected = range || ownerDateRangeParams();
    if (selected.from > selected.to) {
      throw new Error("Tanggal mulai tidak boleh setelah tanggal selesai.");
    }
    const query = new URLSearchParams({ from: selected.from, to: selected.to });
    const data = await api(`/owner/overview?${query.toString()}`);
    ownerData = data;
    ownerServerTimeReceivedAt = Date.now();
    ensureOwnerDateRange();
    renderOwnerOverview();
    renderOwnerEvents(data.activeEvents || []);
    renderRewardOptions();
    if (ownerCurrentView === "machines") renderOwnerMachines();
  } catch (error) {
    msg("ownerResult", error.message);
    throw error;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

for (const button of document.querySelectorAll("[data-owner-view]")) {
  button.addEventListener("click", () => {
    if (button.dataset.ownerView === "customer-trace") {
      ownerCustomerScope = "all";
      ownerCustomerPage = 1;
      ownerCustomerSearch = "";
    }
    setOwnerView(button.dataset.ownerView);
  });
}

ensureOwnerDateRange();
for (const input of document.querySelectorAll("#ownerDateFrom, #ownerDateTo")) {
  input.addEventListener("change", async () => {
    const { from, to } = ownerDateRangeParams();
    if (from > to) {
      if (input.id === "ownerDateFrom") $("ownerDateTo").value = from;
      else $("ownerDateFrom").value = to;
    }
    await loadOwnerData();
  });
}

for (const button of document.querySelectorAll("#operationPeriods [data-period]")) {
  button.addEventListener("click", () => {
    ownerOperationPeriod = button.dataset.period;
    renderOwnerOperations();
  });
}

for (const button of document.querySelectorAll("#machineFilters [data-machine-filter]")) {
  button.addEventListener("click", () => {
    ownerMachineFilter = button.dataset.machineFilter;
    renderOwnerMachines();
  });
}

for (const button of document.querySelectorAll("#rewardFilters [data-reward-filter]")) {
  button.addEventListener("click", () => { ownerRewardFilter = button.dataset.rewardFilter; document.querySelectorAll("#rewardFilters button").forEach((item) => item.classList.toggle("active", item.dataset.rewardFilter === ownerRewardFilter)); renderOwnerRewardList(); });
}

for (const button of document.querySelectorAll("#eventFilters [data-event-filter]")) {
  button.addEventListener("click", () => {
    ownerEventFilter = button.dataset.eventFilter;
    document.querySelectorAll("#eventFilters button").forEach((item) => item.classList.toggle("active", item.dataset.eventFilter === ownerEventFilter));
    renderOwnerEvents(ownerData?.events || []);
  });
}

$("newEventButton")?.addEventListener("click", () => openEventForm());
$("cancelEventButton")?.addEventListener("click", closeEventViews);

$("eventDescription")?.addEventListener("input", () => { $("eventDescriptionCount").textContent = `${$("eventDescription").value.length}/200`; });
$("eventRewardType")?.addEventListener("change", updateEventRewardStock);
$("eventStartsAt")?.addEventListener("change", () => updateEventImageAvailability(ownerData?.events?.find((row) => row.eventId === editingEventId) || null));
$("eventEndsAt")?.addEventListener("change", () => updateEventImageAvailability(ownerData?.events?.find((row) => row.eventId === editingEventId) || null));
$("eventStatus")?.addEventListener("change", () => updateEventImageAvailability(ownerData?.events?.find((row) => row.eventId === editingEventId) || null));
$("eventImage")?.addEventListener("change", () => {
  const file = $("eventImage")?.files?.[0];
  msg("eventImageMsg", "");
  if (!file) return;
  if (!eventFormImageIsActive(ownerData?.events?.find((row) => row.eventId === editingEventId) || null)) {
    $("eventImage").value = "";
    msg("eventImageMsg", "Image hanya dapat disimpan untuk Event Aktif.");
    return;
  }
  if (!/^image\/(jpeg|webp)$/i.test(file.type)) {
    $("eventImage").value = "";
    msg("eventImageMsg", "Image harus JPG atau WebP.");
    return;
  }
  if (file.size > 307200) {
    msg("eventImageMsg", "File akan dikompresi maksimal 300 KB saat disimpan.");
  }
  const previewUrl = URL.createObjectURL(file);
  setEventImagePreview(previewUrl, true);
  eventImageObjectUrl = previewUrl;
});
$("removeEventImageButton")?.addEventListener("click", async () => {
  try {
    if (editingEventId) await deleteEventImage(editingEventId);
    resetEventImageUI();
    updateEventImageAvailability(ownerData?.events?.find((row) => row.eventId === editingEventId) || null);
  } catch (error) {
    msg("eventImageMsg", error.message);
  }
});
$("cancelEventTop")?.addEventListener("click", closeEventViews);
$("saveEventButton")?.addEventListener("click", saveEvent);
$("newRewardButton")?.addEventListener("click", () => openRewardForm());
$("cancelRewardButton")?.addEventListener("click", closeRewardViews);
$("cancelRewardTop")?.addEventListener("click", closeRewardViews);
$("rewardDetailBack")?.addEventListener("click", closeRewardViews);
$("editRewardButton")?.addEventListener("click", () => { if (selectedRewardType) openRewardForm(selectedRewardType); });
$("deleteRewardButton")?.addEventListener("click", deleteReward);
$("saveRewardButton")?.addEventListener("click", saveReward);
$("eventDetailBack")?.addEventListener("click", () => { closeEventViews(); setOwnerView("events"); });
$("editEventButton")?.addEventListener("click", () => { if (selectedEventId) openEventForm(selectedEventId); });
$("deleteEventButton")?.addEventListener("click", deleteEvent);
$("loadOwner")?.addEventListener("click", loadOwnerData);
$("ownerCustomerSearchButton")?.addEventListener("click", () => { ownerCustomerSearch = ($("ownerCustomerSearch")?.value || "").trim(); ownerCustomerPage = 1; loadOwnerCustomers(); });
$("ownerCustomerSearch")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { ownerCustomerSearch = event.currentTarget.value.trim(); ownerCustomerPage = 1; loadOwnerCustomers(); } });
$("ownerCustomerDetailBack")?.addEventListener("click", () => { const list = $("ownerCustomerListView"); const detail = $("ownerCustomerDetailView"); if (list) list.hidden = false; if (detail) detail.hidden = true; ownerSelectedCustomerId = null; });

$("downloadExport")?.addEventListener("click", async () => {
  try {
    const selectedDatasets = [...document.querySelectorAll('input[name="exportDataset"]:checked')]
      .map((input) => input.value);
    if (!selectedDatasets.length) throw new Error("Pilih minimal satu data untuk di-download.");

    const params = new URLSearchParams();
    params.set("datasets", selectedDatasets.join(","));
    if ($("exportFrom").value) params.set("from", `${$("exportFrom").value}T00:00:00+07:00`);
    if ($("exportTo").value) params.set("to", `${$("exportTo").value}T23:59:59+07:00`);
    const response = await fetch(`${apiBase}/owner/export?${params}`, { headers: { Authorization: `Bearer ${state.token}` }, cache: "no-store" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || `HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "teras-laundry-owner-report.csv";
    link.click();
    URL.revokeObjectURL(url);
    msg("csvExportMsg", "CSV berhasil dibuat.");
  } catch (error) {
    msg("csvExportMsg", error.message);
  }
});

$("ownerLogout")?.addEventListener("click", () => {
  clearSession();
  window.location.href = LOGIN_ROUTES.OWNER;
});


function bindEventFormCounters() {
  const pairs = [["eventDescription", "eventDescriptionCount"]];
  pairs.forEach(([inputId, counterId]) => {
    const input = $(inputId);
    const counter = $(counterId);
    if (!input || !counter || input.dataset.counterBound) return;
    input.dataset.counterBound = "1";
    const update = () => { counter.textContent = `${input.value.length}/200`; };
    input.addEventListener("input", update);
    update();
  });
}
bindEventFormCounters();

async function loadOwner() {
  mountOwnerIcons();
  ensureOwnerDateRange();
  ownerCurrentView = "overview";
  setOwnerView("overview");
  await loadOwnerData();
  if (!ownerRealtimeTimer) {
    ownerRealtimeTimer = window.setInterval(() => {
      if (ownerCurrentView === "machines") {
        const clock = $("ownerMachineRealtime");
        if (clock) clock.textContent = formatOwnerRealtime(ownerRealtimeNow());
        renderOwnerMachines();
      }
    }, 30000);
  }
}

function makeQrSvg(text) {
  const n = 37;

  const matrix =
    Array.from(
      {
        length: n,
      },
      () =>
        Array(n).fill(
          null,
        ),
    );

  const set =
    (x, y, value) => {
      if (
        x >= 0 &&
        y >= 0 &&
        x < n &&
        y < n
      ) {
        matrix[y][x] =
          value;
      }
    };

  function finder(cx, cy) {
    for (
      let y = -1;
      y <= 7;
      y++
    ) {
      for (
        let x = -1;
        x <= 7;
        x++
      ) {
        const on =
          x >= 0 &&
          x <= 6 &&
          y >= 0 &&
          y <= 6 &&
          (
            x === 0 ||
            x === 6 ||
            y === 0 ||
            y === 6 ||
            (
              x >= 2 &&
              x <= 4 &&
              y >= 2 &&
              y <= 4
            )
          );

        set(
          cx + x,
          cy + y,
          on,
        );
      }
    }
  }

  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);

  for (
    let i = 8;
    i < n - 8;
    i++
  ) {
    set(
      i,
      6,
      i % 2 === 0,
    );

    set(
      6,
      i,
      i % 2 === 0,
    );
  }

  for (
    const [cx, cy]
    of [
      [6, 30],
      [30, 6],
      [30, 30],
    ]
  ) {
    if (
      matrix[cy]?.[cx] !==
      null
    ) {
      continue;
    }

    for (
      let y = -2;
      y <= 2;
      y++
    ) {
      for (
        let x = -2;
        x <= 2;
        x++
      ) {
        set(
          cx + x,
          cy + y,
          Math.max(
            Math.abs(x),
            Math.abs(y),
          ) === 2 ||
            Math.max(
              Math.abs(x),
              Math.abs(y),
            ) === 0,
        );
      }
    }
  }

  set(
    8,
    n - 8,
    true,
  );

  for (
    let i = 0;
    i < 9;
    i++
  ) {
    if (
      matrix[i][8] ===
      null
    ) {
      matrix[i][8] =
        false;
    }

    if (
      matrix[8][i] ===
      null
    ) {
      matrix[8][i] =
        false;
    }
  }

  for (
    let i = 0;
    i < 8;
    i++
  ) {
    if (
      matrix[n - 1 - i][8] ===
      null
    ) {
      matrix[n - 1 - i][8] =
        false;
    }

    if (
      matrix[8][n - 1 - i] ===
      null
    ) {
      matrix[8][n - 1 - i] =
        false;
    }
  }

  const bytes =
    Array.from(
      new TextEncoder().encode(
        text,
      ),
    );

  if (bytes.length > 106) {
    throw new Error(
      "QR text too long",
    );
  }

  const dataBits = [
    0,
    1,
    0,
    0,
  ];

  for (
    let i = 7;
    i >= 0;
    i--
  ) {
    dataBits.push(
      (bytes.length >> i) &
        1,
    );
  }

  for (const byte of bytes) {
    for (
      let i = 7;
      i >= 0;
      i--
    ) {
      dataBits.push(
        (byte >> i) & 1,
      );
    }
  }

  while (
    dataBits.length <
    108 * 8
  ) {
    dataBits.push(0);
  }

  while (
    dataBits.length %
      8
  ) {
    dataBits.push(0);
  }

  const data = [];

  for (
    let i = 0;
    i <
    dataBits.length;
    i += 8
  ) {
    let value = 0;

    for (
      let j = 0;
      j < 8;
      j++
    ) {
      value =
        (value << 1) |
        dataBits[i + j];
    }

    data.push(value);
  }

  const bits = [];

  for (
    const byte of data
  ) {
    for (
      let i = 7;
      i >= 0;
      i--
    ) {
      bits.push(
        (byte >> i) & 1,
      );
    }
  }

  let bitIndex = 0;
  let upward = true;

  for (
    let x = n - 1;
    x > 0;
    x -= 2
  ) {
    if (x === 6) {
      x--;
    }

    for (
      let yy = 0;
      yy < n;
      yy++
    ) {
      const y = upward
        ? n - 1 - yy
        : yy;

      for (
        let xx = 0;
        xx < 2;
        xx++
      ) {
        const column =
          x - xx;

        if (
          matrix[y][column] !==
          null
        ) {
          continue;
        }

        let value =
          bits[bitIndex++] ||
          0;

        value ^=
          (y + column) %
            2 ===
          0
            ? 1
            : 0;

        matrix[y][column] =
          Boolean(value);
      }
    }

    upward = !upward;
  }

  const size = n + 12;

  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`;

  svg +=
    `<rect width="100%" height="100%" fill="white"/>`;

  for (
    let y = 0;
    y < n;
    y++
  ) {
    for (
      let x = 0;
      x < n;
      x++
    ) {
      if (
        matrix[y][x]
      ) {
        svg +=
          `<rect x="${x + 6}" y="${y + 6}" width="1" height="1"/>`;
      }
    }
  }

  svg +=
    "</svg>";

  return svg;
}

async function initialize() {
  const pathname = normalizePathname();
  const expectedRole = resolveRolePath(pathname);

  // Root is the only route allowed to render the anniversary landing page.
  if (pathname === "/") {
    await loadConfig();
    showRootLanding();
    return;
  }

  // /owner and every /owner/* URL belong exclusively to Owner.
  if (expectedRole === "OWNER") {
    if (pathname === LOGIN_ROUTES.OWNER) {
      clearSession();
      showOwnerLogin();
      await loadConfig();
      return;
    }

    if (restoreSession() && state.role === "OWNER") {
      await loadConfig();
      showRole();
      return;
    }

    clearSession();
    showOwnerLogin();
    await loadConfig();
    return;
  }

  // /staff and every /staff/* URL belong exclusively to Staff.
  if (expectedRole === "STAFF") {
    if (pathname === LOGIN_ROUTES.STAFF) {
      clearSession();
      showStaffLogin();
      await loadConfig();
      return;
    }

    if (restoreSession() && state.role === "STAFF") {
      await loadConfig();
      showRole();
      return;
    }

    clearSession();
    showStaffLogin();
    await loadConfig();
    return;
  }

  // /customer and every /customer/* URL belong exclusively to Customer.
  if (expectedRole === "CUSTOMER") {
    await loadConfig();

    if (restoreSession() && state.role === "CUSTOMER") {
      showRole();
      return;
    }

    clearSession();
    const identity = loadCustomerIdentity();

    try {
      if (identity) {
        await restoreCustomerIdentitySession(identity);
      } else {
        await createCustomerGuestSession();
      }
      showRole();
    } catch {
      clearSession();
      clearCustomerIdentity();
      await createCustomerGuestSession();
      showRole();
    }
    return;
  }

  // Unknown non-root paths never inherit the Customer or another role UI.
  await loadConfig();
  showRootLanding();
}

initialize();
