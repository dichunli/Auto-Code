/* 物流公司增加排序字段
   场景:用户希望物流公司可以按自定义顺序排列 */

ALTER TABLE logistics_companies ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_logistics_companies_sort_order ON logistics_companies(sort_order);
