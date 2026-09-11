import { strict as assert } from "node:assert";
import { createAuthSessionRecord, getAuthSessionByTokenHash, revokeAuthSession } from "./auth-session";

const calls: string[] = [];
const db = {
  prepare(sql: string) {
    calls.push(sql);
    return {
      bind(..._args: unknown[]) {
        return {
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } }),
        };
      },
    };
  },
} as unknown as D1Database;

(async () => {
const record = await createAuthSessionRecord({ userId: "customer_001", role: "CUSTOMER", ttlSeconds: 300 });
assert.equal(record.userId, "customer_001");
assert.equal(record.role, "CUSTOMER");
assert.equal(record.tokenHash.length, 64);
assert.notEqual(record.token, record.tokenHash);
assert.equal(await getAuthSessionByTokenHash(db, "hash_001"), null);
assert.equal(await revokeAuthSession(db, "session_001"), false);
assert.equal(calls.length, 2);
  console.log("Auth session persistence tests PASS");
})();

