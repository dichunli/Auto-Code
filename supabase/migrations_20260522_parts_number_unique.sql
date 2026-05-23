/* ============================================================
   为 parts.part_number 添加唯一约束
   ============================================================ */

/* 1. 空字符串视为无效编码，用临时唯一值填充，避免触发唯一约束冲突 */
UPDATE parts SET part_number = CONCAT('TEMP-', id) WHERE part_number = '';

/* 2. 清理重复的零件编码，保留最早创建的记录 */
DELETE FROM parts
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY part_number ORDER BY created_at ASC) AS rn
    FROM parts
  ) sub
  WHERE rn > 1
);

/* 3. 添加唯一约束 */
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_part_number_unique;
ALTER TABLE parts ADD CONSTRAINT parts_part_number_unique UNIQUE (part_number);
