// Code node, mode "Run Once for Each Item".
// Build a crash alert that cannot leak data: only words from the allow-list survive,
// everything else (names, ids, emails, values inside the error text) becomes an ellipsis.
const ALLOWED = new Set(
  (
    'error errors failed failure fail invalid input syntax type integer text boolean timestamp timestamptz uuid ' +
    'json jsonb numeric bigint value values violates violation unique constraint duplicate key foreign null ' +
    'undefined object array string number nan column columns relation table does exist exists already missing ' +
    'required field fields cannot could unable connect connection connecting refused reset closed terminated ' +
    'timeout timed out time request response bad unauthorized forbidden found unavailable service gateway ' +
    'internal server too many requests rate limit limited quota exceeded token credentials credential ' +
    'authorization authentication expired permission denied access unexpected end at near line the a an to in ' +
    'on for with from by or and is was were be has have had no not it its this that of parse parsing read ' +
    'reading property properties socket hang up ssl tls certificate dns lookup network database query statement ' +
    'deadlock detected transaction aborted rollback lock wait canceling canceled cancelled memory heap maximum ' +
    'size payload large entity unprocessable method allowed conflict gone moved redirect status code message ' +
    'workflow node execution webhook respond empty result results item items data binary file econnreset ' +
    'econnrefused etimedout enotfound eai_again epipe ehostunreach enetunreach getaddrinfo http https api ' +
    'parameter parameters bind supplied expected got but only one more than less greater equal password peer ' +
    'role operator function unknown ambiguous sql'
  ).split(' '),
);

// The Config node sits between the trigger and this node and does not pass the trigger's fields on,
// so read the trigger's item by name instead of relying on $json.
const src = $('Error Trigger').first().json;
const e = src.execution || {};
const wf = src.workflow || {};
const raw = String((e.error && e.error.message) || '');

let prev = '';
const safe = raw
  .split(/\s+/)
  .map((word) => {
    const t = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    // A 3-digit HTTP status survives only right after the word "code" or "status".
    const keep = ALLOWED.has(t.toLowerCase()) || (/^[1-5]\d\d$/.test(t) && (prev === 'code' || prev === 'status'));
    prev = t.toLowerCase();
    return keep ? t : '...';
  })
  .join(' ')
  .replace(/(\.\.\. ?){2,}/g, '... ')
  .slice(0, 160);

const lines = [
  ':rotating_light: *Workflow crashed*',
  '*Workflow:* ' + (wf.name || 'unknown'),
  '*Failed node:* ' + (e.lastNodeExecuted || 'unknown'),
  '*Error (technical words only):* ' + safe,
  '*Time:* ' + new Date().toISOString(),
];
if (e.id) lines.push('*Execution ID:* ' + e.id);
if (e.url) lines.push('*Open:* ' + e.url);

return { json: { text: lines.join('\n') } };
