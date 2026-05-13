/* 物流运单表 + 入库日志关联运单
   场景:配件采购到货前先关联一张运单,后续可用于追踪运费、代收款。
   该迁移幂等:可重复执行不会报错。 */

CREATE TABLE IF NOT EXISTS logistics_waybills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_no TEXT NOT NULL,
  logistics_company_id UUID REFERENCES logistics_companies(id),
  logistics_company_name TEXT,
  freight_amount DECIMAL(10,2) DEFAULT 0,
  cod_amount DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'returned')),
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waybills_tracking ON logistics_waybills(tracking_no);
CREATE INDEX IF NOT EXISTS idx_waybills_status ON logistics_waybills(status);
CREATE INDEX IF NOT EXISTS idx_waybills_company ON logistics_waybills(logistics_company_id);

/* RLS 开启 + 授权策略 */
ALTER TABLE logistics_waybills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full_access" ON logistics_waybills;
CREATE POLICY "auth_full_access" ON logistics_waybills FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* 入库日志关联运单 */
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS waybill_id UUID REFERENCES logistics_waybills(id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_waybill ON inventory_logs(waybill_id);
