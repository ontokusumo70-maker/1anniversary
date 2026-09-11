import {
  strict as assert,
} from "node:assert";

import {
  buildAuthSessionInsert,
  buildAuthSessionLookup,
  buildAuthSessionRevoke,
} from "./auth-session-store";

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
  "insert auth session hanya menyimpan hash token",
  () => {
    const result =
      buildAuthSessionInsert({
        sessionId:
          "auth_session_001",
        tokenHash:
          "abcdef123456",
        userId:
          "customer_001",
        role:
          "CUSTOMER",
        createdAt:
          "2026-09-11T12:00:00.000Z",
        expiresAt:
          "2026-09-11T12:05:00.000Z",
      });

    assert.equal(
      result.sql.includes(
        "token_hash",
      ),
      true,
    );

    assert.equal(
      /(?:^|[\s,(])token\s*=/.test(result.sql),
      false,
    );

    assert.deepEqual(
      result.params,
      [
        "auth_session_001",
        "abcdef123456",
        "customer_001",
        "CUSTOMER",
        "2026-09-11T12:00:00.000Z",
        "2026-09-11T12:05:00.000Z",
      ],
    );
  },
);

test(
  "lookup hanya mencari session aktif berdasarkan token hash",
  () => {
    const result =
      buildAuthSessionLookup(
        "abcdef123456",
      );

    assert.equal(
      result.sql.includes(
        "token_hash = ?",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "revoked_at IS NULL",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "expires_at > ?",
      ),
      true,
    );

    assert.deepEqual(
      result.params.length,
      2,
    );

    assert.equal(
      result.params[0],
      "abcdef123456",
    );
  },
);

test(
  "revoke menggunakan session_id",
  () => {
    const result =
      buildAuthSessionRevoke(
        "auth_session_001",
        "2026-09-11T12:03:00.000Z",
      );

    assert.equal(
      result.sql.includes(
        "revoked_at = ?",
      ),
      true,
    );

    assert.equal(
      result.sql.includes(
        "session_id = ?",
      ),
      true,
    );

    assert.deepEqual(
      result.params,
      [
        "2026-09-11T12:03:00.000Z",
        "auth_session_001",
      ],
    );
  },
);

console.log(
  "3.10.2B Auth Session Store tests completed.",
);
