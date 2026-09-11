import type { Env } from "../index";
import type { OtpChallenge, UserRole } from "./types";

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export async function hashPhone(phone: string): Promise<string> {
  return sha256(normalizePhone(phone));
}

export async function createOtpChallenge(
  phone: string,
  role: UserRole,
): Promise<{
  challenge: OtpChallenge;
  otp: string;
}> {
  const now = new Date();
  const expires = new Date(
    now.getTime() + OTP_TTL_SECONDS * 1000,
  );

  const otp = randomDigits(OTP_LENGTH);

  const challenge: OtpChallenge = {
    challengeId: crypto.randomUUID(),
    phoneHash: await hashPhone(phone),
    role,
    otpHash: await sha256(otp),
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    attempts: 0,
    consumed: false,
  };

  return {
    challenge,
    otp,
  };
}

export async function verifyOtp(
  challenge: OtpChallenge,
  otp: string,
): Promise<{
  valid: boolean;
  reason?: string;
}> {
  if (challenge.consumed) {
    return {
      valid: false,
      reason: "OTP_ALREADY_USED",
    };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return {
      valid: false,
      reason: "OTP_ATTEMPTS_EXCEEDED",
    };
  }

  if (Date.now() >= new Date(challenge.expiresAt).getTime()) {
    return {
      valid: false,
      reason: "OTP_EXPIRED",
    };
  }

  const submittedHash = await sha256(otp);

  if (submittedHash !== challenge.otpHash) {
    return {
      valid: false,
      reason: "OTP_INVALID",
    };
  }

  return {
    valid: true,
  };
}

export function incrementOtpAttempts(
  challenge: OtpChallenge,
): OtpChallenge {
  return {
    ...challenge,
    attempts: challenge.attempts + 1,
  };
}

export function consumeOtpChallenge(
  challenge: OtpChallenge,
): OtpChallenge {
  return {
    ...challenge,
    consumed: true,
  };
}

export function getOtpPolicy() {
  return {
    length: OTP_LENGTH,
    ttlSeconds: OTP_TTL_SECONDS,
    maxAttempts: MAX_ATTEMPTS,
  };
}
