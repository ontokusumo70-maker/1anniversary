import type { Env } from "../index";
import type { UserRole } from "../auth/types";
import { createAndPersistAuthSession } from "../auth/auth-session";
import { writeAuditSafe } from "../audit/logger";

const MAX_PHONE = 32;
const MAX_EMAIL = 254;
const CUSTOMER_SESSION_TTL = 30 * 24 * 60 * 60;
const STAFF_SESSION_TTL = 8 * 60 * 60;

type AuthEnv = Env & {
  STAFF_PHONE?: string;
  OWNER_PHONE_1?: string;
  OWNER_PHONE_2?: string;
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


function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}


async function hashPhone(phone: string): Promise<string> {
  const data = new TextEncoder().encode(normalizePhone(phone));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

async function identifyAuthMode(
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

  return json({
    ok: true,
    mode:
      role === "STAFF" || role === "OWNER"
        ? "STAFF_OWNER"
        : "CUSTOMER",
  });
}

async function customerAccess(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  let body: {
    phone?: unknown;
    email?: unknown;
  } = {};

  try {
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.trim()) {
        body = JSON.parse(raw) as { phone?: unknown; email?: unknown };
      }
    }
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  const hasIdentity = body.phone !== undefined || body.email !== undefined;

  if (!hasIdentity) {
    const guestId = `guest_${crypto.randomUUID()}`;
    const session = await createAndPersistAuthSession(env, {
      userId: guestId,
      role: "CUSTOMER",
      ttlSeconds: CUSTOMER_SESSION_TTL,
    });

    return json({
      ok: true,
      guest: true,
      token: session.token,
      role: session.role,
      userId: session.userId,
      expiresAt: session.expiresAt,
    });
  }

  if (!isPhone(body.phone) || !isEmail(body.email)) {
    return errorResponse(
      "INVALID_REQUEST",
      "Nomor HP dan email wajib diisi.",
      400,
    );
  }

  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const phoneHash = await hashPhone(phone);

  const exact = await env.DB.prepare(`
    SELECT customer_id
    FROM customers
    WHERE phone_hash = ? AND lower(email) = lower(?)
    LIMIT 1
  `).bind(phoneHash, email).first<{ customer_id: string }>();

  let userId = exact?.customer_id ?? null;

  if (!userId) {
    const phoneOwner = await env.DB.prepare(`
      SELECT customer_id, email
      FROM customers
      WHERE phone_hash = ?
      LIMIT 1
    `).bind(phoneHash).first<{ customer_id: string; email: string }>();

    if (phoneOwner && normalizeEmail(phoneOwner.email) !== email) {
      return errorResponse(
        "CUSTOMER_IDENTITY_MISMATCH",
        "Data customer tidak cocok.",
        409,
      );
    }

    const emailOwners = await env.DB.prepare(`
      SELECT customer_id
      FROM customers
      WHERE lower(email) = lower(?)
      LIMIT 2
    `).bind(email).all<{ customer_id: string }>();

    const owners = emailOwners.results ?? [];

    if (owners.length > 1) {
      return errorResponse(
        "CUSTOMER_IDENTITY_AMBIGUOUS",
        "Email terdaftar pada lebih dari satu customer.",
        409,
      );
    }

    if (owners.length === 1) {
      userId = owners[0].customer_id;
      await env.DB.prepare(`
        UPDATE customers
        SET phone_hash = ?, phone_masked = ?, email = ?
        WHERE customer_id = ?
      `).bind(phoneHash, maskPhone(phone), email, userId).run();
    }
  }

  if (!userId) {
    userId = `customer_${phoneHash.slice(0, 32)}`;
    await env.DB.prepare(`
      INSERT INTO customers (
        customer_id,
        phone_hash,
        phone_masked,
        name,
        email,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      phoneHash,
      maskPhone(phone),
      "",
      email,
      new Date().toISOString(),
    ).run();
  } else {
    await env.DB.prepare(`
      UPDATE customers
      SET phone_masked = ?, email = ?
      WHERE customer_id = ?
    `).bind(maskPhone(phone), email, userId).run();
  }

  const session = await createAndPersistAuthSession(env, {
    userId,
    role: "CUSTOMER",
    ttlSeconds: CUSTOMER_SESSION_TTL,
  });

  await writeAuditSafe(env, {
    entityType: "SESSION",
    entityId: session.sessionId,
    action: "CREATE",
    actor: userId,
    result: "SUCCESS",
  });

  return json({
    ok: true,
    guest: false,
    token: session.token,
    role: session.role,
    userId: session.userId,
    expiresAt: session.expiresAt,
  });
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
    url.pathname === "/auth/mode"
  ) {
    return identifyAuthMode(request, env);
  }

  if (request.method === "POST" && url.pathname === "/auth/customer-access") {
    return customerAccess(request, env);
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
