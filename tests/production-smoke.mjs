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
assert.doesNotMatch(index, /X-(?:Customer|Staff|Owner)-ID/i);

console.log('production static smoke PASS');
