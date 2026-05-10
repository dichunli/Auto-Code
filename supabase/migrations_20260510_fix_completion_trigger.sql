-- 修复工单完工自动加分触发器：枚举中没有 'completed'，应改为 'pending_quality_check'
CREATE OR REPLACE FUNCTION score_on_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending_quality_check' AND OLD.status IN ('repairing', 'pending_repair') THEN
    INSERT INTO mechanic_scores (mechanic_id, work_order_id, score_type, points, notes)
    SELECT mechanic_id, NEW.id, 'completion', 10, '工单完工'
    FROM work_order_items
    WHERE work_order_id = NEW.id AND mechanic_id IS NOT NULL
    GROUP BY mechanic_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
