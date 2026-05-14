/*
  支持未到货细分类型的字段扩展
  用于处理供货商漏发、欠发货等场景
*/

ALTER TABLE work_order_item_parts
  ADD COLUMN IF NOT EXISTS pre_received_qty INTEGER DEFAULT 0;

COMMENT ON COLUMN work_order_item_parts.pre_received_qty IS '欠发货已入库数量：供货商漏发时先按采购单虚拟入库的数量，真正到货时不重复增加库存';
