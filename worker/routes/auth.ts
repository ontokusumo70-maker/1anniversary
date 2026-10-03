import type { Env } from "../index";
import type { UserRole } from "../auth/types";
import { createAndPersistAuthSession, hashAuthSessionToken, revokeAuthSession } from "../auth/auth-session";
import { writeAuditSafe } from "../audit/logger";

const MAX_PHONE = 32;

const CUSTOMER_SESSION_TTL = 24 * 60 * 60;
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

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPhone(phone: string): Promise<string> {
  return sha256(normalizePhone(phone));
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

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Login/daftar customer dengan nama + nomor HP.
 * - Nomor belum terdaftar  -> akun dibuat (daftar).
 * - Nomor terdaftar tanpa nama (mis. dibuat Staff saat drop-off) -> nama diisi.
 * - Nomor terdaftar dengan nama -> nama harus sama (tanpa membedakan huruf besar/kecil),
 *   agar akun orang lain tidak bisa dibuka hanya dengan mengetahui nomor HP-nya.
 */
/**
 * Login / daftar customer dengan NAMA + NOMOR HP (tanpa email, tanpa OTP).
 *  - Nomor terdaftar dan nama cocok (atau nama masih kosong) -> langsung masuk.
 *  - Nomor terdaftar tetapi nama berbeda                     -> 403 NAME_MISMATCH.
 *  - Nomor belum terdaftar                                   -> { needsRegister: true }
 *    (akun BELUM dibuat; aplikasi menampilkan tombol "Daftar").
 *  - Nomor belum terdaftar + register: true                  -> akun dibuat lalu masuk.
 */
async function customerAccess(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  let body: { name?: unknown; phone?: unknown; register?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  const name = typeof body.name === "string" ? normalizeName(body.name) : "";
  if (name.length < 2 || name.length > 60) {
    return errorResponse("INVALID_REQUEST", "Nama wajib diisi (2–60 karakter).", 400);
  }
  if (!isPhone(body.phone)) {
    return errorResponse("INVALID_REQUEST", "Nomor HP tidak valid.", 400);
  }

  const phone = normalizePhone(body.phone);

  if ((await resolveRole(env, phone)) !== "CUSTOMER") {
    return errorResponse(
      "ROLE_NOT_CUSTOMER",
      "Nomor ini terdaftar untuk Staff/Owner. Gunakan halaman login Staff/Owner.",
      403,
    );
  }

  const phoneHash = await hashPhone(phone);
  const existing = await env.DB.prepare(`
    SELECT customer_id, name
    FROM customers
    WHERE phone_hash = ?
    LIMIT 1
  `).bind(phoneHash).first<{ customer_id: string; name: string | null }>();

  let userId: string;
  let created = false;

  if (existing) {
    const storedName = normalizeName(existing.name ?? "");
    if (storedName && storedName.toLowerCase() !== name.toLowerCase()) {
      return errorResponse("NAME_MISMATCH", "Nama tidak sesuai dengan nomor HP ini.", 403);
    }
    userId = existing.customer_id;
    await env.DB.prepare(`
      UPDATE customers
      SET phone_masked = ?, phone = ?, name = CASE WHEN name = '' OR name IS NULL THEN ? ELSE name END
      WHERE customer_id = ?
    `).bind(maskPhone(phone), phone, name, userId).run();
  } else {
    if (body.register !== true) {
      return json({ ok: true, needsRegister: true, phoneMasked: maskPhone(phone) });
    }
    userId = `customer_${phoneHash.slice(0, 32)}`;
    created = true;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO customers (
        customer_id, phone_hash, phone_masked, phone, name, email, created_at
      )
      VALUES (?, ?, ?, ?, ?, '', ?)
    `).bind(userId, phoneHash, maskPhone(phone), phone, name, new Date().toISOString()).run();
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
    created,
    name,
    phone,
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

async function logoutRequest(request: Request, env: AuthEnv): Promise<Response> {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.trim().match(/^Bearer\s+([A-Za-z0-9_-]{20,256})$/i);
  if (!match) return json({ ok: true }, 200);

  const tokenHash = await hashAuthSessionToken(match[1]);
  const session = await env.DB.prepare(`
    SELECT session_id, user_id, role
    FROM auth_sessions
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first<{ session_id: string; user_id: string; role: UserRole }>();

  if (!session) return json({ ok: true }, 200);

  await revokeAuthSession(env.DB, session.session_id);
  await writeAuditSafe(env, {
    entityType: "SESSION",
    entityId: session.session_id,
    action: "REVOKE",
    actor: session.user_id,
    result: "SUCCESS",
  });

  return json({ ok: true }, 200);
}

export async function handleAuthRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const url = new URL(request.url);

  if (
    request.method === "POST" &&
    url.pathname === "/auth/logout"
  ) {
    return logoutRequest(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/customer-access"
  ) {
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
