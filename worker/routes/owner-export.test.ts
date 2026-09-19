import {
  strict as assert,
} from "node:assert";

import {
  buildOwnerReportCsv,
} from "./owner-export";

function test(
  name: string,
  fn: () => void,
): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`, error);
    throw error;
  }
}

test(
  "buildOwnerReportCsv menghasilkan bagian customer",
  () => {
    const csv = buildOwnerReportCsv({
      datasets: new Set(["customer"]),
      customers: [{
        customer_id: "customer_1",
        created_at: "2026-09-01T00:00:00.000Z",
        total_customers: 1,
        name: "Customer Test",
        phone: "0800000000",
        email: "test@example.com",
      }],
      machines: [],
      events: [],
      audit: [],
    });

    assert.match(csv, /LAPORAN TERAS LAUNDRY OWNER - CUSTOMER/);
    assert.match(csv, /Customer Test/);
    assert.match(csv, /test@example\.com/);
  },
);

test(
  "buildOwnerReportCsv menghasilkan bagian reward pool",
  () => {
    const csv = buildOwnerReportCsv({
      datasets: new Set(["reward-pool"]),
      customers: [],
      machines: [],
      events: [],
      audit: [],
      rewardPool: [{
        reward_type: "VOUCHER",
        description: "Voucher Test",
        quota_total: 10,
        quota_used: 2,
        budget_total: 100000,
        reward_claimed: 1,
        terms: "Test",
        active: 1,
      }],
    });

    assert.match(csv, /LAPORAN TERAS LAUNDRY OWNER - REWARD POOL/);
    assert.match(csv, /VOUCHER/);
    assert.match(csv, /100000/);
  },
);

test(
  "buildOwnerReportCsv menghasilkan bagian event dan reward multi",
  () => {
    const csv = buildOwnerReportCsv({
      datasets: new Set(["event"]),
      customers: [],
      machines: [],
      audit: [],
      events: [{
        event_id: "event_1",
        title: "Event Test",
        starts_at: "2026-09-01T00:00:00.000Z",
        ends_at: "2026-09-10T00:00:00.000Z",
        reward_type: "VOUCHER",
        reward_quantity: 1,
        active: 1,
      }],
      eventRewards: [
        { event_id: "event_1", reward_type: "VOUCHER", reward_quantity: 1, position: 0 },
        { event_id: "event_1", reward_type: "COIN", reward_quantity: 2, position: 1 },
      ],
    });

    assert.match(csv, /LAPORAN TERAS LAUNDRY OWNER - EVENT/);
    assert.match(csv, /VOUCHER/);
    assert.match(csv, /COIN/);
  },
);

console.log("Owner Export tests completed.");
