ALTER TABLE vehicles ALTER COLUMN customer_id DROP NOT NULL;

UPDATE vehicles
SET customer_id = NULL
WHERE customer_id IN (
  SELECT customer_id
  FROM vehicles
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
  HAVING COUNT(*) > 10
);
