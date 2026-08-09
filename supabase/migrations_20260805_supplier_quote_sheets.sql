/* ============================================================
   供应商自助报价（询价链接）表

   背景：采购员在待询价页勾选配件行 → 生成带随机 token 的询价链接
   → 微信发给供应商 → 供应商免登录打开填价（编码/品牌/规格/采购价）
   → 提交后自动回写配件行（采购价+供应商）并推进到待报价。

   状态流转：open（待报价）→ submitted（已报价）→ adopted（已采用，锁死）
             open/submitted → cancelled（已作废）
   有效期：生成后 3 小时（expires_at），过期链接打不开。
   ============================================================ */

CREATE TABLE IF NOT EXISTS supplier_quote_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* 链接凭证：32 位随机字符串，不可枚举 */
  token TEXT NOT NULL UNIQUE,
  supplier_id UUID REFERENCES suppliers(id),
  /* 供应商名快照：防供应商改名/删除后历史单看不出是谁 */
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  adopted_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS supplier_quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES supplier_quote_sheets(id) ON DELETE CASCADE,
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  /* ── 快照：供应商看到的信息（只给配件和车型，不给车主信息） ── */
  part_name TEXT,
  /* 数量允许 NULL：工单里没填就原样保留"未填"信号，不兜底 */
  quantity INTEGER,
  unit TEXT,
  vehicle_model TEXT,
  /* ── 供应商填写 ── */
  quoted_part_number TEXT,
  quoted_brand TEXT,
  quoted_specification TEXT,
  quoted_price NUMERIC(10,2),
  quoted_notes TEXT,
  /* 编码匹配到的库存配件（提交回写时关联到配件行） */
  matched_part_id UUID REFERENCES parts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_items_sheet ON supplier_quote_items(sheet_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_part ON supplier_quote_items(work_order_item_part_id);
CREATE INDEX IF NOT EXISTS idx_quote_sheets_status ON supplier_quote_sheets(status);

/* RLS：内部员工全量读写；供应商匿名访问走服务端 service role（不经过 RLS），无需 anon 策略 */
ALTER TABLE supplier_quote_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_full_access ON supplier_quote_sheets FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE supplier_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_full_access ON supplier_quote_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* 加入 Realtime 发布：供应商提交后采购管理页实时看到"已报价" */
ALTER PUBLICATION supabase_realtime ADD TABLE supplier_quote_sheets;
