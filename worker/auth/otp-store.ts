import type { Env } from "../index";
import type { OtpChallenge, UserRole } from "./types";

const OTP_PREFIX = "OTP|";

export type StoredOtp = OtpChallenge & { sessionId: string };

function encodeUserId(
  phoneHash: string,
  emailHash: string | undefined,
  otpHash: string,
  attempts: number,
): string {
  return `${OTP_PREFIX}${phoneHash}|${emailHash ?? ""}|${otpHash}|${attempts}`;
}

function decodeUserId(
  value: string,
): {
  phoneHash: string;
  emailHash?: string;
  otpHash: string;
  attempts: number;
} | null {
  if (!value.startsWith(OTP_PREFIX)) return null;

  const parts = value.slice(OTP_PREFIX.length).split("|");

  // New format:
  // OTP|phoneHash|emailHash|otpHash|attempts
  if (parts.length === 4) {
    const attempts = Number(parts[3]);

    if (
      !parts[0] ||
      !parts[2] ||
      !Number.isInteger(attempts) ||
      attempts < 0
    ) {
      return null;
    }

    return {
      phoneHash: parts[0],
      emailHash: parts[1] || undefined,
      otpHash: parts[2],
      attempts,
    };
  }

  // Backward-compatible old format:
  // OTP|phoneHash|otpHash|attempts
  if (parts.length === 3) {
    const attempts = Number(parts[2]);

    if (
      !parts[0] ||
      !parts[1] ||
      !Number.isInteger(attempts) ||
      attempts < 0
    ) {
      return null;
    }

    return {
      phoneHash: parts[0],
      otpHash: parts[1],
      attempts,
    };
  }

  return null;
}

export function buildOtpChallengeInsert(
  challenge: OtpChallenge,
): {
  sql: string;
  params: Array<string | number>;
} {
  return {
    sql: `INSERT INTO auth_sessions (session_id, token_hash, user_id, role, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    params: [
      `otp_${challenge.challengeId}`,
      challenge.otpHash,
      encodeUserId(
        challenge.phoneHash,
        challenge.emailHash,
        challenge.otpHash,
        challenge.attempts,
      ),
      challenge.role,
      challenge.createdAt,
      challenge.expiresAt,
    ],
  };
}

export function buildOtpChallengeLookup(
  challengeId: string,
): {
  sql: string;
  params: string[];
} {
  return {
    sql: `SELECT session_id, token_hash, user_id, role, created_at, expires_at, revoked_at FROM auth_sessions WHERE session_id = ? AND session_id LIKE 'otp_%' AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
    params: [
      `otp_${challengeId}`,
      new Date().toISOString(),
    ],
  };
}

export function buildOtpChallengeConsume(
  challengeId: string,
  consumedAt: string,
): {
  sql: string;
  params: string[];
} {
  return {
    sql: `UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND session_id LIKE 'otp_%' AND revoked_at IS NULL`,
    params: [
      consumedAt,
      `otp_${challengeId}`,
    ],
  };
}

export async function persistOtpChallenge(
  env: Env,
  challenge: OtpChallenge,
): Promise<void> {
  const q = buildOtpChallengeInsert(challenge);

  await env.DB
    .prepare(q.sql)
    .bind(...q.params)
    .run();
}

export async function loadOtpChallenge(
  env: Env,
  challengeId: string,
): Promise<StoredOtp | null> {
  const q = buildOtpChallengeLookup(challengeId);

  const row = await env.DB
    .prepare(q.sql)
    .bind(...q.params)
    .first<{
      session_id: string;
      token_hash: string;
      user_id: string;
      role: UserRole;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>();

  if (!row) return null;

  const decoded = decodeUserId(row.user_id);

  if (!decoded) return null;

  return {
    challengeId: row.session_id.slice("otp_".length),
    phoneHash: decoded.phoneHash,
    ...(decoded.emailHash
      ? { emailHash: decoded.emailHash }
      : {}),
    role: row.role,
    otpHash: decoded.otpHash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    attempts: decoded.attempts,
    consumed: row.revoked_at !== null,
    sessionId: row.session_id,
  };
}

export function buildOtpAttemptIncrement(
  challenge: Pick<
    StoredOtp,
    "sessionId" |
    "phoneHash" |
    "emailHash" |
    "otpHash" |
    "attempts"
  >,
): {
  sql: string;
  params: string[];
} {
  const next = challenge.attempts + 1;

  return {
    sql: `UPDATE auth_sessions
          SET user_id = ?
          WHERE session_id = ?
            AND user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?`,
    params: [
      encodeUserId(
        challenge.phoneHash,
        challenge.emailHash,
        challenge.otpHash,
        next,
      ),
      challenge.sessionId,
      encodeUserId(
        challenge.phoneHash,
        challenge.emailHash,
        challenge.otpHash,
        challenge.attempts,
      ),
      new Date().toISOString(),
    ],
  };
}

export async function incrementOtpAttempt(
  env: Env,
  challenge: StoredOtp,
): Promise<boolean> {
  const q = buildOtpAttemptIncrement(challenge);

  const result = await env.DB
    .prepare(q.sql)
    .bind(...q.params)
    .run();

  return (result.meta?.changes ?? 0) === 1;
}

export async function consumeOtp(
  env: Env,
  challengeId: string,
): Promise<boolean> {
  const q = buildOtpChallengeConsume(
    challengeId,
    new Date().toISOString(),
  );

  const result = await env.DB
    .prepare(q.sql)
    .bind(...q.params)
    .run();

  return (result.meta?.changes ?? 0) === 1;
}

export async function countRecentOtpChallenges(
  env: Env,
  phoneHash: string,
  windowSeconds = 300,
): Promise<number> {
  const since = new Date(
    Date.now() - windowSeconds * 1000,
  ).toISOString();

  const result = await env.DB
    .prepare(
      `SELECT COUNT(*) AS count
       FROM auth_sessions
       WHERE session_id LIKE 'otp_%'
       AND user_id LIKE ?
       AND created_at >= ?`,
    )
    .bind(
      `${OTP_PREFIX}${phoneHash}|%`,
      since,
    )
    .first<{ count: number }>();

  return Number(result?.count ?? 0);
}
