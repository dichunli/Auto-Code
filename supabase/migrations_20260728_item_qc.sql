-- ============================================================
-- 工单状态体系 - 第1步：质检字段 + 质检单（纯加性，不改现有行为）
-- 日期：2026-07-28
--
-- 背景：新的工单状态体系要求项目级质检流程：
--   项目完工 → 待质检 → 合格 → 已完工（不合格 → 回待施工）
-- 质检不是必走流程：维修项目可设置"是否必须质检"，默认不必须，
-- 不必须质检的项目完工即已完工。
--
-- 质检单：每次质检操作生成一张质检单（work_order_item_qc_logs），
-- 记录合格/不合格结果 + 备注，并可附图片/视频凭证（work_order_item_qc_media），
-- 合格与不合格都可附——不合格留证尤其重要，返工时有据可查。
-- ============================================================

-- 1. 维修项目库：是否必须质检（默认 false = 不必须，质检非必走流程）
ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS require_qc BOOLEAN NOT NULL DEFAULT false;

-- 2. 工单项目：是否必须质检（添加项目时从 service_items 带入，工单内可单独改）
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS require_qc BOOLEAN NOT NULL DEFAULT false;

-- 3. 工单项目：质检结果（none=未质检 / passed=合格 / failed=不合格）
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS qc_status TEXT NOT NULL DEFAULT 'none'
  CHECK (qc_status IN ('none', 'passed', 'failed'));

-- 4. 质检单主表：每次质检操作一张单
CREATE TABLE IF NOT EXISTS work_order_item_qc_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  inspector_id UUID REFERENCES profiles(id),  -- 操作人（质检人本人）
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed')),
  notes TEXT,                                  -- 备注（不合格时前端必填）
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_logs_item ON work_order_item_qc_logs(work_order_item_id);

ALTER TABLE work_order_item_qc_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON work_order_item_qc_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. 质检单媒体表：质检单的图片/视频凭证
-- （与 work_order_item_part_media 配件图片表同一模式）
CREATE TABLE IF NOT EXISTS work_order_item_qc_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qc_log_id UUID NOT NULL REFERENCES work_order_item_qc_logs(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_media_log ON work_order_item_qc_media(qc_log_id);

ALTER TABLE work_order_item_qc_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON work_order_item_qc_media
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. 存量数据迁移：已完工的老项目一律视为质检合格
-- （老工单完工时还没有质检环节，不能让它们倒退成"待质检"）
UPDATE work_order_items SET qc_status = 'passed' WHERE status = 'completed';

