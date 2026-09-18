/* ============================================================
 * supplier_return_records → purchase_order_items 外键（2026-09-18）
 * 背景：退货记录要显示车牌（待退货/已退货列表），车牌在采购明细
 *   purchase_order_items.license_plate 上；PostgREST 嵌入查询必须有外键。
 * 幂等：DO 块先查 pg_constraint，存在则跳过，可重跑。
 * ============================================================ */

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_return_records_purchase_order_item_id_fkey'
  ) THEN
    ALTER TABLE public.supplier_return_records
      ADD CONSTRAINT supplier_return_records_purchase_order_item_id_fkey
      FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id);
  END IF;
END $$;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_g_return_record_poi_fk.sql', '退货记录→采购明细外键(退货列表显示车牌用)')
ON CONFLICT (file_name) DO NOTHING;
