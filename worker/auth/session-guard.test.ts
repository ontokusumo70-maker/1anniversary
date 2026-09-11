import {
  strict as assert,
} from "node:assert";

import {
  extractBearerToken,
  requireRole,
  type AuthSession,
} from "./session-guard";

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

const customerSession: AuthSession = {
  sessionId: "session_customer_001",
  userId: "customer_001",
  role: "CUSTOMER",
};

const staffSession: AuthSession = {
  sessionId: "session_staff_001",
  userId: "staff_001",
  role: "STAFF",
};

const ownerSession: AuthSession = {
  sessionId: "session_owner_001",
  userId: "owner_001",
  role: "OWNER",
};

test(
  "extractBearerToken mengambil token Bearer",
  () => {
    assert.equal(
      extractBearerToken(
        "Bearer abc123",
      ),
      "abc123",
    );
  },
);

test(
  "extractBearerToken menolak header tanpa Bearer",
  () => {
    assert.equal(
      extractBearerToken(
        "abc123",
      ),
      null,
    );

    assert.equal(
      extractBearerToken(
        null,
      ),
      null,
    );
  },
);

test(
  "requireRole menerima role yang diizinkan",
  () => {
    assert.equal(
      requireRole(
        customerSession,
        ["CUSTOMER"],
      ),
      true,
    );

    assert.equal(
      requireRole(
        staffSession,
        ["STAFF"],
      ),
      true,
    );

    assert.equal(
      requireRole(
        ownerSession,
        ["OWNER"],
      ),
      true,
    );
  },
);

test(
  "requireRole menolak role yang tidak diizinkan",
  () => {
    assert.equal(
      requireRole(
        customerSession,
        ["STAFF", "OWNER"],
      ),
      false,
    );

    assert.equal(
      requireRole(
        staffSession,
        ["OWNER"],
      ),
      false,
    );

    assert.equal(
      requireRole(
        ownerSession,
        ["CUSTOMER", "STAFF"],
      ),
      false,
    );
  },
);

test(
  "session identity tidak dapat digantikan oleh role lain",
  () => {
    assert.equal(
      requireRole(
        {
          ...customerSession,
          role: "OWNER",
        },
        ["OWNER"],
      ),
      true,
    );

    assert.equal(
      requireRole(
        {
          ...customerSession,
          role: "OWNER",
        },
        ["CUSTOMER"],
      ),
      false,
    );
  },
);

console.log(
  "3.10.2 Session Guard tests completed.",
);
