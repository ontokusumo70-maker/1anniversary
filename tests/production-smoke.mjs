import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = async (path) => (await import('node:fs/promises')).readFile(new URL(path, root), 'utf8');

const index = await read('worker/index.ts');
const guard = await read('worker/auth/session-guard.ts');
const frontend = await read('src/frontend/index.html').catch(() => '');

assert.match(index, /handleAuthRequest/);
assert.match(index, /routes\/auth/);
assert.match(guard, /session_id NOT LIKE 'otp_%'/);
assert.ok(frontend.length > 0, 'production frontend missing');
assert.match(frontend, /id="machines"/);
assert.match(frontend, /id="downloadExport"/);
assert.match(frontend, /data-owner-view="overview"/);
assert.match(frontend, /data-owner-view="reward-pool"/);
assert.match(frontend, /data-owner-view="customer-trace"/);
assert.doesNotMatch(frontend, /data-owner-view="audit"/);
assert.match(frontend, /data-owner-view="csv-export"/);
assert.match(frontend, /id="staffMachines"/);
const app = await read('src/frontend/app.js');
const machines = await read('worker/routes/machines.ts');
assert.match(app, /assets\/coin\/coin_1st_front\.png/);
assert.match(app, /\/machines/);
assert.match(app, /\/owner\/export/);
assert.match(app, /\/owner\/customer\//);
assert.match(frontend, /id="traceCustomer"/);
assert.doesNotMatch(index, /X-(?:Customer|Staff|Owner)-ID/i);
assert.match(machines, /UPDATE machines[\s\S]*SET status = 'IDLE'/);
assert.match(machines, /WIB_OFFSET_MS = 7 \* 60 \* 60 \* 1000/);
assert.doesNotMatch(app, /from ['"]vitest['"]/);

console.log('production static smoke PASS');
