import { strict as assert } from "node:assert";
import { getSession, requireRole, extractBearerToken } from "./session-guard";
import type { Env } from "../index";

assert.equal(extractBearerToken("Bearer abc123"), "abc123");
assert.equal(extractBearerToken("Basic abc123"), null);
assert.equal(requireRole({sessionId:"s",userId:"u",role:"CUSTOMER",expiresAt:"2099-01-01T00:00:00.000Z"}, ["CUSTOMER"]), true);
assert.equal(requireRole({sessionId:"s",userId:"u",role:"CUSTOMER",expiresAt:"2099-01-01T00:00:00.000Z"}, ["OWNER"]), false);

const db = {
  prepare(sql: string) {
    assert.match(sql, /FROM auth_sessions/);
    return {
      bind(...args: unknown[]) {
        assert.equal(args.length, 2);
        return { first: async () => null };
      },
    };
  },
} as unknown as D1Database;

const env = { DB: db } as Env;
const request = new Request("https://example.test/", { headers: { Authorization: "Bearer abc123" } });

(async () => {
  const session = await getSession(request, env);
  assert.equal(session, null);
  console.log("Session guard tests PASS");
})();
