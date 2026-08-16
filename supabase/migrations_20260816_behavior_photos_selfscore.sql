/* ============================================================
   行为考核：项目级标准照片 + 自检合格直接计分 + 核查改判留痕
   1. behavior_score_items 加 guide_images 项目级标准照片（JSONB 数组）
      —— 管理员在桌面端上传，自检/检查时作对标基准；
         细节级 guide_images（behavior_item_details）继续保留
   2. behavior_check_records 加 review_score_record_id 核查改判调整流水
      —— 自检上报即合格，先按满分计分（score_record_id 指向自检流水）；
         检查人核查改判低分时写一条差额调整流水，id 记到这里
      —— NULL = 未发生改判（核查维持满分 或 尚未核查）
   向后兼容：新列可空/有默认值，旧记录行为不变
   ============================================================ */

ALTER TABLE behavior_score_items
  ADD COLUMN IF NOT EXISTS guide_images JSONB DEFAULT '[]';

ALTER TABLE behavior_check_records
  ADD COLUMN IF NOT EXISTS review_score_record_id UUID REFERENCES behavior_score_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_behavior_check_records_review_score ON behavior_check_records(review_score_record_id);
