/* 退料数量校验补行锁：防并发超退（2026-09-15，DeepSeek 诊断 H 项）
   背景：fn_restore_batch_on_return 校验"已退量 + 本次 ≤ 已领量"时是
        先 SELECT 领料记录（无锁）再 SUM 已退量。两个并发退料会同时
        读到相同的已退量、都通过校验，导致超退（账实不符）。
   修复：校验查询加 FOR UPDATE OF r，锁住领料记录行——并发退料串行
        通过，第二个事务等锁释放后能读到第一个已写入的退料记录，
        校验才会看到真实的累计已退量。
   说明：函数参数列表未变，CREATE OR REPLACE 即可，无需先 DROP。
        函数体除加锁外与 migrations_20260910_outbound_control_a.sql 一致。
*/

CREATE OR REPLACE FUNCTION fn_restore_batch_on_return()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_part_id UUID;
  v_picked INTEGER;
  v_is_direct BOOLEAN;
  v_returned INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
  v_order_status TEXT;
BEGIN
  /* 校验退料数量不超过该领料记录的净领量（FOR UPDATE OF r 锁行防并发超退） */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT r.batch_id, r.quantity, COALESCE(r.is_direct, false), o.status
      INTO v_batch_id, v_picked, v_is_direct, v_order_status
    FROM part_picking_records r
    LEFT JOIN picking_orders o ON o.id = r.picking_order_id
    WHERE r.id = NEW.picking_record_id
    FOR UPDATE OF r;
    IF NOT FOUND THEN
      RAISE EXCEPTION '领料记录不存在';
    END IF;
    /* 待确认单占位记录禁止退料（库存从未扣过，退了会凭空加库存） */
    IF v_order_status = 'draft' THEN
      RAISE EXCEPTION '该领料单还在待确认（未出库），不能退料；请先确认出库或作废该领料单';
    END IF;
    /* 未冲账直领件禁止退料（账上无这批货，退了会凭空加库存） */
    IF v_is_direct AND v_batch_id IS NULL THEN
      RAISE EXCEPTION '该配件是急件直领、尚未入库冲账，不能退料；可让库管在领料单详情里取消直领';
    END IF;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM part_return_records
    WHERE picking_record_id = NEW.picking_record_id AND id <> NEW.id;
    IF v_returned + NEW.quantity > v_picked THEN
      RAISE EXCEPTION '退料数量超出可退数量:已领 % 件,已退 % 件,本次要退 % 件', v_picked, v_returned, NEW.quantity;
    END IF;
  END IF;

  /* 加回批次剩余和总库存 */
  IF v_batch_id IS NOT NULL THEN
    UPDATE part_batches SET remaining = remaining + NEW.quantity WHERE id = v_batch_id
    RETURNING part_id INTO v_part_id;
  END IF;
  IF v_part_id IS NULL THEN
    SELECT part_id INTO v_part_id FROM work_order_item_parts WHERE id = NEW.work_order_item_part_id;
  END IF;

  IF v_part_id IS NOT NULL THEN
    UPDATE parts SET quantity = quantity + NEW.quantity WHERE id = v_part_id
    RETURNING quantity INTO v_after;

    SELECT woi.work_order_id INTO v_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = NEW.work_order_item_part_id;

    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
    VALUES (v_part_id, 'return_in', NEW.quantity, v_after - NEW.quantity, v_after, v_work_order_id, 'return_record', NEW.id, '工单退料回库');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* 登记台账 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_b_return_for_update.sql')
ON CONFLICT DO NOTHING;
