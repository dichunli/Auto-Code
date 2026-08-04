/* ============================================================
   配件申领表（申领 → 库管确认实领 → 自动核销）

   背景：师傅在手机端对工单配件发起"申领"（只记需求，不动库存），
   库管实领（创建领料单扣库存）后按分支自动核销待申领记录。

   状态流转：pending（待出库）→ done（已实领）/ cancelled（已取消）
   ============================================================ */

CREATE TABLE IF NOT EXISTS part_pick_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* 申领的工单配件分支 */
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ,
  done_by UUID
);

/* 按分支查待申领 + 按状态筛待处理列表 */
CREATE INDEX IF NOT EXISTS idx_part_pick_requests_branch ON part_pick_requests(work_order_item_part_id);
CREATE INDEX IF NOT EXISTS idx_part_pick_requests_pending ON part_pick_requests(status) WHERE status = 'pending';

/* RLS：与 part_picking_records 同一模式——登录用户全量读写 */
ALTER TABLE part_pick_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_full_access ON part_pick_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* 加入 Realtime 发布：申领/核销变化实时推送给打开工单详情的两端（弹"点击刷新"提示条） */
ALTER PUBLICATION supabase_realtime ADD TABLE part_pick_requests;
