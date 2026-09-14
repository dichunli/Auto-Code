/* 外键索引第二轮：巡检扫出的剩余 7 个（2026-09-15）
   migrations_20260915_c 落地后跑 scripts/check-fk-indexes.js 扫出
   这 7 个漏网外键（DeepSeek 点名 3 个之外的，正是通用巡检的价值）。
   全部 IF NOT EXISTS，重复执行无害。
*/

CREATE INDEX IF NOT EXISTS idx_arrival_receipt_items_warehouse_id ON arrival_receipt_items(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_behavior_check_comments_author_id ON behavior_check_comments(author_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_part_return_requests_return_order_id ON part_return_requests(return_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_batches_supplier_id ON receiving_batches(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_voided_by ON supplier_payments(voided_by);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_created_by ON supplier_payments(created_by);

/* 登记台账 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_d_fk_indexes_round2.sql')
ON CONFLICT DO NOTHING;
