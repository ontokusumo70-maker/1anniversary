import { strict as assert } from "node:assert";
import { buildOtpChallengeInsert, buildOtpChallengeLookup, buildOtpChallengeConsume, buildOtpAttemptIncrement } from "./otp-store";

const challenge = { challengeId: "challenge_001", phoneHash: "phone_hash_001", role: "CUSTOMER" as const, otpHash: "otp_hash_001", createdAt: "2026-09-11T12:00:00.000Z", expiresAt: "2026-09-11T12:05:00.000Z", attempts: 0, consumed: false };
const insert = buildOtpChallengeInsert(challenge);
assert.match(insert.sql, /auth_sessions/);
assert.equal(insert.sql.includes("otp_plaintext"), false);
assert.equal(insert.params.includes("123456"), false);
const lookup = buildOtpChallengeLookup(challenge.challengeId);
assert.match(lookup.sql, /session_id LIKE 'otp_%'/);
assert.match(lookup.sql, /revoked_at IS NULL/);
const consume = buildOtpChallengeConsume(challenge.challengeId, "2026-09-11T12:01:00.000Z");
assert.match(consume.sql, /revoked_at = \?/);
assert.match(consume.sql, /revoked_at IS NULL/);
console.log("OTP store tests PASS");

const attemptUpdate = buildOtpAttemptIncrement({
  sessionId: `otp_${challenge.challengeId}`,
  phoneHash: challenge.phoneHash,
  otpHash: challenge.otpHash,
  attempts: 0,
});
assert.ok(attemptUpdate, "atomic OTP attempt update contract missing");
assert.match(attemptUpdate.sql, /AND user_id = \?/);
assert.equal(attemptUpdate.params.length, 4);
