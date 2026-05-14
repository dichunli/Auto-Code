/*
  为 logistics_companies 表添加 sort_order 列
  用于物流公司列表排序
*/

ALTER TABLE logistics_companies
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
