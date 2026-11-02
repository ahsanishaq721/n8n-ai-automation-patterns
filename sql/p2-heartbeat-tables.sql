-- Tables for patterns P2a (job) and P2b (watcher). Run once in your own database.
-- `tasks` is a demo table so P2a has something to release; replace it with your own work table.
CREATE TABLE IF NOT EXISTS tasks           (id bigserial PRIMARY KEY, status text NOT NULL DEFAULT 'due');
CREATE TABLE IF NOT EXISTS job_heartbeat   (job text PRIMARY KEY, last_run_at timestamptz NOT NULL, detail text);
CREATE TABLE IF NOT EXISTS job_alert_state (job text PRIMARY KEY, alerted_at timestamptz NOT NULL, detail text);
