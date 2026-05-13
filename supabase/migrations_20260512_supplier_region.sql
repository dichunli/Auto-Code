/* 供应商地域分类 + 物流公司范围分类
   本地（local）供应商：不需要物流和运单，直接送货
   哈市（harbin）供应商：匹配本地物流公司（scope=local）
   外阜（outside）供应商：匹配常见快递（scope=external） */

-- 1. suppliers 表添加 region 字段
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'harbin'
  CHECK (region IN ('local', 'harbin', 'outside'));

CREATE INDEX IF NOT EXISTS idx_suppliers_region ON suppliers(region);

-- 2. logistics_companies 表添加 scope 字段
ALTER TABLE logistics_companies ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'local'
  CHECK (scope IN ('local', 'external'));

CREATE INDEX IF NOT EXISTS idx_logistics_companies_scope ON logistics_companies(scope);

-- 3. 预置常用快递（仅在不存在同名记录时插入）
INSERT INTO logistics_companies (name, scope)
SELECT name, 'external' FROM (VALUES
  ('顺丰快递'),
  ('中通快递'),
  ('圆通快递'),
  ('韵达快递'),
  ('申通快递'),
  ('百世快递'),
  ('极兔快递'),
  ('邮政 EMS'),
  ('京东物流'),
  ('德邦快递')
) AS preset(name)
WHERE NOT EXISTS (
  SELECT 1 FROM logistics_companies lc WHERE lc.name = preset.name
);
