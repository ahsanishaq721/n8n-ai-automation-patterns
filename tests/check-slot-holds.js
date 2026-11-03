// Run from the repo root: node tests/check-slot-holds.js
// Runs the P3 SQL on a real PostgreSQL engine (PGlite, WebAssembly): no Docker and no server needed.
// It proves the SQL and the index. It does NOT run n8n: the workflow is only checked for shape.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'sql', 'p3-slot-holds.sql'), 'utf8');
const release = fs.readFileSync(path.join(root, 'sql', 'p3-release-expired.sql'), 'utf8');
const wf = JSON.parse(fs.readFileSync(path.join(root, 'workflows', 'p3-release-expired-holds.json'), 'utf8'));

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.stack || e)); process.exitCode = 1; }
}

async function freshDb(sql = schema) {
  const db = new PGlite();
  await db.exec(sql);
  await db.exec("INSERT INTO clients VALUES ('site-a','cal-a','google'), ('site-b','cal-b','other')");
  return db;
}
// The slot time must be a FIXED timestamp: now() differs on every statement, so two "same slot" inserts
// built from now() would never collide and the unique-index tests would pass for the wrong reason.
const slotAt = (days) => new Date(Date.UTC(2030, 0, 1 + Number(String(days).split(' ')[0]))).toISOString();
const hold = (db, site, lead, days, status = 'held', expiresOffset = '10 minutes', event = null) =>
  db.query(
    `INSERT INTO slot_holds (site_key, lead_id, slot_start, slot_end, status, expires_at, calendar_event_id)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, now() + $5::interval, $6)
     RETURNING id`,
    [site, lead, slotAt(days), status, expiresOffset, event]);
async function sqlState(promise) {
  try { await promise; return null; } catch (e) { return { code: e.code, text: String(e.message) }; }
}

(async () => {
  await check('the workflow runs exactly the SQL file (no drift between the two)', async () => {
    const q = wf.nodes.find((n) => n.name === 'Release Expired Holds').parameters.query;
    assert.equal(q.trim(), release.slice(release.indexOf('WITH expired AS')).trim());
  });

  await check('same slot twice: the second hold is refused by the unique index (23505)', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day');
    const err = await sqlState(hold(db, 'site-a', 2, '1 day'));
    assert.equal(err && err.code, '23505');
    assert.match(err.text, /slot_holds_active_uniq/);
  });

  await check('a different slot, or the same time on another site, is allowed', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day');
    await hold(db, 'site-a', 2, '2 days');
    await hold(db, 'site-b', 3, '1 day');
  });

  await check('a confirmed booking blocks the slot too', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day', 'confirmed');
    assert.equal((await sqlState(hold(db, 'site-a', 2, '1 day'))).code, '23505');
  });

  await check('the same lead cannot hold two slots at once (slot_holds_active_per_lead)', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day');
    const err = await sqlState(hold(db, 'site-a', 1, '2 days'));
    assert.equal(err.code, '23505');
    assert.match(err.text, /slot_holds_active_per_lead/);
  });

  await check('a released slot can be held again', async () => {
    const db = await freshDb();
    const { rows: [first] } = await hold(db, 'site-a', 1, '1 day');
    await db.query("UPDATE slot_holds SET status = 'released' WHERE id = $1", [first.id]);
    await hold(db, 'site-a', 2, '1 day');
  });

  await check('release: expired held rows are released, everything else is untouched', async () => {
    const db = await freshDb();
    const { rows: [expired] } = await hold(db, 'site-a', 1, '1 day', 'held', '-1 minutes', 'evt-1');
    const { rows: [fresh] } = await hold(db, 'site-a', 2, '2 days', 'held', '10 minutes', 'evt-2');
    const { rows: [conf] } = await hold(db, 'site-a', 3, '3 days', 'confirmed', '-1 hours', 'evt-3');
    const { rows } = await db.query(release);
    assert.deepEqual(rows.map((r) => String(r.id)), [String(expired.id)]);
    const state = Object.fromEntries((await db.query('SELECT id, status, released_at FROM slot_holds')).rows
      .map((r) => [String(r.id), r]));
    assert.equal(state[expired.id].status, 'released');
    assert.ok(state[expired.id].released_at);
    assert.equal(state[fresh.id].status, 'held');
    assert.equal(state[conf.id].status, 'confirmed');
  });

  await check('release returns what the next nodes need (event id, calendar id, provider)', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day', 'held', '-1 minutes', 'evt-1');
    const { rows: [r] } = await db.query(release);
    assert.equal(r.calendar_event_id, 'evt-1');
    assert.equal(r.calendar_id, 'cal-a');
    assert.equal(r.calendar_provider, 'google');
  });

  await check('release is idempotent: a second run releases nothing (zero rows)', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day', 'held', '-1 minutes');
    assert.equal((await db.query(release)).rows.length, 1);
    assert.equal((await db.query(release)).rows.length, 0);
  });

  await check('release takes at most 100 rows per run, oldest id first', async () => {
    const db = await freshDb();
    await db.exec(`INSERT INTO slot_holds (site_key, lead_id, slot_start, slot_end, expires_at)
      SELECT 'site-a', g, timestamptz '2030-01-01' + (g || ' hours')::interval,
             timestamptz '2030-01-01' + (g || ' hours')::interval + interval '30 minutes', now() - interval '1 minute'
      FROM generate_series(1, 150) g`);
    const a = (await db.query(release)).rows;
    const b = (await db.query(release)).rows;
    assert.equal(a.length, 100);
    assert.equal(b.length, 50);
    assert.ok(Math.max(...a.map((r) => Number(r.id))) < Math.min(...b.map((r) => Number(r.id))));
  });

  await check('a hold with no event id is released and returned with a null event id (the IF node skips it)', async () => {
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day', 'held', '-1 minutes', null);
    const { rows: [r] } = await db.query(release);
    assert.equal(r.calendar_event_id, null);
  });

  await check('known limit: a hold whose site has no clients row is still released but not returned', async () => {
    const db = await freshDb();
    await hold(db, 'site-unknown', 1, '1 day', 'held', '-1 minutes', 'evt-9');
    assert.equal((await db.query(release)).rows.length, 0);
    assert.equal((await db.query('SELECT status FROM slot_holds')).rows[0].status, 'released');
  });

  await check('an index predicate with now() is refused by PostgreSQL (why expiry is done by status)', async () => {
    const db = await freshDb();
    const err = await sqlState(db.exec(
      'CREATE UNIQUE INDEX bad ON slot_holds (site_key, slot_start) WHERE expires_at > now()'));
    assert.ok(err, 'expected an error');
    assert.match(err.text, /IMMUTABLE/i);
  });

  await check('the real index has no now() in its predicate', async () => {
    const db = await freshDb();
    const { rows } = await db.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'slot_holds_active_uniq'");
    assert.ok(!/now\(\)/i.test(rows[0].indexdef));
  });

  await check('MUTATION: without the unique index the double booking is NOT refused (so the test above has teeth)', async () => {
    const mutated = schema.replace(/CREATE UNIQUE INDEX IF NOT EXISTS slot_holds_active_uniq[\s\S]*?;\n/, '');
    assert.notEqual(mutated, schema);
    const db = await freshDb(mutated);
    await hold(db, 'site-a', 1, '1 day');
    assert.equal(await sqlState(hold(db, 'site-a', 2, '1 day')), null);
  });

  await check('MUTATION: a release statement that ignores the status filter would release a confirmed booking', async () => {
    const mutated = release.replace("status = 'held' AND ", '');
    assert.notEqual(mutated, release);
    const db = await freshDb();
    await hold(db, 'site-a', 1, '1 day', 'confirmed', '-1 hours', 'evt-3');
    await db.query(mutated);
    assert.equal((await db.query('SELECT status FROM slot_holds')).rows[0].status, 'released');
  });

  await check('workflow shape: 4 nodes, placeholders only, IF has two branches, delete only on the true branch', async () => {
    assert.deepEqual(wf.nodes.map((n) => n.name),
      ['Every 5 Minutes', 'Release Expired Holds', 'Has Calendar Event?', 'Delete Stale Event']);
    for (const n of wf.nodes) for (const c of Object.values(n.credentials || {})) assert.equal(c.id, 'REPLACE_ME');
    const ifOut = wf.connections['Has Calendar Event?'].main;
    assert.equal(ifOut.length, 2);
    assert.equal(ifOut[0][0].node, 'Delete Stale Event');
    assert.equal(ifOut[1].length, 0);
  });

  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (SOME FAILED)' : ''));
})();
