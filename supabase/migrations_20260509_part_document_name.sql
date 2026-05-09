-- 为配件分支增加供应商采购单上的单据名称字段
ALTER TABLE work_order_item_parts
ADD COLUMN IF NOT EXISTS document_name TEXT;
