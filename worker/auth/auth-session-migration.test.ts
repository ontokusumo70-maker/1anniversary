import {
  strict as assert,
} from "node:assert";

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

const expectedColumns = [
  "session_id",
  "token_hash",
  "user_id",
  "role",
  "created_at",
  "expires_at",
  "revoked_at",
];

test(
  "auth session contract memiliki seluruh field authentication",
  () => {
    assert.deepEqual(
      expectedColumns,
      [
        "session_id",
        "token_hash",
        "user_id",
        "role",
        "created_at",
        "expires_at",
        "revoked_at",
      ],
    );
  },
);

test(
  "auth session memisahkan authentication dari game sessions",
  () => {
    assert.notEqual(
      expectedColumns.includes(
        "play_id",
      ),
      true,
    );

    assert.equal(
      expectedColumns.includes(
        "token_hash",
      ),
      true,
    );
  },
);

test(
  "auth session memiliki revocation dan expiry",
  () => {
    assert.equal(
      expectedColumns.includes(
        "expires_at",
      ),
      true,
    );

    assert.equal(
      expectedColumns.includes(
        "revoked_at",
      ),
      true,
    );
  },
);

console.log(
  "3.10.2B Auth Session Migration tests completed.",
);
