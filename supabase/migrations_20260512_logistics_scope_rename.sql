/* 物流公司 scope (TEXT) → scopes (TEXT[])
   原因：
   1. 用户反馈：有些物流公司同时服务哈市和外阜，单值字段无法表达
   2. 同时把命名和供应商 region 对齐（harbin / outside）
   3. 本地（local）供应商送货上门，不需要物流公司，所以物流公司只在 哈市/外阜 二选其一或两者都有

   该迁移幂等：可在初始 scope=local/external 或已 rename 后的 scope=harbin/outside 状态执行 */

-- 1. 添加新的 scopes 数组字段（默认 ['harbin']）
ALTER TABLE logistics_companies ADD COLUMN IF NOT EXISTS scopes TEXT[] DEFAULT ARRAY['harbin'];

-- 2. 把旧 scope 单值迁移到 scopes 数组（兼容 local/external 和 harbin/outside 两种历史值）
UPDATE logistics_companies
SET scopes = CASE
  WHEN scope IN ('local', 'harbin') THEN ARRAY['harbin']
  WHEN scope IN ('external', 'outside') THEN ARRAY['outside']
  ELSE ARRAY['harbin']
END
WHERE scope IS NOT NULL AND (scopes IS NULL OR scopes = ARRAY[]::TEXT[] OR scopes = ARRAY['harbin']);

-- 3. 删除旧的 scope 字段及其 CHECK 约束
ALTER TABLE logistics_companies DROP CONSTRAINT IF EXISTS logistics_companies_scope_check;
ALTER TABLE logistics_companies DROP COLUMN IF EXISTS scope;

-- 4. CHECK 约束：scopes 必须是 ['harbin','outside'] 的非空子集
ALTER TABLE logistics_companies DROP CONSTRAINT IF EXISTS logistics_companies_scopes_valid;
ALTER TABLE logistics_companies ADD CONSTRAINT logistics_companies_scopes_valid
  CHECK (scopes <@ ARRAY['harbin', 'outside']::TEXT[] AND array_length(scopes, 1) > 0);

-- 5. 索引（GIN 索引支持数组成员查询：scopes && ARRAY['harbin']）
DROP INDEX IF EXISTS idx_logistics_companies_scope;
CREATE INDEX IF NOT EXISTS idx_logistics_companies_scopes ON logistics_companies USING GIN(scopes);
