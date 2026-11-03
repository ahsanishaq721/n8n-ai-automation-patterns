# n8n-ai-automation-patterns

Importable n8n workflows for the boring failures of automation in production: crash alerts that leak data, scheduled jobs that stop without a sound, alerts that repeat forever. Each pattern comes from a system I run, rebuilt generically, with the reasoning for every retry decision written next to the node.

**Status (3 Nov 2026): private staging.** Four workflows are built and checked offline. **None has been imported into a fresh n8n and run yet**, so nothing here is claimed as "tested in n8n". [docs/failure-tests.md](docs/failure-tests.md) says exactly what was and was not checked.

## Patterns

| ID | Workflow | Problem it solves | Checked so far |
|---|---|---|---|
| P1 | [p1-pii-safe-crash-alert.json](workflows/p1-pii-safe-crash-alert.json) | An error message can carry a name, an id or an e-mail, and the alert sends it to a chat channel. Here only allow-listed technical words survive. | n8n structure check; Code node syntax and 5 behaviour checks |
| P2a | [p2a-job-with-heartbeat.json](workflows/p2a-job-with-heartbeat.json) | A scheduled job that stops creates no execution and no error. The job writes a heartbeat in the same SQL statement as its work. | n8n structure check |
| P2b | [p2b-heartbeat-watcher.json](workflows/p2b-heartbeat-watcher.json) | Something other than the job must notice the silence. Alerts once per stall, reminds every 2 hours, alerts again after a recovery. | n8n structure check; Code node syntax and 6 behaviour checks; the alert predicate on PostgreSQL 15.19 (9 of 9 cases) |
| P3 | [p3-release-expired-holds.json](workflows/p3-release-expired-holds.json) | A visitor holds an appointment slot and leaves. A unique index on the slot stops a second booking; one job frees abandoned holds, at most 100 per run, and deletes the matching calendar event. | n8n structure check (0 errors, 0 warnings); the SQL and the index on a real PostgreSQL engine, 17 checks, including two mutation checks |

Planned next: a Postgres work queue with atomic claim and stale-claim reset, a webhook API with key auth and honest 400/401/403 answers, a WhatsApp webhook receiver (verify handshake, retry de-duplication), and a webhook-to-LLM-JSON flow with a fallback path.

The reasoning, with proof, for P2 is in note [003 of my n8n field notes](https://github.com/ahsanishaq721/n8n-error-debugger-skill/blob/main/field-notes/003-dead-man-heartbeat-for-scheduled-jobs.md).

## How to use

1. Import a workflow: Workflows -> Import from file.
2. P2a and P2b need a Postgres credential, and the tables from [sql/p2-heartbeat-tables.sql](sql/p2-heartbeat-tables.sql). P3 needs the tables and indexes from [sql/p3-slot-holds.sql](sql/p3-slot-holds.sql), a Postgres credential and a Google Calendar credential.
3. In the **Config** node, replace the placeholder with your own alert webhook (for example a Slack incoming webhook). It is a secret: keep it in that one node, never in several, and never in a file you share.
4. P1: open the settings of each workflow you want watched and choose P1 as its **Error workflow**. The Error Trigger only fires for automatic runs, not for a manual test.
5. P2b: edit the watched job and its threshold in the `Check heartbeats` query, and its description in the `Build alert` node (`code/p2b-build-alert.js` is the readable copy).

Credentials are never part of an export (only their ids and names), which is why every credential here is a placeholder called `REPLACE_ME`.

## Design decisions (and why)

- **Retry only what is safe to repeat.** The alert call retries because a duplicate alert is acceptable and a lost one is not. The job's SQL retries because it is idempotent. Each node says why in its notes.
- **A failed check is not a stall.** If the heartbeat query itself fails, the alert says "could not check", and is never recorded as delivered. Otherwise a broken check would silence a real stall for 2 hours.
- **Zero rows means healthy.** The watcher relies on n8n skipping the nodes after a node that returns nothing. Do not turn on Always Output Data for `Check heartbeats`.
- **The index prevents the double booking; the job only cleans up.** A partial unique index on (site, slot start) for held and confirmed holds refuses a second booking. Its predicate cannot contain `now()` (PostgreSQL refuses it, and a check here proves it), so expiry is a status change made by one job.
- **No data in the alert channel.** The alert workflow also saves no execution data, so the redacted text is the only copy.

## Problems found and how I fixed them

| What happened | What I did |
|---|---|
| A 15-minute sync job stayed silent for about 12.5 hours and nobody was told | P2: a heartbeat written with the work, and a separate watcher |
| Crash alerts could contain data from the failing record | P1: an allow-list of technical words; everything else becomes `...` |
| One alert every 5 minutes for as long as a job was down | P2b: alert once per stall, remind every 2 hours |

## Checks you can run

```bash
npm ci
node tests/check-code-nodes.js        # 11 behaviour checks on the two Code nodes, no n8n needed
node tests/check-slot-holds.js        # 17 checks: P3 SQL and index on a real PostgreSQL engine (WebAssembly), no Docker
```

and `sql/p2-watcher-predicate-check.sql` in any PostgreSQL 15 database (it needs no tables).

## Limits

- Not yet imported into and run in a fresh n8n. The failure tests in `docs/failure-tests.md` are written but not run.
- Tested design assumptions are for n8n 2.41.5 and PostgreSQL 15. The P3 SQL checks ran on PostgreSQL 18.6 (PGlite), not on 15; the original statement runs on 15.19.
- P3 leaves out two parts of the original job: the heartbeat (that is P2a) and the cleanup of calendar events for erased leads. A hold whose site has no row in `clients` is released but not returned, so its calendar event is not deleted (a check documents this).
- A whole-server outage needs a monitor outside the box.

## License

MIT, see [LICENSE](LICENSE).
