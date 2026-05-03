-- 车牌号和手机号唯一性约束
-- 注意：如果表中已存在重复数据，执行此脚本前请先清理。
-- 以下 CTE 会自动保留 created_at 最新的一条记录，删除其余重复项。

-- ========== vehicles.plate_number 唯一约束 ==========

-- 1) 清理重复车牌号（保留最新创建的车辆）
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY plate_number ORDER BY created_at DESC) AS rn
  FROM vehicles
  WHERE plate_number IS NOT NULL AND plate_number <> ''
)
DELETE FROM vehicles WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- 2) 添加唯一约束
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_plate_number_unique;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_plate_number_unique UNIQUE (plate_number);

-- ========== customers.phone 唯一约束 ==========

-- 1) 清理重复手机号（保留最新创建的客户）
-- 警告：删除客户会级联删除其关联的 customer_photos、vehicles（如有外键约束）等数据。
-- 建议在执行前备份数据，或手动合并重复客户。
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at DESC) AS rn
  FROM customers
  WHERE phone IS NOT NULL AND phone <> ''
)
DELETE FROM customers WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- 2) 添加唯一约束
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_unique;
ALTER TABLE customers ADD CONSTRAINT customers_phone_unique UNIQUE (phone);
