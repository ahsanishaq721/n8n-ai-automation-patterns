# Failure tests

A pattern is only proven when you break it on purpose and watch what happens. This page lists the test for each pattern and its real status. **Nothing below has been run in a fresh n8n yet**; the status column says what was checked offline instead.

| Pattern | Failure to force | Expected | Status |
|---|---|---|---|
| P1 | Make a workflow fail with an error message that contains a fake name, a fake e-mail and a fake 4-digit id | The alert shows technical words only; none of the three values appears | **Offline only (2 Nov 2026):** the Code node was run in Node with such messages and nothing leaked (`tests/check-code-nodes.js`). Not run inside n8n |
| P1 | Point the alert webhook at a dead address | The alert call retries 3 times, then the alert workflow ends without failing in a loop | NOT RUN |
| P2a | Run the job with no due tasks | A heartbeat row is still written | NOT RUN (the claim rests on the PostgreSQL docs, see below) |
| P2b | Deactivate the job for longer than the threshold | One alert, none on the next ticks, a reminder after 2 hours | NOT RUN in n8n. **Predicate only:** 9 of 9 cases correct on PostgreSQL 15.19 (`sql/p2-watcher-predicate-check.sql`) |
| P2b | Reactivate the job, then stop it again | A new alert (a new stall) | NOT RUN in n8n. Covered by case s7 of the predicate check |
| P3 | Insert two holds for the same site and slot | The second insert is refused with error 23505 (`slot_holds_active_uniq`) | **SQL proven (3 Nov 2026) on PostgreSQL 18.6 (PGlite, WebAssembly):** `tests/check-slot-holds.js`, 17 checks. Not run in n8n and not run on PostgreSQL 15 |
| P3 | Release a slot, then hold it again | The new hold is accepted | SQL proven, same run |
| P3 | Run the release statement twice in a row | The second run returns zero rows and changes nothing | SQL proven, same run |
| P3 | 150 expired holds | 100 released in the first run and 50 in the second | SQL proven, same run |
| P3 | Remove the unique index (mutation) | The double booking is no longer refused, so the test above fails without the index | SQL proven, same run |
| P3 | Let the calendar delete fail (wrong calendar id) | The hold is already released in the database; the node continues without stopping the run | NOT RUN |
| P2b | Drop the `job_heartbeat` table | An alert that says "could not check", and no row written to `job_alert_state` | Offline only: the alert builder returns `check_failed` for the Postgres error shape (`tests/check-code-nodes.js`) |

PostgreSQL documents that a data-modifying statement in a `WITH` query is executed exactly once and always to completion, whether or not the main query reads its output ([docs](https://www.postgresql.org/docs/15/queries-with.html)). P2a relies on that for the heartbeat.

## How to run the n8n tests

1. Start a fresh n8n with a fresh Postgres (a GitHub Codespace works; no local Docker needed).
2. Import the workflows, create the tables, set the Config node to a webhook you control.
3. Run each row, take a screenshot, and replace NOT RUN with the date, the n8n version and what you saw. If it differs from "Expected", write that down instead.
