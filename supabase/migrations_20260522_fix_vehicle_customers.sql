/* ============================================================
   数据修复：把历史工单中的客户反写到车辆表
   解决导入数据时 vehicles.customer_id 为空的问题
   ============================================================ */

/* 1. 为每辆已有工单的车辆，补回最近一次工单的客户 */
UPDATE vehicles
SET customer_id = sub.last_customer_id
FROM (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    customer_id AS last_customer_id
  FROM work_orders
  WHERE customer_id IS NOT NULL
  ORDER BY vehicle_id, created_at DESC
) sub
WHERE vehicles.id = sub.vehicle_id
  AND vehicles.customer_id IS NULL;

/* 2. 清理重复客户（保留最早创建的记录，把后面的合并） */
/* 用临时表保存重复客户映射，避免 CTE 跨语句失效 */

/* 2a. 创建临时表：记录要保留的客户ID 和 要删除的重复客户ID */
CREATE TEMP TABLE dup_customers AS
WITH earliest AS (
  SELECT DISTINCT ON (name, phone)
    id AS keep_id,
    name,
    phone
  FROM customers
  ORDER BY name, phone, created_at ASC
)
SELECT c.id AS dup_id, e.keep_id
FROM customers c
JOIN earliest e ON c.name = e.name AND c.phone = e.phone
WHERE c.id != e.keep_id;

/* 2b. 把重复客户的车辆关联指向保留的客户 */
UPDATE vehicles
SET customer_id = d.keep_id
FROM dup_customers d
WHERE vehicles.customer_id = d.dup_id;

/* 2c. 把重复客户的工单指向保留的客户 */
UPDATE work_orders
SET customer_id = d.keep_id
FROM dup_customers d
WHERE work_orders.customer_id = d.dup_id;

/* 2d. 删除重复客户记录 */
DELETE FROM customers WHERE id IN (SELECT dup_id FROM dup_customers);

/* 2e. 清理临时表 */
DROP TABLE dup_customers;

/* 3. 给手机号加唯一约束（排除占位符"无手机号"和空字符串），防止以后重复 */
CREATE UNIQUE INDEX customers_phone_unique ON customers (phone)
WHERE phone <> '无手机号' AND phone <> '' AND phone IS NOT NULL;
