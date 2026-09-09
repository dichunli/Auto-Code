/* ============================================================
   退料申请表（师傅申请退料 → 库管确认开退料单 → 核销）

   背景：对称于 part_pick_requests（申领）流程。
   师傅在手机端对已领料的工单配件发起"退料申请"（只记意向，不动库存），
   库管在领料管理页"待退料"Tab 确认后生成退料单（TL-），库存加回，
   申请标记 done 并记录生成的退料单 id。

   状态流转：pending（待确认）→ done（已退料）/ cancelled（已取消）
   ============================================================ */

CREATE TABLE IF NOT EXISTS part_return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* 退料的工单配件分支 */
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  /* 必填：退哪一笔领料。库管确认开退料单时直接挂这笔领料记录，
     触发器靠它校验可退数量、找批次加回库存 */
  picking_record_id UUID NOT NULL REFERENCES part_picking_records(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  /* 退料类型：excess 多领 / wrong_pick 领错 / wrong_ship 发错 / damaged 损坏 */
  return_type TEXT NOT NULL DEFAULT 'excess',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ,
  done_by UUID,
  /* 核销后反查生成的退料单 */
  return_order_id UUID REFERENCES material_return_orders(id) ON DELETE SET NULL
);

/* 按分支查待退申请 + 按状态筛待处理列表 + 按领料记录查申请 */
CREATE INDEX IF NOT EXISTS idx_part_return_requests_branch ON part_return_requests(work_order_item_part_id);
CREATE INDEX IF NOT EXISTS idx_part_return_requests_pending ON part_return_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_part_return_requests_picking_record ON part_return_requests(picking_record_id);

/* RLS：与 part_pick_requests 同一模式——登录用户全量读写 */
ALTER TABLE part_return_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_full_access ON part_return_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* 加入 Realtime 发布：申请/核销变化实时推送给打开工单详情的两端 */
ALTER PUBLICATION supabase_realtime ADD TABLE part_return_requests;
