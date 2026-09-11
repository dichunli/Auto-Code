/* ============================================================
   配件出库管控 A：结构 + 触发器（2026-09-11）

   背景：贵重/易错配件需要"必须扫码才能出库"（require_scan_check 已有预留字段），
   关键配件需要"必须库管确认才能出库"（本迁移新增 require_confirm，照三级继承模式）。

   一、part_categories / part_names / parts 三级加 require_confirm
   二、picking_orders.status 扩 draft（待确认，不扣库存）
   三、抽共用扣减函数 fn_picking_deduct_record（确认出库时复用同一扣减口径）
   四、fn_deduct_batch_on_picking 薄壳化：draft 单占位记录不动库存
   五、fn_restore_batch_on_return 加 draft 拦截：待确认单从未扣库存，退料会凭空加库存
   ============================================================ */

/* 一、三级档案加 require_confirm（与 require_scan_check 同模式） */
ALTER TABLE part_categories ADD COLUMN IF NOT EXISTS require_confirm BOOLEAN DEFAULT FALSE;
ALTER TABLE part_names      ADD COLUMN IF NOT EXISTS require_confirm BOOLEAN DEFAULT FALSE;
ALTER TABLE parts           ADD COLUMN IF NOT EXISTS require_confirm BOOLEAN DEFAULT FALSE;

/* 二、picking_orders.status 扩 draft；DEFAULT 保持 confirmed 不动，存量数据零影响 */
ALTER TABLE picking_orders DROP CONSTRAINT IF EXISTS picking_orders_status_check;
ALTER TABLE picking_orders ADD CONSTRAINT picking_orders_status_check
  CHECK (status IN ('draft','confirmed','cancelled'));

/* 库管待确认列表查询用部分索引 */
CREATE INDEX IF NOT EXISTS idx_picking_orders_draft
  ON picking_orders(created_at DESC) WHERE status = 'draft';

/* 三、共用扣减函数：从触发器抽出的"单条领料记录扣库存"逻辑。
   两处调用：触发器（confirmed 单建单即扣）+ confirm_picking_order（draft 单确认时补扣）。
   直领登记（is_direct 且 batch_id 空）不动库存，确认入库时即入即出冲账。 */
CREATE OR REPLACE FUNCTION public.fn_picking_deduct_record(p_record_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_part_id UUID;
  v_remaining INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  SELECT * INTO v_rec FROM part_picking_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '领料记录不存在';
  END IF;

  /* 直领登记：不动批次/总库存/流水，确认入库时即入即出冲账 */
  IF v_rec.batch_id IS NULL THEN
    IF v_rec.is_direct THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '库存批次不存在';
  END IF;

  /* 锁定批次行，校验剩余量 */
  SELECT part_id, remaining INTO v_part_id, v_remaining
  FROM part_batches WHERE id = v_rec.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '库存批次不存在';
  END IF;
  IF v_remaining < v_rec.quantity THEN
    RAISE EXCEPTION '批次剩余库存不足:剩余 % 件,本次要领 % 件', v_remaining, v_rec.quantity;
  END IF;

  /* 扣批次剩余 */
  UPDATE part_batches SET remaining = remaining - v_rec.quantity WHERE id = v_rec.batch_id;

  /* 扣配件总库存，不足则报错整单回滚 */
  UPDATE parts SET quantity = quantity - v_rec.quantity
  WHERE id = v_part_id AND quantity >= v_rec.quantity
  RETURNING quantity INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION '配件总库存不足,无法出库';
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = v_rec.work_order_item_part_id;

  /* 写库存流水 */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
  VALUES (v_part_id, 'outbound', -v_rec.quantity, v_after + v_rec.quantity, v_after, v_work_order_id, 'picking_record', v_rec.id, '工单领料出库');
END;
$$ LANGUAGE plpgsql;

/* 内部函数：只能被触发器和 confirm_picking_order 调用，不对客户端开放 */
REVOKE ALL ON FUNCTION public.fn_picking_deduct_record(UUID) FROM PUBLIC, anon, authenticated;

/* 四、触发器薄壳化：draft（待确认）单的占位记录不扣库存，确认出库时统一补扣 */
CREATE OR REPLACE FUNCTION fn_deduct_batch_on_picking()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /* 待确认单占位：登记占净领额度防重复领，但不动库存；
     库管确认出库时由 confirm_picking_order 逐条补扣 */
  IF NEW.picking_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM picking_orders WHERE id = NEW.picking_order_id AND status = 'draft'
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM public.fn_picking_deduct_record(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* 五、退料触发器加 draft 拦截：待确认单从未扣过库存，退它会凭空加库存。
   在"未冲账直领件拦截"后追加（两处拦截语义相同：账上无这批货不能退） */
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
  /* 校验退料数量不超过该领料记录的净领量 */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT r.batch_id, r.quantity, COALESCE(r.is_direct, false), o.status
      INTO v_batch_id, v_picked, v_is_direct, v_order_status
    FROM part_picking_records r
    LEFT JOIN picking_orders o ON o.id = r.picking_order_id
    WHERE r.id = NEW.picking_record_id;
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

/* ═══ 台账登记 ═══ */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260910_outbound_control_a.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证 SQL（执行后应全部为 true/通过）：

   -- 字段已加
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'parts' AND column_name = 'require_confirm';

   -- status 约束含 draft
   SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'picking_orders_status_check';

   -- 函数存在
   SELECT proname FROM pg_proc WHERE proname IN
     ('fn_picking_deduct_record','fn_deduct_batch_on_picking','fn_restore_batch_on_return');

   -- 内部函数权限已收
   SELECT has_function_privilege('anon', 'public.fn_picking_deduct_record(uuid)', 'EXECUTE');  -- 应为 f
   ============================================================ */
