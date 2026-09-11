import { strict as assert } from "node:assert";
import { buildOtpChallengeInsert, buildOtpChallengeLookup, buildOtpChallengeConsume } from "../auth/otp-store";

const challenge={challengeId:"challenge-1",phoneHash:"phone-hash",role:"CUSTOMER" as const,otpHash:"otp-hash",createdAt:"2026-09-11T00:00:00.000Z",expiresAt:"2026-09-11T00:05:00.000Z",attempts:0,consumed:false};
const insert=buildOtpChallengeInsert(challenge);assert.match(insert.sql,/auth_sessions/);assert.equal(insert.params.includes("123456"),false);
const lookup=buildOtpChallengeLookup(challenge.challengeId);assert.match(lookup.sql,/session_id LIKE 'otp_%'/);assert.match(lookup.sql,/expires_at > \?/);
const consume=buildOtpChallengeConsume(challenge.challengeId,"2026-09-11T00:01:00.000Z");assert.match(consume.sql,/revoked_at IS NULL/);
console.log("Auth route/store contract PASS");
