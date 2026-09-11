import {
  strict as assert,
} from "node:assert";

import {
  createAuthSessionRecord,
  getAuthSessionByTokenHash,
  revokeAuthSession,
} from "./auth-session";

function test(
  name: string,
  fn: () => void | Promise<void>,
): void {
  Promise.resolve()
    .then(fn)
    .then(
      () =>
        console.log(
          `PASS: ${name}`,
        ),
      (error) => {
        console.error(
          `FAIL: ${name}`,
          error,
        );
        throw error;
      },
    );
}

test(
  "createAuthSessionRecord menghasilkan record server-side",
  async () => {
    const record =
      await createAuthSessionRecord(
        {
          userId:
            "customer_001",
          role:
            "CUSTOMER",
          ttlSeconds:
            300,
        },
      );

    assert.equal(
      record.userId,
      "customer_001",
    );

    assert.equal(
      record.role,
      "CUSTOMER",
    );

    assert.ok(
      record.sessionId.length > 0,
    );

    assert.ok(
      record.token.length >= 32,
    );

    assert.ok(
      record.tokenHash.length ===
        64,
    );

    assert.notEqual(
      record.token,
      record.tokenHash,
    );
  },
);

test(
  "getAuthSessionByTokenHash memiliki kontrak lookup D1",
  async () => {
    const result =
      await getAuthSessionByTokenHash(
        {} as D1Database,
        "hash_001",
      );

    assert.equal(
      result,
      null,
    );
  },
);

test(
  "revokeAuthSession memiliki kontrak revoke D1",
  async () => {
    const result =
      await revokeAuthSession(
        {} as D1Database,
        "session_001",
      );

    assert.equal(
      result,
      false,
    );
  },
);

console.log(
  "3.10.2B Auth Session Persistence tests completed.",
);
