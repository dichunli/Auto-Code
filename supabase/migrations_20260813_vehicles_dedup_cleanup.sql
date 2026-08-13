/*
 * 重复车辆清理（B 方案，用户 2026-08-13 批准）
 * 规则：每组重复 VIN 保留创建时间最早的记录，其余记录的 VIN 清空（车牌/客户不动，以后来店补）
 * 另删除 2 条确认无关联的冗余记录：
 *   - 黑AV8B90 的空白记录（无客户/无VIN/无车型）
 *   - 辽AP1956 的马自达6 记录（与奥迪A4 车牌冲突，用户确认删除）
 * 执行前会自动建备份表 vehicles_dedup_backup_20260813，改错可恢复。
 * 预期影响：约 45 条记录 VIN 被清空 + 2 条记录删除。全部 0 工单、已核实无关联数据。
 */

/* ========== 0. 备份受影响的数据（46 组全部记录 + 2 条待删记录） ========== */
DROP TABLE IF EXISTS vehicles_dedup_backup_20260813;
CREATE TABLE vehicles_dedup_backup_20260813 AS
SELECT * FROM vehicles
WHERE vin IN (
    SELECT vin FROM vehicles WHERE vin IS NOT NULL AND vin <> ''
    GROUP BY vin HAVING COUNT(*) > 1
  )
  OR id IN ('9e2e884f-1b75-4fff-a904-ec9fd66e1a15', '25a6bfc6-a20f-41c6-ada9-e8997f691d35');

/* ========== 1. VIN 去重：保留最早一条，其余清空 VIN ========== */
WITH ranked AS (
  SELECT id, vin,
         ROW_NUMBER() OVER (PARTITION BY vin ORDER BY created_at ASC) AS rn
  FROM vehicles
  WHERE vin IS NOT NULL AND vin <> ''
    AND vin IN (
      SELECT vin FROM vehicles WHERE vin IS NOT NULL AND vin <> ''
      GROUP BY vin HAVING COUNT(*) > 1
    )
)
UPDATE vehicles v
SET vin = NULL
FROM ranked r
WHERE v.id = r.id AND r.rn > 1;

/* ========== 2. 删除黑AV8B90 空白记录（带条件防误删） ========== */
DELETE FROM vehicles
WHERE id = '9e2e884f-1b75-4fff-a904-ec9fd66e1a15'
  AND plate_number = '黑AV8B90'
  AND vin IS NULL
  AND customer_id IS NULL;

/* ========== 3. 删除辽AP1956 的马自达6 记录（用户确认，带条件防误删） ========== */
DELETE FROM vehicles
WHERE id = '25a6bfc6-a20f-41c6-ada9-e8997f691d35'
  AND plate_number = '辽AP1956'
  AND vin = 'LFPH4ABC769004541';

/* ========== 4. 验证（两个都应该是 0） ========== */
SELECT COUNT(*) AS 剩余重复VIN组数 FROM (
  SELECT vin FROM vehicles WHERE vin IS NOT NULL AND vin <> ''
  GROUP BY vin HAVING COUNT(*) > 1
) t;

SELECT COUNT(*) AS 剩余重复车牌组数 FROM (
  SELECT plate_number FROM vehicles GROUP BY plate_number HAVING COUNT(*) > 1
) t;
