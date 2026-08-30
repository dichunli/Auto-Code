-- 给 mechanic_levels 表添加排序字段
ALTER TABLE mechanic_levels
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 给现有数据设置默认排序（按分成系数）
UPDATE mechanic_levels SET sort_order = 1 WHERE level_code = 'L1';
UPDATE mechanic_levels SET sort_order = 2 WHERE level_code = 'L2';
UPDATE mechanic_levels SET sort_order = 3 WHERE level_code = 'L3';
UPDATE mechanic_levels SET sort_order = 4 WHERE level_code = 'L4';
