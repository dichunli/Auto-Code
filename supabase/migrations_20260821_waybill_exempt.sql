/* 收货运单豁免 + 配件级运单关联（2026-08-21）
 *
 * 背景：外阜供应商采购单未关联运单时收货按钮禁用。实际业务有两条出路：
 *   1) 配件级关联：一单多件、运单只对应其中一件时，只把该配件关联到运单
 *   2) 豁免：司机捎带/自行采购/其它方式带回，没有运单，
 *      但需记录运费（可选）和说明（自行采购/其它方式带回等）
 *
 * 改动：
 *   purchase_orders 加豁免三列（整单粒度）
 *   purchase_order_items 加 waybill_id（配件级关联）+ 豁免三列（配件粒度）
 *
 * 判断口径（前端 PendingReceiptList 行级）：
 *   可收货 = 本地供应商 || 单头已关联运单 || 单头已豁免 || 该配件已关联 || 该配件已豁免
*/

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS waybill_exempt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exempt_freight NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS exempt_note TEXT;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS waybill_id UUID REFERENCES logistics_waybills(id),
  ADD COLUMN IF NOT EXISTS waybill_exempt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exempt_freight NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS exempt_note TEXT;

CREATE INDEX IF NOT EXISTS idx_poi_waybill ON purchase_order_items(waybill_id) WHERE waybill_id IS NOT NULL;

/* ============================================================
   验证方法（执行完本脚本后跑）：
   SELECT column_name FROM information_schema.columns
   WHERE table_name='purchase_orders' AND column_name LIKE '%exempt%';
   应返回 3 行；purchase_order_items 应返回 4 行（含 waybill_id）。
   ============================================================
*/
