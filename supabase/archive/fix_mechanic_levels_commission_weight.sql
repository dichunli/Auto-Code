-- 给 mechanic_levels 表添加团队分配权重字段
ALTER TABLE mechanic_levels
  ADD COLUMN IF NOT EXISTS commission_weight DECIMAL(3,2) DEFAULT 1.00;

-- 默认：团队分配权重 = 个人分成系数
UPDATE mechanic_levels
  SET commission_weight = share_coefficient
  WHERE commission_weight IS NULL;
