import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("worker/routes/machines.ts", "utf8");
assert.match(source, /UPDATE machines[\s\S]*SET status = 'IDLE'/);
assert.match(source, /expected_end_at <= \?/);
assert.match(source, /requireSession\(request, env, \["STAFF"\]\)/);
assert.match(source, /requireSession\(request, env, \["CUSTOMER"\]\)/);
assert.match(source, /requireSession\(request, env, \["OWNER"\]\)/);
assert.match(source, /WASHER_DURATION_MINUTES = 32/);
assert.match(source, /DRYER_DURATION_MINUTES = 50/);
assert.match(source, /WIB_OFFSET_MS = 7 \* 60 \* 60 \* 1000/);
console.log("Machine route contract PASS");
