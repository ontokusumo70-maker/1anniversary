import {
  strict as assert,
} from "node:assert";

import {
  buildOtpChallengeInsert,
  buildOtpChallengeLookup,
  buildOtpChallengeConsume,
} from "./otp-store";

function test(
  name: string,
  fn: () => void,
): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(
      `FAIL: ${name}`,
      error,
    );
    throw error;
  }
}

test(
  "OTP challenge insert tidak menyimpan OTP plaintext",
  () => {
    const result =
      buildOtpChallengeInsert({
        challengeId:
          "challenge_001",
        phoneHash:
          "phone_hash_001",
        role:
          "CUSTOMER",
        otpHash:
          "otp_hash_001",
        createdAt:
          "2026-09-11T12:00:00.000Z",
        expiresAt:
          "2026-09-11T12:05:00.000Z",
        attempts: 0,
      });

    assert.equal(
      result.sql.includes(
        "otp_hash",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "otp",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "otp_plaintext",
      ),
      false,
    );

    assert.deepEqual(
      result.params,
      [
        "challenge_001",
        "phone_hash_001",
        "CUSTOMER",
        "otp_hash_001",
        "2026-09-11T12:00:00.000Z",
        "2026-09-11T12:05:00.000Z",
        0,
      ],
    );
  },
);

test(
  "OTP lookup hanya mengambil challenge aktif",
  () => {
    const result =
      buildOtpChallengeLookup(
        "challenge_001",
      );

    assert.equal(
      result.sql.includes(
        "challenge_id = ?",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "consumed_at IS NULL",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "expires_at > ?",
      ),
      true,
    );

    assert.equal(
      result.params[0],
      "challenge_001",
    );
  },
);

test(
  "OTP consume mencegah penggunaan ulang",
  () => {
    const result =
      buildOtpChallengeConsume(
        "challenge_001",
        "2026-09-11T12:01:00.000Z",
      );

    assert.equal(
      result.sql.includes(
        "consumed_at = ?",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "challenge_id = ?",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "consumed_at IS NULL",
      ),
      true,
    );

    assert.deepEqual(
      result.params,
      [
        "2026-09-11T12:01:00.000Z",
        "challenge_001",
      ],
    );
  },
);

console.log(
  "3.10.2C.1 OTP Store tests completed.",
);
