/* 工单类型字段扩展：支持预约单、历史报价单、作废工单等状态转换 */

/* 1. 添加工单类型字段 */
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'normal';

/* 2. 添加作废原因字段 */
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

/* 3. 添加预约时间字段 */
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;

/* 4. 创建索引加速按类型查询 */
CREATE INDEX IF NOT EXISTS idx_work_orders_order_type ON work_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle_id_order_type ON work_orders(vehicle_id, order_type);

/* 5. 历史数据迁移：已结单且无任何项目的工单可标记为报价单（可选，由用户手动处理） */
/* 默认全部设为 normal */
UPDATE work_orders SET order_type = 'normal' WHERE order_type IS NULL;
