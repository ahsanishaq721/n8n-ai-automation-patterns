// Code node, mode "Run Once for All Items".
// One alert per stalled job that is DUE an alert (a healthy or already-alerted job returns 0 rows
// from the check query, so n8n skips this node), or ONE notice if the check query itself failed.
// "kind" and "job" travel on to the node that records the alert: only a genuine stall may be recorded
// as alerted. A failed CHECK must never be recorded, or it would silence a real stall for 2 hours.
const items = $input.all();
if (!items.length) return [];

// Error items differ per node type (Postgres: top-level message; HTTP Request: error.message;
// Google Calendar: a plain string). One extractor for all of them, never "[object Object]".
const errText = (x) => {
  const e = x.error;
  return String(
    (typeof x.message === 'string' && x.message) ||
      (typeof e === 'string' && e) ||
      (e && (e.message || e.description)) ||
      'unknown error',
  );
};

const failed = items.find(
  (it) => it.json && (it.json.error !== undefined || (it.json.message !== undefined && it.json.job === undefined)),
);
if (failed) {
  return [
    {
      json: {
        kind: 'check_failed',
        job: '',
        alert:
          ':warning: *Could not check the job heartbeats*\n' +
          'The check query failed, so no job is verified until this is fixed:\n- ' +
          errText(failed.json),
      },
    },
  ];
}

// Describe each watched job here. The key must match the job name in job_heartbeat.
const JOBS = {
  release_tasks: {
    label: 'task release job',
    cadence: 'every 15 minutes',
    impact: 'While it is down, tasks that are due are not released.',
  },
};

return items.map((it) => {
  const j = it.json;
  const m = JOBS[j.job] || { label: String(j.job), cadence: 'on its schedule', impact: '' };
  const mins = Number(j.stale_mins);
  const never = !Number.isFinite(mins) || mins > 100000; // 'epoch' stands in for "no heartbeat row"
  const alert =
    ':rotating_light: *' + m.label + ' has STOPPED running*\n' +
    (never
      ? 'No heartbeat has ever been recorded for it.'
      : 'Last heartbeat was ' + mins + ' minutes ago (' + j.last_run_at + ').') +
    ' It should run ' + m.cadence + '.\n' +
    (m.impact ? m.impact + '\n' : '') +
    'Fix: open the job workflow in n8n and toggle it inactive, then active, to re-arm its schedule trigger.\n' +
    '(You get this once per stall, then a reminder every 2 hours until it is fixed.)';
  return { json: { kind: 'stalled', job: j.job, alert } };
});
