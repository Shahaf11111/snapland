-- Local test data: a compact grid near the default Tel Aviv map center.
-- Deterministic IDs make repeat runs safe; existing areas are preserved.
BEGIN;
INSERT INTO users (email, password_hash, name)
VALUES ('virtualization-test@example.invalid', 'not-a-login', 'Virtualization Test')
ON CONFLICT (email) DO NOTHING;

WITH grid AS (
  SELECT n,
    ST_MakeEnvelope(
      34.7818 + ((n - 1) % 100 - 50) * 0.00002,
      32.0853 + ((n - 1) / 100 - 50) * 0.00002,
      34.7818 + ((n - 1) % 100 - 50) * 0.00002 + 0.000012,
      32.0853 + ((n - 1) / 100 - 50) * 0.00002 + 0.000012,
      4326
    )::geography AS geom
  FROM generate_series(1, 10000) AS n
), inserted AS (
  INSERT INTO areas (id, name, geom, size_km2, created_by)
  SELECT md5('virtualization-test-' || n)::uuid,
    'Virtualization Test ' || lpad(n::text, 5, '0'),
    geom, ST_Area(geom) / 1000000.0,
    (SELECT id FROM users WHERE email = 'virtualization-test@example.invalid')
  FROM grid
  ON CONFLICT (id) DO NOTHING
  RETURNING *
)
INSERT INTO area_history (area_id, name, geom, size_km2, version, edited_by, change_type)
SELECT id, name, geom, size_km2, version, created_by, 'created' FROM inserted;
COMMIT;

SELECT count(*) AS virtualization_test_areas
FROM areas
WHERE created_by = (SELECT id FROM users WHERE email = 'virtualization-test@example.invalid')
  AND deleted_at IS NULL;
