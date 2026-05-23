/* ============================================================
   为 service_names.name 和 part_names.name 添加唯一约束
   ============================================================ */

/* ---------- service_names（维修项目名称库） ---------- */
/* 1. 空字符串用临时值填充，避免唯一冲突 */
UPDATE service_names SET name = CONCAT('未命名项目-', id) WHERE name = '';

/* 2. 清理重复名称，保留最早创建的记录 */
DELETE FROM service_names
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
    FROM service_names
  ) sub WHERE rn > 1
);

/* 3. 添加唯一约束 */
ALTER TABLE service_names DROP CONSTRAINT IF EXISTS service_names_name_unique;
ALTER TABLE service_names ADD CONSTRAINT service_names_name_unique UNIQUE (name);

/* ---------- part_names（配件名称库） ---------- */
/* 1. 空字符串用临时值填充，避免唯一冲突 */
UPDATE part_names SET name = CONCAT('未命名配件-', id) WHERE name = '';

/* 2. 清理重复名称，保留最早创建的记录 */
DELETE FROM part_names
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
    FROM part_names
  ) sub WHERE rn > 1
);

/* 3. 添加唯一约束 */
ALTER TABLE part_names DROP CONSTRAINT IF EXISTS part_names_name_unique;
ALTER TABLE part_names ADD CONSTRAINT part_names_name_unique UNIQUE (name);
