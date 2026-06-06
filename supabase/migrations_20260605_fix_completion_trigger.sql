/* 修复 score_on_completion 触发器：枚举中不存在 'completed'，改为 'pending_quality_check' */

CREATE OR REPLACE FUNCTION score_on_completion()
RETURNS TRIGGER AS $func$
BEGIN
  IF NEW.status = 'pending_quality_check' AND OLD.status != 'pending_quality_check' THEN
    INSERT INTO mechanic_scores (mechanic_id, work_order_id, score_type, points, notes)
    SELECT mechanic_id, NEW.id, 'completion', 10, '工单完工'
    FROM work_order_items
    WHERE work_order_id = NEW.id AND mechanic_id IS NOT NULL
    GROUP BY mechanic_id;
  END IF;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;
