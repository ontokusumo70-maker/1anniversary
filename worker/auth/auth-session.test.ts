import {
  strict as assert,
} from "node:assert";

import {
  createAuthSessionToken,
  hashAuthSessionToken,
  isAuthSessionExpired,
  type AuthSessionRecord,
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
  "createAuthSessionToken menghasilkan opaque token",
  () => {
    const token =
      createAuthSessionToken();

    assert.equal(
      typeof token,
      "string",
    );

    assert.ok(
      token.length >= 32,
    );

    assert.equal(
      token.includes(
        "customer",
      ),
      false,
    );

    assert.equal(
      token.includes(
        "OWNER",
      ),
      false,
    );
  },
);

test(
  "createAuthSessionToken menghasilkan token berbeda",
  () => {
    const first =
      createAuthSessionToken();

    const second =
      createAuthSessionToken();

    assert.notEqual(
      first,
      second,
    );
  },
);

test(
  "hashAuthSessionToken konsisten",
  async () => {
    const token =
      createAuthSessionToken();

    const first =
      await hashAuthSessionToken(
        token,
      );

    const second =
      await hashAuthSessionToken(
        token,
      );

    assert.equal(
      first,
      second,
    );

    assert.notEqual(
      first,
      token,
    );
  },
);

test(
  "session aktif sebelum expires_at",
  () => {
    const record:
      AuthSessionRecord = {
      sessionId:
        "auth_session_001",
      tokenHash:
        "hash",
      userId:
        "customer_001",
      role:
        "CUSTOMER",
      createdAt:
        new Date(
          Date.now() - 60_000,
        ).toISOString(),
      expiresAt:
        new Date(
          Date.now() + 300_000,
        ).toISOString(),
      revokedAt:
        null,
    };

    assert.equal(
      isAuthSessionExpired(
        record,
      ),
      false,
    );
  },
);

test(
  "session expired setelah expires_at",
  () => {
    const record:
      AuthSessionRecord = {
      sessionId:
        "auth_session_002",
      tokenHash:
        "hash",
      userId:
        "customer_002",
      role:
        "CUSTOMER",
      createdAt:
        new Date(
          Date.now() - 600_000,
        ).toISOString(),
      expiresAt:
        new Date(
          Date.now() - 60_000,
        ).toISOString(),
      revokedAt:
        null,
    };

    assert.equal(
      isAuthSessionExpired(
        record,
      ),
      true,
    );
  },
);

test(
  "session revoked dianggap expired",
  () => {
    const record:
      AuthSessionRecord = {
      sessionId:
        "auth_session_003",
      tokenHash:
        "hash",
      userId:
        "staff_001",
      role:
        "STAFF",
      createdAt:
        new Date(
          Date.now() - 60_000,
        ).toISOString(),
      expiresAt:
        new Date(
          Date.now() + 300_000,
        ).toISOString(),
      revokedAt:
        new Date().toISOString(),
    };

    assert.equal(
      isAuthSessionExpired(
        record,
      ),
      true,
    );
  },
);

console.log(
  "3.10.2A Auth Session tests defined.",
);
