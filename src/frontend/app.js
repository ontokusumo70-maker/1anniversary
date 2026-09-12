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

async function loadOwner() {
  try {
    const data =
      await api(
        "/owner/overview",
      );

    $("ownerResult").textContent =
      JSON.stringify(
        data,
        null,
        2,
      );

    $("ownerOverview").innerHTML =
      `
      <div>
        Total Customer
        <b>${data.customers}</b>
      </div>
      <div>
        Total Play
        <b>${data.plays}</b>
      </div>
      `;

    const machines =
      await api(
        "/owner/machines",
      );

    $("ownerMachines").textContent =
      JSON.stringify(
        machines,
        null,
        2,
      );
  } catch (error) {
    $("ownerResult").textContent =
      error.message;
  }
}

if ($("loadOwner")) {
  $("loadOwner").onclick =
    loadOwner;
}

if ($("downloadExport")) {
  $("downloadExport").onclick =
    async () => {
      try {
        const type =
          $("ownerExport").value;

        const response =
          await fetch(
            `${apiBase}/owner/export?type=${encodeURIComponent(
              type,
            )}`,
            {
              headers: {
                Authorization:
                  `Bearer ${state.token}`,
              },
              cache:
                "no-store",
            },
          );

        if (!response.ok) {
          throw new Error(
            (
              await response
                .json()
                .catch(
                  () => ({}),
                )
            ).message ||
            `HTTP ${response.status}`,
          );
        }

        const blob =
          await response.blob();

        const url =
          URL.createObjectURL(
            blob,
          );

        const link =
          document.createElement(
            "a",
          );

        link.href = url;

        link.download =
          `teras-laundry-owner-${type}.csv`;

        link.click();

        URL.revokeObjectURL(
          url,
        );
      } catch (error) {
        $("ownerResult").textContent =
          error.message;
      }
    };
}

if ($("traceCustomer")) {
  $("traceCustomer").onclick =
    async () => {
      try {
        const id =
          $("traceCustomerId")
            .value.trim();

        const data =
          await api(
            `/owner/customer/${encodeURIComponent(
              id,
            )}`,
          );

        $("traceResult").textContent =
          JSON.stringify(
            data,
            null,
            2,
          );
      } catch (error) {
        $("traceResult").textContent =
          error.message;
      }
    };
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
  const requestedRole = new URLSearchParams(window.location.search).get("role");

  if (requestedRole?.toLowerCase() === "owner") {
    showOwnerLogin();
  } else {
    showCustomerAuth();
  }

  await loadConfig();

  if (
    restoreSession()
  ) {
    showRole();
  }
}

initialize();
