import {
  strict as assert,
} from "node:assert";

import {
  csvEscape,
  buildCsv,
} from "./export";

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
  "csvEscape menangani koma, quote, dan newline",
  () => {
    assert.equal(
      csvEscape("Customer"),
      "Customer",
    );

    assert.equal(
      csvEscape("A, B"),
      '"A, B"',
    );

    assert.equal(
      csvEscape('A "reward"'),
      '"A ""reward"""',
    );

    assert.equal(
      csvEscape("Line 1\nLine 2"),
      '"Line 1\nLine 2"',
    );
  },
);

test(
  "buildCsv membuat header dan rows dengan benar",
  () => {
    const csv =
      buildCsv(
        [
          "customer_id",
          "phone",
          "status",
        ],
        [
          [
            "customer_001",
            "081234567890",
            "ACTIVE",
          ],
          [
            "customer_002",
            "081111111111",
            "ACTIVE",
          ],
        ],
      );

    assert.equal(
      csv,
      [
        "customer_id,phone,status",
        "customer_001,081234567890,ACTIVE",
        "customer_002,081111111111,ACTIVE",
      ].join("\r\n") +
        "\r\n",
    );
  },
);

test(
  "buildCsv menghindari raw QR secret",
  () => {
    const csv =
      buildCsv(
        [
          "reward_id",
          "token_ref",
          "status",
        ],
        [
          [
            "reward_001",
            "SAFE_REFERENCE_ONLY",
            "CLAIMED",
          ],
        ],
      );

    assert.ok(
      csv.includes(
        "SAFE_REFERENCE_ONLY",
      ),
    );

    assert.ok(
      !csv.includes(
        "raw-secret-token",
      ),
    );
  },
);

console.log(
  "CSV Export 3.9.1 tests completed.",
);
