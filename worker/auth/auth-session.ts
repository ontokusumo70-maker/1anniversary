import type { Env } from "../index";
import type { UserRole } from "./types";

export type AuthSessionRecord = {
  sessionId: string;
  tokenHash: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type CreatedAuthSession = {
  sessionId: string;
  token: string;
  tokenHash: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
};

const AUTH_TOKEN_BYTES = 32;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createAuthSessionToken(): string {
  const bytes =
    new Uint8Array(
      AUTH_TOKEN_BYTES,
    );

  crypto.getRandomValues(bytes);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(
      byte,
    );
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function hashAuthSessionToken(
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

export function isAuthSessionExpired(
  record: AuthSessionRecord,
): boolean {
  if (record.revokedAt !== null) {
    return true;
  }

  const expiresAt =
    Date.parse(
      record.expiresAt,
    );

  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt <= Date.now();
}

export async function createAuthSessionRecord(
  input: {
    userId: string;
    role: UserRole;
    ttlSeconds?: number;
  },
): Promise<CreatedAuthSession> {
  const userId =
    input.userId.trim();

  if (!userId) {
    throw new Error(
      "INVALID_USER_ID",
    );
  }

  const ttlSeconds =
    Math.min(
      Math.max(
        Math.floor(
          input.ttlSeconds ??
            DEFAULT_TTL_SECONDS,
        ),
        1,
      ),
      MAX_TTL_SECONDS,
    );

  const now =
    new Date();

  const expires =
    new Date(
      now.getTime() +
        ttlSeconds * 1000,
    );

  const sessionId =
    `auth_${crypto.randomUUID()}`;

  const token =
    createAuthSessionToken();

  const tokenHash =
    await hashAuthSessionToken(
      token,
    );

  return {
    sessionId,
    token,
    tokenHash,
    userId,
    role: input.role,
    createdAt:
      now.toISOString(),
    expiresAt:
      expires.toISOString(),
  };
}

export async function persistAuthSession(
  env: Env,
  session: CreatedAuthSession,
): Promise<void> {
  await env.DB
    .prepare(
      `
      INSERT INTO auth_sessions (
        session_id,
        token_hash,
        user_id,
        role,
        created_at,
        expires_at,
        revoked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      `,
    )
    .bind(
      session.sessionId,
      session.tokenHash,
      session.userId,
      session.role,
      session.createdAt,
      session.expiresAt,
    )
    .run();
}

export async function getAuthSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<AuthSessionRecord | null> {
  const result =
    await db
      .prepare(
        `
        SELECT
          session_id,
          token_hash,
          user_id,
          role,
          created_at,
          expires_at,
          revoked_at
        FROM auth_sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        LIMIT 1
        `,
      )
      .bind(
        tokenHash,
        new Date().toISOString(),
      )
      .first<AuthSessionRecord>();

  return result ?? null;
}

export async function revokeAuthSession(
  db: D1Database,
  sessionId: string,
): Promise<boolean> {
  const result =
    await db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = ?
        WHERE session_id = ?
          AND revoked_at IS NULL
        `,
      )
      .bind(
        new Date().toISOString(),
        sessionId,
      )
      .run();

  return (
    (result.meta?.changes ?? 0) > 0
  );
}

export async function createAndPersistAuthSession(
  env: Env,
  input: {
    userId: string;
    role: UserRole;
    ttlSeconds?: number;
  },
): Promise<CreatedAuthSession> {
  const session =
    await createAuthSessionRecord(
      input,
    );

  await persistAuthSession(
    env,
    session,
  );

  return session;
}
