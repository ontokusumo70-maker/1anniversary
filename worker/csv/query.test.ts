import {
  strict as assert,
} from "node:assert";

import {
  buildDateFilter,
  buildPagination,
  validateExportRange,
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
  "buildDateFilter tanpa range tidak menambahkan WHERE",
  () => {
    const result =
      buildDateFilter(
        undefined,
        undefined,
      );

    assert.equal(
      result.sql,
      "",
    );

    assert.deepEqual(
      result.params,
      [],
    );
  },
);

test(
  "buildDateFilter dengan from dan to membuat range",
  () => {
    const result =
      buildDateFilter(
        "2026-11-01T00:00:00.000Z",
        "2026-11-10T23:59:59.999Z",
      );

    assert.equal(
      result.sql,
      " WHERE created_at >= ? AND created_at <= ?",
    );

    assert.deepEqual(
      result.params,
      [
        "2026-11-01T00:00:00.000Z",
        "2026-11-10T23:59:59.999Z",
      ],
    );
  },
);

test(
  "buildPagination menggunakan default dan batas aman",
  () => {
    assert.deepEqual(
      buildPagination(
        undefined,
        undefined,
      ),
      {
        limit: 500,
        offset: 0,
      },
    );

    assert.deepEqual(
      buildPagination(
        100,
        1000,
      ),
      {
        limit: 100,
        offset: 1000,
      },
    );

    assert.deepEqual(
      buildPagination(
        5000,
        -20,
      ),
      {
        limit: 1000,
        offset: 0,
      },
    );
  },
);

test(
  "validateExportRange menerima range ISO yang valid",
  () => {
    assert.equal(
      validateExportRange(
        "2026-11-01T00:00:00.000Z",
        "2026-11-10T23:59:59.999Z",
      ),
      true,
    );
  },
);

test(
  "validateExportRange menolak from lebih besar dari to",
  () => {
    assert.equal(
      validateExportRange(
        "2026-11-10T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ),
      false,
    );
  },
);

test(
  "validateExportRange menolak tanggal invalid",
  () => {
    assert.equal(
      validateExportRange(
        "not-a-date",
        "2026-11-10T00:00:00.000Z",
      ),
      false,
    );
  },
);

console.log(
  "CSV Query 3.9.3 tests completed.",
);
