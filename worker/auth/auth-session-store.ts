/*
 * ============================================================
 * AUTH SESSION STORE
 * Teras Laundry 1st Anniversary
 *
 * 3.10.2B
 *
 * Hanya menangani SQL contract untuk auth_sessions.
 * Tidak menggunakan tabel sessions game.
 * ============================================================
 */

import type { UserRole } from "./types";

export type AuthSessionInsert = {
  sessionId: string;
  tokenHash: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
};

export function buildAuthSessionInsert(
  session: AuthSessionInsert,
): {
  sql: string;
  params: string[];
} {
  return {
    sql: `
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
    params: [
      session.sessionId,
      session.tokenHash,
      session.userId,
      session.role,
      session.createdAt,
      session.expiresAt,
    ],
  };
}

export function buildAuthSessionLookup(
  tokenHash: string,
): {
  sql: string;
  params: string[];
} {
  return {
    sql: `
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
    params: [
      tokenHash,
      new Date().toISOString(),
    ],
  };
}

export function buildAuthSessionRevoke(
  sessionId: string,
  revokedAt: string,
): {
  sql: string;
  params: string[];
} {
  return {
    sql: `
      UPDATE auth_sessions
      SET revoked_at = ?
      WHERE session_id = ?
        AND revoked_at IS NULL
    `,
    params: [
      revokedAt,
      sessionId,
    ],
  };
}
