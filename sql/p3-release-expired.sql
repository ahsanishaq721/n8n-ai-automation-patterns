-- The statement inside the "Release Expired Holds" node of P3.
-- At most 100 rows per run, oldest id first. A run with nothing to release returns zero rows.
-- Running it twice in a row releases nothing the second time (status is no longer 'held').
WITH expired AS (
  SELECT id FROM slot_holds
  WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= now()
  ORDER BY id LIMIT 100
), rel AS (
  UPDATE slot_holds h
  SET status = 'released', released_at = now(), updated_at = now()
  FROM expired e WHERE h.id = e.id
  RETURNING h.id, h.calendar_event_id, h.site_key
)
SELECT rel.id, rel.calendar_event_id, c.calendar_id, c.calendar_provider
FROM rel JOIN clients c ON c.site_key = rel.site_key;
