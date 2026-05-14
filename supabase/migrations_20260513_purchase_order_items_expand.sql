/* 给 purchase_order_items 增加待收货展示所需字段
   场景:待收货页面需要展示零件编码、单据名称、单位、分类、车牌、图片等详细信息 */

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_part_name TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS license_plate TEXT,
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;
