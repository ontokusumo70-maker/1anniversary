const state = {
  token: null,
  role: null,
  userId: null,
  challengeId: null,
  playId: null,
  sessionId: null,
  rewardId: null,
  authMode: "CUSTOMER",
};

const SESSION_KEY = "teras_laundry_auth_session";

const $ = (id) => document.getElementById(id);
const msg = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

let apiBase =
  "https://1anniversary.ontokusumo70.workers.dev";

let assetBasePath = "/assets/";

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

function showRole() {
  document.body.dataset.role = state.role || "CUSTOMER";
  if ($("ownerAuth")) {
    $("ownerAuth").hidden = true;
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
    document.documentElement.style.setProperty("--game-bg", `url("${assetBasePath}background/game/game-bg.PNG")`);
    $("customer").hidden = false;
    refreshMachines();
    return;
  }

  if (state.role === "STAFF") {
    document.documentElement.style.setProperty("--game-bg", `url("${assetBasePath}background/staff/staff-bg.PNG")`);
    $("staff").hidden = false;
    refreshStaffMachines();
    return;
  }

  if (state.role === "OWNER") {
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

function showCustomerAuth(clearMessage = true) {
  state.authMode = "CUSTOMER";

  if ($("emailLabel")) {
    $("emailLabel").hidden = false;
  }

  if ($("requestOtp")) {
    $("requestOtp").hidden = false;
  }

  if ($("otpInfo")) {
    $("otpInfo").hidden = false;
  }

  if ($("staffLogin")) {
    $("staffLogin").hidden = true;
  }

  if ($("otpBox")) {
    $("otpBox").hidden = true;
  }

  if (clearMessage) {
    msg("authMsg", "");
  }
}

function showStaffOwnerAuth(clearMessage = true) {
  state.authMode = "STAFF_OWNER";

  if ($("emailLabel")) {
    $("emailLabel").hidden = true;
  }

  if ($("requestOtp")) {
    $("requestOtp").hidden = true;
  }

  if ($("otpInfo")) {
    $("otpInfo").hidden = true;
  }

  if ($("staffLogin")) {
    $("staffLogin").hidden = false;
    $("staffLogin").textContent = "Login";
  }

  if ($("otpBox")) {
    $("otpBox").hidden = true;
  }

  if (clearMessage) {
    msg("authMsg", "");
  }
}

let authModeRequest = 0;
let authModeTimer = null;

async function detectAuthMode() {
  const phone = $("phone")?.value.trim() || "";
  const requestId = ++authModeRequest;

  if (authModeTimer) {
    clearTimeout(authModeTimer);
    authModeTimer = null;
  }

  if (phone.replace(/\D/g, "").length < 8) {
    showCustomerAuth(false);
    return;
  }

  authModeTimer = setTimeout(async () => {
    try {
      const data = await api(
        "/auth/mode",
        {
          method: "POST",
          body: JSON.stringify({ phone }),
        },
      );

      if (requestId !== authModeRequest) {
        return;
      }

      if (data.mode === "STAFF_OWNER") {
        showStaffOwnerAuth(false);
      } else {
        showCustomerAuth(false);
      }
    } catch {
      if (requestId !== authModeRequest) {
        return;
      }

      showCustomerAuth(false);
    }
  }, 250);
}

async function requestCustomerOtp() {
  try {
    const phone =
      $("phone").value.trim();

    const email =
      $("email").value.trim();

    if (!phone) {
      msg(
        "authMsg",
        "Nomor WhatsApp wajib diisi.",
      );
      return;
    }

    if (!email) {
      msg(
        "authMsg",
        "Email wajib diisi.",
      );
      return;
    }

    const data =
      await api(
        "/auth/request-otp",
        {
          method: "POST",
          body: JSON.stringify({
            phone,
            email,
          }),
        },
      );

    state.challengeId =
      data.challengeId;

    $("otpBox").hidden = false;

    msg(
      "authMsg",
      "OTP terkirim ke email. Berlaku 5 menit.",
    );
  } catch (error) {
    msg(
      "authMsg",
      error.message,
    );
  }
}

async function verifyCustomerOtp() {
  try {
    const phone =
      $("phone").value.trim();

    const email =
      $("email").value.trim();

    const otp =
      $("otp").value.trim();

    if (!state.challengeId) {
      msg(
        "authMsg",
        "Silakan minta OTP terlebih dahulu.",
      );
      return;
    }

    const data =
      await api(
        "/auth/verify-otp",
        {
          method: "POST",
          body: JSON.stringify({
            phone,
            email,
            challengeId:
              state.challengeId,
            otp,
          }),
        },
      );

    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt =
      data.expiresAt || null;

    saveSession();

    msg("authMsg", "");

    showRole();
  } catch (error) {
    msg(
      "authMsg",
      error.message,
    );
  }
}

async function loginStaffOwner() {
  try {
    const phone =
      $("phone").value.trim();

    if (!phone) {
      msg(
        "authMsg",
        "Nomor Staff / Owner wajib diisi.",
      );
      return;
    }

    const data =
      await api(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            phone,
          }),
        },
      );

    state.token = data.token;
    state.role = data.role;
    state.userId = data.userId;
    state.expiresAt =
      data.expiresAt || null;

    saveSession();

    msg("authMsg", "");

    showRole();
    return;
  } catch (error) {
    msg(
      "authMsg",
      error.message,
    );
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

if ($("phone")) {
  $("phone").addEventListener(
    "input",
    detectAuthMode,
  );
}

if ($("requestOtp")) {
  $("requestOtp").onclick =
    requestCustomerOtp;
}

if ($("verifyOtp")) {
  $("verifyOtp").onclick =
    verifyCustomerOtp;
}

if ($("staffLogin")) {
  $("staffLogin").onclick =
    loginStaffOwner;
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
  if (!target) {
    return;
  }

  target.innerHTML = "";

  for (const machine of machines) {
    const card =
      document.createElement(
        "div",
      );

    card.className =
      "machine";

    const title =
      document.createElement(
        "b",
      );

    title.textContent =
      `${
        machine.type ===
        "WASHER"
          ? "Wash"
          : "Dry"
      } ${machine.machineNumber}`;

    const status =
      document.createElement(
        "span",
      );

    status.textContent =
      machine.statusLabel +
      (
        machine.remainingSeconds
          ? ` • ${Math.ceil(
              machine.remainingSeconds /
                60,
            )} mnt`
          : ""
      );

    status.className =
      machine.status ===
      "IN_USE"
        ? "busy"
        : "idle";

    card.append(
      title,
      status,
    );

    if (
      staff &&
      machine.status ===
        "IDLE"
    ) {
      const button =
        document.createElement(
          "button",
        );

      button.textContent =
        "Aktifkan";

      button.onclick =
        () =>
          activateMachine(
            machine.machineId,
          );

      card.append(
        button,
      );
    }

    target.append(card);
  }
}

async function refreshMachines() {
  try {
    const data =
      await api(
        "/machines",
      );

    renderMachines(
      $("machines"),
      data.machines,
    );
  } catch (error) {
    if ($("machines")) {
      $("machines").textContent =
        error.message;
    }
  }
}

if ($("refreshMachines")) {
  $("refreshMachines").onclick =
    refreshMachines;
}

async function refreshStaffMachines() {
  try {
    const data =
      await api(
        "/machines",
      );

    renderMachines(
      $("staffMachines"),
      data.machines,
      true,
    );
  } catch (error) {
    if ($("staffMachines")) {
      $("staffMachines").textContent =
        error.message;
    }
  }
}

async function activateMachine(
  id,
) {
  try {
    await api(
      `/staff/machines/${encodeURIComponent(
        id,
      )}/activate`,
      {
        method: "POST",
        body: "{}",
      },
    );

    await refreshStaffMachines();
  } catch (error) {
    msg(
      "scannerSupport",
      error.message,
    );
  }
}

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
let ownerCurrentView = "overview";
let ownerOperationPeriod = "daily";

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
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours} jam ${minutes} mnt` : `${minutes} mnt`;
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
    audit: $("ownerViewAudit"),
    "csv-export": $("ownerViewCsvExport"),
  };
}

function setOwnerView(view) {
  const views = ownerViews();
  const target = views[view];
  if (!target) return;
  ownerCurrentView = view;

  for (const [name, element] of Object.entries(views)) {
    if (element) element.hidden = name !== view;
  }

  document.querySelectorAll("[data-owner-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.ownerView === view);
  });

  if (view === "machines") renderOwnerMachines();
  if (view === "events") loadOwnerEvents();
  if (view === "reward-pool") loadOwnerRewardPool();
  if (view === "audit") loadOwnerAudit();
}

function renderOwnerMetrics() {
  const data = ownerData?.metrics;
  const target = $("ownerMetrics");
  if (!target || !data) return;
  const items = [
    ["Total Customer", data.participants, "user", data.participantsChangePct],
    ["Reward Claimed", data.claimed, "gift", data.claimedChangePct],
    ["Reward Redeemed", data.redeemed, "percent", data.redeemedChangePct],
  ];
  target.innerHTML = items.map(([label, value, icon, change]) => {
    const percentage = Number(change || 0);
    const arrow = percentage > 0 ? "↑" : percentage < 0 ? "↓" : "→";
    return `<div class="owner-metric-card"><span class="owner-metric-icon ${icon}">${ownerIconSvg(icon)}</span><small>${label}</small><b>${Number(value || 0).toLocaleString("id-ID")}</b><em>${arrow} ${Math.abs(percentage)}%</em><span class="owner-metric-note">vs sebelumnya</span></div>`;
  }).join("");
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
  const data = ownerData.operatingTime[ownerOperationPeriod] || { washer: {}, dryer: {} };
  target.innerHTML = `
    <div class="operation-stat"><span class="operation-stat-icon washer-clock">${ownerIconSvg("clock")}</span><div><span>Total Waktu Operasi<br>Washer</span><b>${formatDuration(Number(data.washer?.seconds || 0))}</b></div></div>
    <div class="operation-stat"><span class="operation-stat-icon dryer-clock">${ownerIconSvg("clock")}</span><div><span>Total Waktu Operasi<br>Dryer</span><b>${formatDuration(Number(data.dryer?.seconds || 0))}</b></div></div>
  `;
}

function renderOwnerActiveEvents() {
  const target = $("ownerActiveEvents");
  if (!target) return;
  const events = ownerData?.activeEvents || [];
  if (!events.length) {
    target.innerHTML = `<div class="owner-list-item"><small>Tidak ada event aktif.</small></div>`;
    return;
  }
  target.innerHTML = events.map((event) => `
    <button class="active-event" type="button" data-open-events="1">
      <span class="active-event-icon">${ownerIconSvg("calendar")}</span>
      <span class="active-event-copy"><b>${escapeHtml(event.title)}</b><span>${escapeHtml(formatDateRange(event.startsAt, event.endsAt))}</span></span>
      <span class="arrow">›</span>
    </button>
  `).join("");
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
    const time = inUse ? formatRemaining(remaining) : "-";
    return `<div class="owner-machine-row"><span class="machine-row-icon">${ownerIconSvg(icon)}</span><span class="machine-row-id">${type === "Washer" ? "W" : "D"}${escapeHtml(machine.machineNumber)}</span><span class="machine-row-type">${type}</span><span class="machine-row-status ${inUse ? "busy" : "idle"}">${inUse ? "Terpakai" : "Idle"}</span><span class="machine-row-time">${time}</span></div>`;
  }).join("") || `<div class="owner-machine-row-empty">Tidak ada mesin.</div>`;
  mountOwnerIcons();
}

function renderRewardOptions() {
  const select = $("eventRewardType");
  if (!select) return;
  const pools = ownerData?.rewardPool || [];
  select.innerHTML = pools.length
    ? pools.map((pool) => `<option value="${escapeHtml(pool.rewardType)}">${escapeHtml(pool.rewardType)}</option>`).join("")
    : `<option value="">Belum ada reward</option>`;
}

function renderOwnerRewardList(items = ownerData?.rewardPool || []) {
  const target = $("ownerRewardList");
  if (!target) return;
  target.innerHTML = items.length ? items.map((item) => `
    <button class="owner-list-item" type="button" data-edit-reward="${escapeHtml(item.rewardType)}" style="text-align:left;width:100%">
      <div class="row"><b>${escapeHtml(item.rewardType)}</b><span class="status-pill ${item.active ? "" : "off"}">${item.active ? "AKTIF" : "NONAKTIF"}</span></div>
      <div class="meta"><div>Quota<strong>${Number(item.quotaTotal).toLocaleString("id-ID")}</strong></div><div>Terpakai<strong>${Number(item.quotaUsed).toLocaleString("id-ID")}</strong></div><div>Sisa<strong>${Number(item.remaining).toLocaleString("id-ID")}</strong></div></div>
    </button>
  `).join("") : `<div class="owner-list-item"><small>Belum ada reward.</small></div>`;
  target.querySelectorAll("[data-edit-reward]").forEach((button) => button.onclick = () => openRewardForm(button.dataset.editReward));
}

async function loadOwnerRewardPool() {
  try {
    const data = await api("/owner/reward-pool");
    ownerData = ownerData || {};
    ownerData.rewardPool = data.items || [];
    renderOwnerRewardList();
    renderRewardOptions();
  } catch (error) {
    msg("rewardFormMsg", error.message);
  }
}

function openRewardForm(rewardType = null) {
  editingRewardType = rewardType;
  const card = $("rewardFormCard");
  if (!card) return;
  card.hidden = false;
  $("rewardFormTitle").textContent = rewardType ? "Edit Reward" : "Tambah Reward";
  $("ownerRewardType").disabled = Boolean(rewardType);
  $("ownerRewardType").value = rewardType || "";
  const item = (ownerData?.rewardPool || []).find((row) => row.rewardType === rewardType);
  $("rewardQuota").value = item ? item.quotaTotal : "";
  $("rewardActive").checked = item ? item.active : true;
  msg("rewardFormMsg", "");
}

async function saveReward() {
  try {
    const body = {
      rewardType: $("ownerRewardType").value.trim(),
      quotaTotal: Number($("rewardQuota").value),
      active: $("rewardActive").checked,
    };
    const path = editingRewardType ? `/owner/reward-pool/${encodeURIComponent(editingRewardType)}` : "/owner/reward-pool";
    await api(path, { method: editingRewardType ? "PATCH" : "POST", body: JSON.stringify(body) });
    $("rewardFormCard").hidden = true;
    await loadOwnerData();
    setOwnerView("reward-pool");
  } catch (error) {
    msg("rewardFormMsg", error.message);
  }
}

function eventCategory(event) {
  const now = Date.now();
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "COMPLETED";
  if (event.active && now >= start && now <= end) return "ACTIVE";
  if (now < start && event.active) return "UPCOMING";
  return "COMPLETED";
}

function formatEventCountdown(event) {
  const category = eventCategory(event);
  const target = category === "UPCOMING" ? Date.parse(event.startsAt) : Date.parse(event.endsAt);
  if (!Number.isFinite(target)) return "";
  const diff = Math.max(0, target - Date.now());
  const days = Math.floor(diff / 86400000);
  if (category === "UPCOMING") return days > 0 ? `Mulai dalam ${days} hari` : "Mulai hari ini";
  if (category === "ACTIVE") return days > 0 ? `${days} hari lagi` : "Berakhir hari ini";
  return "Selesai";
}

function eventStatusLabel(category) {
  if (category === "ACTIVE") return "Aktif";
  if (category === "UPCOMING") return "Akan Datang";
  return "Selesai";
}

function eventThumbnailLabel(event) {
  const title = String(event.title || "").toUpperCase();
  if (title.includes("DRYER")) return "DRYER<br>5X<br><small>GRATIS 1X</small>";
  if (title.includes("ANNIVERSARY")) return "1st<br>ANNIVERSARY<br><small>SPECIAL</small>";
  return "CUCI<br>10X<br><small>GRATIS 1X</small>";
}

function renderEventCard(event) {
  const category = eventCategory(event);
  const reward = `${event.rewardType || "Reward"} × ${Number(event.rewardQuantity || 0)}`;
  const title = String(event.title || "");
  const posterClass = title.toUpperCase().includes("DRYER") ? "dryer" : title.toUpperCase().includes("ANNIVERSARY") ? "anniversary" : "wash";
  const posterText = posterClass === "dryer" ? "DRYER<br><b>5X</b><br><small>GRATIS 1X</small>" : posterClass === "anniversary" ? "<b>1st</b><br>ANNIVERSARY<br><small>Special Reward</small>" : "CUCI<br><b>10X</b><br><small>GRATIS 1X</small>";
  return `<button class="owner-event-card event-card-locked" type="button" data-edit-event="${escapeHtml(event.eventId)}">
    <span class="event-card-thumbnail event-thumb-${posterClass} ${category.toLowerCase()}"><span>${posterText}</span></span>
    <span class="event-card-copy">
      <span class="event-card-title-row"><b>${escapeHtml(event.title)}</b><em class="event-status-badge ${category.toLowerCase()}">${eventStatusLabel(category)}</em></span>
      <small class="event-meta-row">${ownerIconSvg("calendar")} <span>${escapeHtml(formatDateRange(event.startsAt, event.endsAt))}</span></small>
      <small class="event-meta-row">${ownerIconSvg("clock")} <span>${escapeHtml(formatEventCountdown(event))}</span></small>
      <small class="event-meta-row">${ownerIconSvg("gift")} <span>Hadiah: ${escapeHtml(reward)}</span></small>
    </span>
    <span class="event-card-arrow">›</span>
    <span class="event-card-stats"><span><b>0</b><small>Participants</small></span><span><b>0</b><small>Play</small></span><span><b>0</b><small>Redeemed</small></span></span>
  </button>`;
}

function renderOwnerEvents(items = []) {
  const target = $("ownerEventsList");
  if (!target) return;
  const events = items || [];
  const active = events.filter((event) => eventCategory(event) === "ACTIVE");
  const upcoming = events.filter((event) => eventCategory(event) === "UPCOMING");
  const completed = events.filter((event) => eventCategory(event) === "COMPLETED");

  $("activeEventCount") && ($("activeEventCount").textContent = String(active.length));
  $("upcomingEventCount") && ($("upcomingEventCount").textContent = String(upcoming.length));
  $("completedEventCount") && ($("completedEventCount").textContent = String(completed.length));

  const groups = { ACTIVE: active, UPCOMING: upcoming, COMPLETED: completed };
  const rows = groups[ownerEventFilter] || active;
  target.innerHTML = rows.length
    ? `<div class="owner-event-group">${rows.map(renderEventCard).join("")}</div>`
    : `<div class="owner-event-card-empty">Tidak ada event pada filter ini.</div>`;

  target.querySelectorAll("[data-edit-event]").forEach((button) => {
    button.onclick = () => openEventForm(button.dataset.editEvent);
  });
}

async function loadOwnerEvents() {
  try {
    const data = await api("/owner/events");
    ownerData = ownerData || {};
    ownerData.events = data.items || [];
    renderOwnerEvents(ownerData.events);
    renderRewardOptions();
  } catch (error) {
    $("ownerEventsList").textContent = error.message;
  }
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function openEventForm(eventId = null) {
  editingEventId = eventId;
  const card = $("eventFormCard");
  if (!card) return;
  const event = (ownerData?.events || []).find((row) => row.eventId === eventId);
  card.hidden = false;
  $("eventFormTitle").textContent = event ? "Edit Event" : "Buat Event Baru";
  $("eventTitle").value = event?.title || "";
  $("eventStartsAt").value = toDateInput(event?.startsAt);
  $("eventEndsAt").value = toDateInput(event?.endsAt);
  renderRewardOptions();
  if (event) $("eventRewardType").value = event.rewardType;
  $("eventRewardQuantity").value = event?.rewardQuantity || "";
  msg("eventFormMsg", "");
}

async function saveEvent() {
  try {
    const startValue = $("eventStartsAt").value;
    const endValue = $("eventEndsAt").value;
    const body = {
      title: $("eventTitle").value.trim(),
      startsAt: startValue ? new Date(`${startValue}T00:00:00+07:00`).toISOString() : "",
      endsAt: endValue ? new Date(`${endValue}T23:59:59+07:00`).toISOString() : "",
      rewardType: $("eventRewardType").value,
      rewardQuantity: Number($("eventRewardQuantity").value),
      active: editingEventId ? Boolean((ownerData?.events || []).find((row) => row.eventId === editingEventId)?.active) : true,
    };
    if (!body.title || !$("eventStartsAt").value || !$("eventEndsAt").value || !body.rewardType || !Number.isInteger(body.rewardQuantity) || body.rewardQuantity < 1) {
      throw new Error("Lengkapi data event.");
    }
    const path = editingEventId ? `/owner/events/${encodeURIComponent(editingEventId)}` : "/owner/events";
    await api(path, { method: editingEventId ? "PATCH" : "POST", body: JSON.stringify(body) });
    $("eventFormCard").hidden = true;
    await loadOwnerData();
    setOwnerView("events");
  } catch (error) {
    msg("eventFormMsg", error.message);
  }
}

function renderCustomerTrace(data) {
  const target = $("traceResult");
  if (!target) return;
  const customer = data.customer;
  const timeline = [
    ...(data.transactions || []).map((row) => ({ title: "Transaction", text: `${row.transaction_id} · ${row.service_type}` })),
    ...(data.plays || []).map((row) => ({ title: "Play", text: `${row.play_id} · ${row.status}` })),
    ...(data.rewards || []).map((row) => ({ title: "Reward", text: `${row.reward_id} · ${row.type} · ${row.status}` })),
  ];
  target.innerHTML = `<div class="trace-customer-card"><h2>${escapeHtml(customer.name || "Nama belum tersedia")}</h2><p>${escapeHtml(customer.customer_id)}</p><p>${escapeHtml(customer.phone_masked || "—")} · ${escapeHtml(customer.email || "—")}</p><p>Registrasi: ${escapeHtml(formatDateTime(customer.created_at))}</p><div class="trace-timeline">${timeline.length ? timeline.map((item) => `<div class="trace-step"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.text)}</span></div>`).join("") : `<div class="trace-step"><span>Belum ada aktivitas.</span></div>`}</div></div>`;
}

async function runCustomerTrace() {
  try {
    const id = $("traceCustomerId").value.trim();
    if (!id) throw new Error("Customer ID wajib diisi.");
    renderCustomerTrace(await api(`/owner/customer/${encodeURIComponent(id)}`));
  } catch (error) {
    $("traceResult").textContent = error.message;
  }
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
  button.addEventListener("click", () => setOwnerView(button.dataset.ownerView));
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

for (const button of document.querySelectorAll("#eventFilters [data-event-filter]")) {
  button.addEventListener("click", () => {
    ownerEventFilter = button.dataset.eventFilter;
    document.querySelectorAll("#eventFilters button").forEach((item) => item.classList.toggle("active", item.dataset.eventFilter === ownerEventFilter));
    renderOwnerEvents(ownerData?.events || []);
  });
}

$("newEventButton")?.addEventListener("click", () => openEventForm());
$("cancelEventButton")?.addEventListener("click", () => { $("eventFormCard").hidden = true; });

$("eventDescription")?.addEventListener("input", () => { $("eventDescriptionCount").textContent = `${$("eventDescription").value.length}/200`; });
$("eventCondition")?.addEventListener("input", () => { $("eventConditionCount").textContent = `${$("eventCondition").value.length}/200`; });
$("cancelEventTop")?.addEventListener("click", () => { $("eventFormCard").hidden = true; });
$("saveEventButton")?.addEventListener("click", saveEvent);
$("newRewardButton")?.addEventListener("click", () => openRewardForm());
$("cancelRewardButton")?.addEventListener("click", () => { $("rewardFormCard").hidden = true; });
$("saveRewardButton")?.addEventListener("click", saveReward);
$("loadOwner")?.addEventListener("click", loadOwnerData);
$("traceCustomer")?.addEventListener("click", runCustomerTrace);
$("refreshAudit")?.addEventListener("click", loadOwnerAudit);
$("auditSearch")?.addEventListener("input", loadOwnerAudit);

$("downloadExport")?.addEventListener("click", async () => {
  try {
    const params = new URLSearchParams();
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
  window.location.href = "?role=owner";
});


function bindEventFormCounters() {
  const pairs = [["eventDescription", "eventDescriptionCount"], ["eventCondition", "eventConditionCount"]];
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
  await loadConfig();

  if (restoreSession()) {
    showRole();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const queryRole = params.get("role")?.toLowerCase() || "";
  const hashRole = window.location.hash.replace(/^#/, "").toLowerCase();
  const requestedRole = queryRole || hashRole;

  if (requestedRole === "customer") {
    showCustomerAuth();
    return;
  }

  if (requestedRole === "staff") {
    showCustomerAuth();
    showStaffOwnerAuth();
    return;
  }

  showOwnerLogin();
}

initialize();
