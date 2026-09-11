import {
  strict as assert,
} from "node:assert";

import {
  buildExportFilename,
  normalizeExportRequest,
} from "./owner-export";

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
  "normalizeExportRequest memakai default pagination",
  () => {
    const result =
      normalizeExportRequest({ type: "customers" });

    assert.equal(
      result.limit,
      500,
    );

    assert.equal(
      result.offset,
      0,
    );

    assert.equal(
      result.from,
      undefined,
    );

    assert.equal(
      result.to,
      undefined,
    );
  },
);

test(
  "normalizeExportRequest mempertahankan filter range",
  () => {
    const result =
      normalizeExportRequest({
        type: "customers",
        from:
          "2026-11-01T00:00:00.000Z",
        to:
          "2026-11-10T23:59:59.999Z",
        limit: 100,
        offset: 200,
      });

    assert.equal(
      result.from,
      "2026-11-01T00:00:00.000Z",
    );

    assert.equal(
      result.to,
      "2026-11-10T23:59:59.999Z",
    );

    assert.equal(
      result.limit,
      100,
    );

    assert.equal(
      result.offset,
      200,
    );
  },
);

test(
  "normalizeExportRequest membatasi limit maksimum",
  () => {
    const result =
      normalizeExportRequest({
        type: "customers",
        limit: 5000,
        offset: -10,
      });

    assert.equal(
      result.limit,
      1000,
    );

    assert.equal(
      result.offset,
      0,
    );
  },
);

test(
  "buildExportFilename menghasilkan nama CSV",
  () => {
    const filename =
      buildExportFilename(
        "2026-11-01",
        "2026-11-10",
      );

    assert.equal(
      filename,
      "teras-laundry-owner-export-2026-11-01-2026-11-10.csv",
    );
  },
);

console.log(
  "Owner Export 3.9.4 tests completed.",
);
