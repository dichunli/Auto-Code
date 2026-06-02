/* ============================================================
   行为考核 - 增加时间维度和媒体附件
   1. 增加 event_time 字段（事件发生时间）
   2. 增加 media_urls 字段（图片/视频附件）
   ============================================================ */

ALTER TABLE behavior_score_records
  ADD COLUMN IF NOT EXISTS event_time TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]';

/* 已有数据的事件时间默认等于打分时间 */
UPDATE behavior_score_records SET event_time = scored_at WHERE event_time IS NULL;
