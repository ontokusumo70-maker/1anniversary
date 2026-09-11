/*
 * ============================================================
 * AUTH SESSION CORE
 * Teras Laundry 1st Anniversary
 *
 * 3.10.2A
 *
 * Auth session terpisah dari game session.
 * Tidak mengubah tabel sessions baseline.
 * ============================================================
 */

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

const AUTH_TOKEN_BYTES = 32;

export function createAuthSessionToken(): string {
  const bytes =
    new Uint8Array(
      AUTH_TOKEN_BYTES,
    );

  crypto.getRandomValues(bytes);

  let binary = "";

  for (
    const byte of bytes
  ) {
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
  if (
    record.revokedAt !== null
  ) {
    return true;
  }

  const expiresAt =
    Date.parse(
      record.expiresAt,
    );

  if (
    !Number.isFinite(
      expiresAt,
    )
  ) {
    return true;
  }

  return (
    expiresAt <=
    Date.now()
  );
}
