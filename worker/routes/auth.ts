import type { Env } from "../index";
import type { UserRole } from "../auth/types";
import {
  createOtpChallenge,
  hashEmail,
  hashPhone,
  verifyOtp,
} from "../auth/otp";
import {
  consumeOtp,
  countRecentOtpChallenges,
  incrementOtpAttempt,
  loadOtpChallenge,
  persistOtpChallenge,
} from "../auth/otp-store";
import { createAndPersistAuthSession } from "../auth/auth-session";
import { sendOtpEmail } from "../auth/gmail";
import { writeAuditSafe } from "../audit/logger";

const MAX_PHONE = 32;
const MAX_EMAIL = 254;
const MAX_OTP = 6;

const CUSTOMER_SESSION_TTL = 24 * 60 * 60;
const STAFF_SESSION_TTL = 8 * 60 * 60;

const OTP_REQUEST_WINDOW_SECONDS = 300;
const MAX_OTP_REQUESTS_PER_WINDOW = 3;

type AuthEnv = Env & {
  STAFF_PHONE?: string;
  OWNER_PHONE_1?: string;
  OWNER_PHONE_2?: string;

  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER_EMAIL?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function errorResponse(
  error: string,
  message: string,
  status: number,
): Response {
  return json(
    {
      ok: false,
      error,
      message,
    },
    status,
  );
}

function isPhone(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.replace(/[^\d+]/g, "").length >= 8 &&
    value.length <= MAX_PHONE
  );
}

function isEmail(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_EMAIL
  ) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value.trim(),
  );
}

function isOtp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === MAX_OTP &&
    /^\d{6}$/.test(value)
  );
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  return digits.length <= 4
    ? "****"
    : `${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

async function resolveRole(
  env: AuthEnv,
  phone: string,
): Promise<UserRole> {
  const target = await hashPhone(phone);

  const candidates: Array<
    [UserRole, string | undefined]
  > = [
    ["STAFF", env.STAFF_PHONE],
    ["OWNER", env.OWNER_PHONE_1],
    ["OWNER", env.OWNER_PHONE_2],
  ];

  for (const [role, secretPhone] of candidates) {
    if (!secretPhone) {
      continue;
    }

    const secretHash = await hashPhone(secretPhone);

    if (timingSafeEqual(target, secretHash)) {
      return role;
    }
  }

  return "CUSTOMER";
}

function gmailConfigured(env: AuthEnv): boolean {
  return Boolean(
    env.GMAIL_CLIENT_ID?.trim() &&
    env.GMAIL_CLIENT_SECRET?.trim() &&
    env.GMAIL_REFRESH_TOKEN?.trim() &&
    env.GMAIL_SENDER_EMAIL?.trim(),
  );
}

async function requestOtp(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  let body: {
    phone?: unknown;
    email?: unknown;
  };

  try {
    body = await request.json() as {
      phone?: unknown;
      email?: unknown;
    };
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (!isPhone(body.phone)) {
    return errorResponse(
      "INVALID_REQUEST",
      "Phone is required.",
      400,
    );
  }

  if (!isEmail(body.email)) {
    return errorResponse(
      "INVALID_REQUEST",
      "Email is required.",
      400,
    );
  }

  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const role = await resolveRole(env, phone);

  if (role !== "CUSTOMER") {
    return errorResponse(
      "OTP_NOT_REQUIRED",
      "Staff and Owner must login with phone number only.",
      400,
    );
  }

  if (!gmailConfigured(env)) {
    return errorResponse(
      "OTP_DELIVERY_UNAVAILABLE",
      "Gmail OTP delivery is not configured.",
      503,
    );
  }

  const phoneHash = await hashPhone(phone);

  await env.DB
    .prepare(
      `
      DELETE FROM auth_sessions
      WHERE session_id LIKE 'otp_%'
        AND expires_at <= ?
      `,
    )
    .bind(new Date().toISOString())
    .run();

  const recentCount =
    await countRecentOtpChallenges(
      env,
      phoneHash,
      OTP_REQUEST_WINDOW_SECONDS,
    );

  if (recentCount >= MAX_OTP_REQUESTS_PER_WINDOW) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many OTP requests. Try again later.",
      429,
    );
  }

  const { challenge, otp } =
    await createOtpChallenge(
      phone,
      "CUSTOMER",
      email,
    );

  await persistOtpChallenge(
    env,
    challenge,
  );

  try {
    await sendOtpEmail(
      {
        GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID!,
        GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET!,
        GMAIL_REFRESH_TOKEN: env.GMAIL_REFRESH_TOKEN!,
        GMAIL_SENDER_EMAIL: env.GMAIL_SENDER_EMAIL!,
      },
      email,
      otp,
    );
  } catch (error) {
    console.error(
      "GMAIL_OTP_DELIVERY_FAILED",
      error,
    );

    await consumeOtp(
      env,
      challenge.challengeId,
    );

    return errorResponse(
      "OTP_DELIVERY_UNAVAILABLE",
      "OTP delivery failed.",
      503,
    );
  }

  await writeAuditSafe(
    env,
    {
      entityType: "SESSION",
      entityId: challenge.challengeId,
      action: "CREATE",
      actor: phoneHash,
      result: "SUCCESS",
    },
  );

  return json(
    {
      ok: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
    },
    201,
  );
}

async function verifyOtpRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  let body: {
    challengeId?: unknown;
    phone?: unknown;
    email?: unknown;
    otp?: unknown;
  };

  try {
    body = await request.json() as {
      challengeId?: unknown;
      phone?: unknown;
      email?: unknown;
      otp?: unknown;
    };
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    typeof body.challengeId !== "string" ||
    body.challengeId.length > 128 ||
    !isPhone(body.phone) ||
    !isEmail(body.email) ||
    !isOtp(body.otp)
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "challengeId, phone, email and 6-digit OTP are required.",
      400,
    );
  }

  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);

  const submittedPhoneHash =
    await hashPhone(phone);

  const submittedEmailHash =
    await hashEmail(email);

  const challenge =
    await loadOtpChallenge(
      env,
      body.challengeId,
    );

  if (
    !challenge ||
    !timingSafeEqual(
      challenge.phoneHash,
      submittedPhoneHash,
    ) ||
    !challenge.emailHash ||
    !timingSafeEqual(
      challenge.emailHash,
      submittedEmailHash,
    )
  ) {
    return errorResponse(
      "OTP_INVALID_OR_EXPIRED",
      "OTP is invalid or expired.",
      401,
    );
  }

  const result =
    await verifyOtp(
      challenge,
      body.otp,
    );

  if (!result.valid) {
    if (result.reason === "OTP_INVALID") {
      const incremented =
        await incrementOtpAttempt(
          env,
          challenge,
        );

      if (!incremented) {
        return errorResponse(
          "OTP_ATTEMPTS_EXCEEDED",
          "OTP attempts exceeded. Request a new OTP.",
          401,
        );
      }
    }

    return errorResponse(
      result.reason ?? "OTP_INVALID",
      "OTP is invalid or expired.",
      401,
    );
  }

  const consumed =
    await consumeOtp(
      env,
      challenge.challengeId,
    );

  if (!consumed) {
    return errorResponse(
      "OTP_ALREADY_USED",
      "OTP has already been used.",
      409,
    );
  }

  const existing =
    await env.DB
      .prepare(
        `
        SELECT customer_id
        FROM customers
        WHERE phone_hash = ?
        LIMIT 1
        `,
      )
      .bind(challenge.phoneHash)
      .first<{
        customer_id: string;
      }>();

  const userId =
    existing?.customer_id ??
    `customer_${challenge.phoneHash.slice(0, 32)}`;

  await env.DB
    .prepare(
      `
      INSERT INTO customers (
        customer_id,
        phone_hash,
        phone_masked,
        created_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone_hash)
      DO UPDATE SET
        phone_masked = excluded.phone_masked
      `,
    )
    .bind(
      userId,
      challenge.phoneHash,
      maskPhone(phone),
      new Date().toISOString(),
    )
    .run();

  const session =
    await createAndPersistAuthSession(
      env,
      {
        userId,
        role: "CUSTOMER",
        ttlSeconds: CUSTOMER_SESSION_TTL,
      },
    );

  await writeAuditSafe(
    env,
    {
      entityType: "SESSION",
      entityId: session.sessionId,
      action: "CREATE",
      actor: userId,
      result: "SUCCESS",
    },
  );

  return json(
    {
      ok: true,
      token: session.token,
      role: session.role,
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
    200,
  );
}

async function loginStaffOwner(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  let body: {
    phone?: unknown;
  };

  try {
    body = await request.json() as {
      phone?: unknown;
    };
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (!isPhone(body.phone)) {
    return errorResponse(
      "INVALID_REQUEST",
      "Phone is required.",
      400,
    );
  }

  const phone = normalizePhone(body.phone);
  const role = await resolveRole(env, phone);

  if (role !== "STAFF" && role !== "OWNER") {
    return errorResponse(
      "UNAUTHORIZED",
      "Phone number is not authorized.",
      401,
    );
  }

  const phoneHash = await hashPhone(phone);

  const userId =
    `${role.toLowerCase()}_${phoneHash.slice(0, 32)}`;

  const session =
    await createAndPersistAuthSession(
      env,
      {
        userId,
        role,
        ttlSeconds: STAFF_SESSION_TTL,
      },
    );

  await writeAuditSafe(
    env,
    {
      entityType: "SESSION",
      entityId: session.sessionId,
      action: "CREATE",
      actor: userId,
      result: "SUCCESS",
    },
  );

  return json(
    {
      ok: true,
      token: session.token,
      role: session.role,
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
    200,
  );
}

export async function handleAuthRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const url = new URL(request.url);

  if (
    request.method === "POST" &&
    url.pathname === "/auth/request-otp"
  ) {
    return requestOtp(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/verify-otp"
  ) {
    return verifyOtpRequest(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/login"
  ) {
    return loginStaffOwner(request, env);
  }

  return errorResponse(
    "NOT_FOUND",
    "Auth endpoint not found.",
    404,
  );
}
