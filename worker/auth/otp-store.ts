type OtpChallengeInsert = {
  challengeId: string; phoneHash: string; role: "CUSTOMER" | "STAFF" | "OWNER"; otpHash: string; createdAt: string; expiresAt: string; attempts: number;
};
export function buildOtpChallengeInsert(challenge: OtpChallengeInsert): { sql: string; params: Array<string | number> } {
  return { sql: `INSERT INTO otp_challenges (challenge_id, phone_hash, role, otp_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)`, params: [challenge.challengeId, challenge.phoneHash, challenge.role, challenge.otpHash, challenge.createdAt, challenge.expiresAt, challenge.attempts] };
}
export function buildOtpChallengeLookup(challengeId: string): { sql: string; params: string[] } {
  return { sql: `SELECT challenge_id, phone_hash, role, otp_hash, created_at, expires_at, attempts, consumed_at FROM otp_challenges WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1`, params: [challengeId, new Date().toISOString()] };
}
export function buildOtpChallengeConsume(challengeId: string, consumedAt: string): { sql: string; params: string[] } {
  return { sql: `UPDATE otp_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL`, params: [consumedAt, challengeId] };
}
