-- Truth table for the watcher's alert predicate (P2b, node "Check heartbeats").
-- Needs no tables: synthetic rows and a fixed "now". Every row must show expected = watcher_alerts.
-- Run on PostgreSQL 15.19 on 2 Nov 2026: 9 of 9 rows matched.
WITH p AS (SELECT timestamptz '2026-11-02 12:00:00+00' AS now_ts),
s(job, hb_age_min, alert_age_min, expect) AS (VALUES
  ('s1 healthy: 10 min since beat',                     10,   NULL::int, false),
  ('s2 44 min since beat',                              44,   NULL,      false),
  ('s3 46 min since beat, never alerted',               46,   NULL,      true),
  ('s4 no heartbeat row at all',                        NULL, NULL,      true),
  ('s5 stale, alerted 30 min ago (suppressed)',         180,  30,        false),
  ('s6 stale, alerted 2h01m ago (reminder due)',        300,  121,       true),
  ('s7 stale again after a recovery (alert older than the last beat)', 50, 180, true),
  ('s8 stale, alerted exactly 2h ago (boundary)',       300,  120,       false),
  ('s9 exactly 45 min since beat (boundary)',           45,   NULL,      false)),
t AS (SELECT s.job, s.expect,
        CASE WHEN s.hb_age_min IS NULL THEN NULL ELSE p.now_ts - make_interval(mins => s.hb_age_min) END AS last_run_at,
        CASE WHEN s.alert_age_min IS NULL THEN NULL ELSE p.now_ts - make_interval(mins => s.alert_age_min) END AS alerted_at,
        p.now_ts FROM s CROSS JOIN p)
SELECT t.job, t.expect AS expected,
       (COALESCE(t.last_run_at, 'epoch'::timestamptz) < t.now_ts - interval '45 minutes'
        AND (t.alerted_at IS NULL
             OR t.alerted_at <= COALESCE(t.last_run_at, 'epoch'::timestamptz)
             OR t.alerted_at < t.now_ts - interval '2 hours')) AS watcher_alerts
FROM t ORDER BY t.job;
