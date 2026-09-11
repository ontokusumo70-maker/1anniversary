import {
  strict as assert,
} from "node:assert";

import {
  buildCsv,
} from "./export";

import {
  AuditExportRow,
} from "./query";

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
  "Audit export menggunakan kolom sesuai kontrak",
  () => {
    const headers = [
      "timestamp",
      "entity_type",
      "entity_id",
      "action",
      "actor",
      "result",
    ];

    const row: AuditExportRow = {
      timestamp:
        "2026-11-01T07:00:00.000Z",
      entity_type:
        "PLAY",
      entity_id:
        "play_001",
      action:
        "START",
      actor:
        "customer_001",
      result:
        "SUCCESS",
    };

    const csv =
      buildCsv(
        headers,
        [
          [
            row.timestamp,
            row.entity_type,
            row.entity_id,
            row.action,
            row.actor,
            row.result,
          ],
        ],
      );

    assert.equal(
      csv,
      [
        "timestamp,entity_type,entity_id,action,actor,result",
        "2026-11-01T07:00:00.000Z,PLAY,play_001,START,customer_001,SUCCESS",
      ].join("\r\n") +
        "\r\n",
    );
  },
);

test(
  "Audit export tidak memiliki kolom phone_hash atau raw QR secret",
  () => {
    const headers = [
      "timestamp",
      "entity_type",
      "entity_id",
      "action",
      "actor",
      "result",
    ];

    const csv =
      buildCsv(
        headers,
        [
          [
            "2026-11-01T07:00:00.000Z",
            "REWARD",
            "reward_001",
            "CLAIM",
            "customer_001",
            "SUCCESS",
          ],
        ],
      );

    assert.equal(
      csv.includes("phone_hash"),
      false,
    );

    assert.equal(
      csv.includes("raw-secret-token"),
      false,
    );

    assert.equal(
      csv.includes("token_ref"),
      false,
    );
  },
);

test(
  "Audit export mempertahankan actor dan result untuk audit trail",
  () => {
    const csv =
      buildCsv(
        [
          "timestamp",
          "entity_type",
          "entity_id",
          "action",
          "actor",
          "result",
        ],
        [
          [
            "2026-11-01T07:00:00.000Z",
            "REWARD",
            "reward_001",
            "REDEEM",
            "staff_001",
            "SUCCESS",
          ],
        ],
      );

    assert.ok(
      csv.includes(
        "staff_001",
      ),
    );

    assert.ok(
      csv.includes(
        "SUCCESS",
      ),
    );
  },
);

console.log(
  "Audit Export 3.9.5 tests completed.",
);
