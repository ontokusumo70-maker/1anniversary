/*
 * ============================================================
 * PRODUCTION SESSION GUARD
 * Teras Laundry 1st Anniversary
 *
 * 3.10.2
 *
 * Tanggung jawab:
 * - mengambil Bearer token
 * - membaca session server-side dari D1
 * - memastikan session aktif dan belum expired
 * - memastikan role sesuai endpoint
 *
 * Tidak menggunakan X-Customer-ID,
 * X-Staff-ID, atau X-Owner-ID sebagai
 * sumber authentication production.
 * ============================================================
 */

import type { Env } from "../index";

export type SessionRole =
  | "CUSTOMER"
  | "STAFF"
  | "OWNER";

export type AuthSession = {
  sessionId: string;
  userId: string;
  role: SessionRole;
  expiresAt?: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  role: SessionRole;
  expires_at: string;
};

export function extractBearerToken(
  authorization:
    string | null,
): string | null {
  if (!authorization) {
    return null;
  }

  const value =
    authorization.trim();

  if (
    value.length === 0
  ) {
    return null;
  }

  const spaceIndex =
    value.indexOf(" ");

  if (
    spaceIndex <= 0
  ) {
    return null;
  }

  const scheme =
    value
      .slice(
        0,
        spaceIndex,
      )
      .trim();

  const token =
    value
      .slice(
        spaceIndex + 1,
      )
      .trim();

  if (
    scheme.toLowerCase() !==
      "bearer" ||
    token.length === 0
  ) {
    return null;
  }

  return token;
}

export function requireRole(
  session:
    AuthSession | null,
  allowedRoles:
    SessionRole[],
): boolean {
  if (!session) {
    return false;
  }

  return allowedRoles.includes(
    session.role,
  );
}

function isSessionExpired(
  expiresAt: string,
): boolean {
  const expiresAtMs =
    Date.parse(expiresAt);

  if (
    !Number.isFinite(
      expiresAtMs,
    )
  ) {
    return true;
  }

  return (
    expiresAtMs <=
    Date.now()
  );
}

async function hashToken(
  token: string,
): Promise<string> {
  const data =
    new TextEncoder().encode(
      token,
    );

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      data,
    );

  return Array.from(
    new Uint8Array(digest),
  )
    .map(
      (byte) =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("");
}

export async function getSession(
  request: Request,
  env: Env,
): Promise<AuthSession | null> {
  const token =
    extractBearerToken(
      request.headers.get(
        "Authorization",
      ),
    );

  if (!token) {
    return null;
  }

  const tokenHash =
    await hashToken(token);

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          session_id,
          user_id,
          role,
          expires_at
        FROM sessions
        WHERE session_id = ?
        LIMIT 1
        `,
      )
      .bind(tokenHash)
      .first<SessionRow>();

  if (!result) {
    return null;
  }

  if (
    isSessionExpired(
      result.expires_at,
    )
  ) {
    return null;
  }

  return {
    sessionId:
      result.session_id,
    userId:
      result.user_id,
    role:
      result.role,
    expiresAt:
      result.expires_at,
  };
}

export async function requireSession(
  request: Request,
  env: Env,
  allowedRoles:
    SessionRole[],
): Promise<AuthSession | null> {
  const session =
    await getSession(
      request,
      env,
    );

  if (
    !requireRole(
      session,
      allowedRoles,
    )
  ) {
    return null;
  }

  return session;
}
