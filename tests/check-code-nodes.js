'use strict';
// Runs the Code-node sources in code/ the way n8n does: wrapped in a function, with $ / $input injected.
// Run from the repo root: node tests/check-code-nodes.js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'code') + path.sep;
let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log('  ok  ' + name); };

// ---- P1: crash alert that cannot leak data (mode: once for each item)
const p1src = fs.readFileSync(dir + 'p1-redact-error.js', 'utf8');
const p1 = new Function('$', p1src); // syntax check + runner
const trigger = (item) => ($name) => { assert.equal($name, 'Error Trigger'); return { first: () => ({ json: item }) }; };
const run1 = (message, extra = {}) => p1(trigger({ workflow: { name: 'Nightly import' }, execution: { id: '77', lastNodeExecuted: 'Insert rows', error: { message }, ...extra } })).json.text;

ok('P1 keeps technical words, drops the identifier and the e-mail', () => {
  const t = run1('duplicate key value violates unique constraint "patients_email_key" Key (email)=(jane.doe@example.com) already exists.');
  assert.match(t, /duplicate key value violates unique constraint/);
  assert.match(t, /already exists/);
  for (const leak of ['patients_email_key', 'jane', 'doe', 'example.com']) assert.ok(!t.includes(leak), 'leaked: ' + leak);
});
ok('P1 keeps an HTTP status only right after "code"/"status"', () => {
  assert.match(run1('Request failed with status code 429'), /status code 429/);
  assert.ok(!run1('user 4242 not found').includes('4242'));
});
ok('P1 collapses runs of removed words and truncates to 160 characters', () => {
  const t = run1('Alice Bob Carol Dave Erin Frank error');
  assert.ok(!/\.\.\. \.\.\./.test(t));
  const long = run1('error '.repeat(100));
  const line = long.split('\n').find((l) => l.startsWith('*Error'));
  assert.ok(line.length <= '*Error (technical words only):* '.length + 160);
});
ok('P1 survives missing fields (no execution, no error, no workflow)', () => {
  const t = p1(trigger({})).json.text;
  assert.match(t, /Workflow:\* unknown/);
  assert.match(t, /Failed node:\* unknown/);
});
ok('P1 does not let markup or links through', () => {
  const t = run1('see <http://evil.example/x|click> *now* @channel');
  for (const bad of ['evil', 'click', '@channel', '<http']) assert.ok(!t.includes(bad), 'leaked: ' + bad);
});

// ---- P2b: alert builder (mode: once for all items)
const p2src = fs.readFileSync(dir + 'p2b-build-alert.js', 'utf8');
const p2 = (items) => new Function('$input', p2src)({ all: () => items.map((json) => ({ json })) });

ok('P2b: stalled job -> one alert with the minutes', () => {
  const [a] = p2([{ job: 'release_tasks', last_run_at: '2026-11-02T10:00:00Z', stale_mins: 50 }]);
  assert.equal(a.json.kind, 'stalled');
  assert.equal(a.json.job, 'release_tasks');
  assert.match(a.json.alert, /50 minutes ago/);
});
ok('P2b: a job that never beat -> "No heartbeat has ever been recorded"', () => {
  const [a] = p2([{ job: 'release_tasks', last_run_at: '1970-01-01T00:00:00Z', stale_mins: 29000000 }]);
  assert.match(a.json.alert, /No heartbeat has ever been recorded/);
});
ok('P2b: a failed CHECK is reported as "could not check", never as a stall (Postgres shape)', () => {
  const [a] = p2([{ message: 'relation "job_heartbeat" does not exist', error: { description: 'Failed query: SELECT ...' } }]);
  assert.equal(a.json.kind, 'check_failed');
  assert.equal(a.json.job, '');
  assert.match(a.json.alert, /relation "job_heartbeat" does not exist/);
  assert.ok(!a.json.alert.includes('Failed query') && !a.json.alert.includes('[object Object]'));
});
ok('P2b: failed check, HTTP-request shape and plain-string shape', () => {
  assert.match(p2([{ error: { message: 'connect ECONNREFUSED' } }])[0].json.alert, /ECONNREFUSED/);
  assert.match(p2([{ error: 'timeout of 5000ms exceeded' }])[0].json.alert, /timeout of 5000ms exceeded/);
});
ok('P2b: no rows -> no items (the chain stops)', () => assert.deepEqual(p2([]), []));
ok('P2b: unknown job name still produces a usable alert', () => {
  const [a] = p2([{ job: 'mystery_job', last_run_at: 'x', stale_mins: 99 }]);
  assert.match(a.json.alert, /mystery_job has STOPPED running/);
});

console.log(`\n${passed} checks passed`);
