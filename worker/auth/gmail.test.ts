import { strict as assert } from "node:assert";
import {
  buildGmailMimeMessage,
  buildGmailRawMessage,
} from "./gmail";

const mime = buildGmailMimeMessage(
  "teras.binatu@gmail.com",
  "customer@gmail.com",
  "123456",
);

assert.match(
  mime,
  /From: Teras Laundry <teras\.binatu@gmail\.com>/,
);

assert.match(
  mime,
  /To: customer@gmail\.com/,
);

assert.match(
  mime,
  /Subject: Kode OTP Teras Laundry/,
);

assert.match(
  mime,
  /123456/,
);

const raw = buildGmailRawMessage(mime);

assert.equal(typeof raw, "string");
assert.ok(raw.length > 0);
assert.equal(raw.includes("+"), false);
assert.equal(raw.includes("/"), false);
assert.equal(raw.includes("="), false);

console.log("Gmail OTP contract PASS");
