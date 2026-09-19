/* ============================================================
 * 库存流水审计链升级（2026-09-19，严谨性整改阶段二 · 任务11）
 *
 * 问题（诊断实锤）：
 *   1. inventory_logs 不记仓位/批次/单价——出了问题无法追溯"这批货去哪了"
 *   2. 调拨不写流水——仓位变动无据可查
 *   3. 撤销入库是物理删流水——审计链出"空洞"
 *   4. 手工入库流水不记操作人
 *
 * 方案：
 *   一、inventory_logs 加 4 列（全部可空，老数据留空）：
 *       warehouse_id / location / batch_id / unit_cost。
 *       刻意不加外键：批次会被撤销入库物理删除，审计流水必须留得住。
 *   二、调拨写流水：源/目标各一行 adjust，before/after 记【仓位数量】
 *      （仓位级流水的口径约定，注释说明；总库存不变）。
 *   三、领料/报废/手工入库的流水补齐 4 列 + 操作人。
 *   四、撤销入库：原入库流水保留，改为追加一条"净额回滚"反向流水
 *      （reference_type='revoke_inbound'），审计链不再出洞。
 *
 * 未覆盖（后续批次）：采购三大入库函数的流水补批次列——函数体量大，
 *   单独迁移处理，不在本文件范围。
 * 幂等：ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE（参数列表均未变），可重跑。
 * ============================================================ */

/* ─── 一、流水表加列 ─── */
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2);

COMMENT ON COLUMN public.inventory_logs.warehouse_id IS '变动发生仓位所属仓库（仓位级流水才有值；不加外键，审计留痕优先）';
COMMENT ON COLUMN public.inventory_logs.location IS '变动发生仓位';
COMMENT ON COLUMN public.inventory_logs.batch_id IS '变动涉及批次（不加外键：批次可能被撤销入库删除，流水必须留得住）';
COMMENT ON COLUMN public.inventory_logs.unit_cost IS '变动涉及批次的成本单价快照';

CREATE INDEX IF NOT EXISTS idx_inventory_logs_batch ON public.inventory_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_warehouse ON public.inventory_logs(warehouse_id);

/* ─── 二、领料扣库存：流水补仓位/批次/成本/操作人 ───
   （函数体同 0919_f 版，仅批次查询多取成本价、流水补列） */
CREATE OR REPLACE FUNCTION public.fn_picking_deduct_record(p_record_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_part_id UUID;
  v_remaining INTEGER;
  v_unit_cost DECIMAL(10,2);
  v_after INTEGER;
  v_work_order_id UUID;
  v_loc_qty INTEGER;
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

  /* 锁定批次行，校验剩余量（连成本价一起取，流水用） */
  SELECT part_id, remaining, unit_cost INTO v_part_id, v_remaining, v_unit_cost
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

  /* 仓位库存同步扣减：记录带仓位就扣，无记录/不足报错整单回滚；没带仓位（老路径）跳过 */
  IF v_rec.warehouse_id IS NOT NULL THEN
    SELECT quantity INTO v_loc_qty FROM public.part_stock_locations
    WHERE part_id = v_part_id
      AND warehouse_id = v_rec.warehouse_id
      AND COALESCE(location, '') = COALESCE(v_rec.location, '')
    FOR UPDATE;
    IF v_loc_qty IS NULL THEN
      RAISE EXCEPTION '所选仓位没有该配件库存记录，请核对仓位';
    END IF;
    IF v_loc_qty < v_rec.quantity THEN
      RAISE EXCEPTION '所选仓位仅剩 % 件，不足领 % 件，请核对仓位', v_loc_qty, v_rec.quantity;
    END IF;
    UPDATE public.part_stock_locations SET quantity = quantity - v_rec.quantity
    WHERE part_id = v_part_id
      AND warehouse_id = v_rec.warehouse_id
      AND COALESCE(location, '') = COALESCE(v_rec.location, '');
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = v_rec.work_order_item_part_id;

  /* 写库存流水（补仓位/批次/成本/操作人——操作人取领料人） */
  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    work_order_id, reference_type, reference_id, operator_id,
    warehouse_id, location, batch_id, unit_cost, notes
  ) VALUES (
    v_part_id, 'outbound', -v_rec.quantity, v_after + v_rec.quantity, v_after,
    v_work_order_id, 'picking_record', v_rec.id, v_rec.picked_by,
    v_rec.warehouse_id, v_rec.location, v_rec.batch_id, v_unit_cost, '工单领料出库'
  );
END;
$$ LANGUAGE plpgsql;

/* 内部函数：只能被触发器和 confirm_picking_order 调用，不对客户端开放 */
REVOKE ALL ON FUNCTION public.fn_picking_deduct_record(UUID) FROM PUBLIC, anon, authenticated;

/* ─── 三、报废出库：流水补仓位/批次/成本 ───
   （函数体同 0919_h 版，仅批次查询多取成本价、流水补列） */
CREATE OR REPLACE FUNCTION public.scrap_part_stock(
  p_part_id UUID,
  p_batch_id UUID,
  p_warehouse_id UUID,
  p_location TEXT,
  p_quantity INTEGER,
  p_reason TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part RECORD;
  v_remaining INTEGER;
  v_unit_cost DECIMAL(10,2);
  v_after INTEGER;
  v_loc TEXT;
  v_loc_qty INTEGER;
  v_record_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作报废');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '报废数量必须大于 0');
  END IF;

  /* 1. 锁配件 */
  SELECT id, name, part_number, quantity INTO v_part FROM parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件档案不存在');
  END IF;
  IF v_part.quantity < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error',
      '「' || COALESCE(v_part.name, '') || '」当前库存 ' || v_part.quantity || ' 件，不足报废 ' || p_quantity || ' 件');
  END IF;

  /* 2. 锁批次扣剩余（报废必须指定批次；连成本价一起取，流水用） */
  SELECT remaining, unit_cost INTO v_remaining, v_unit_cost
  FROM part_batches WHERE id = p_batch_id AND part_id = p_part_id FOR UPDATE;
  IF v_remaining IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '批次不存在或不属于该配件');
  END IF;
  IF v_remaining < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', '批次剩余仅 ' || v_remaining || ' 件，不足报废');
  END IF;

  /* 3. 锁仓位扣数量（报废必须指定仓位） */
  v_loc := COALESCE(NULLIF(TRIM(COALESCE(p_location, '')), ''), '');
  SELECT quantity INTO v_loc_qty FROM public.part_stock_locations
  WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc
  FOR UPDATE;
  IF v_loc_qty IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '所选仓位没有该配件库存记录，请核对仓位');
  END IF;
  IF v_loc_qty < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', '所选仓位仅剩 ' || v_loc_qty || ' 件，不足报废');
  END IF;

  UPDATE part_batches SET remaining = remaining - p_quantity WHERE id = p_batch_id;
  UPDATE parts SET quantity = quantity - p_quantity WHERE id = p_part_id
  RETURNING quantity INTO v_after;
  UPDATE public.part_stock_locations SET quantity = quantity - p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc;

  /* 4. 报废记录 + 库存流水（补仓位/批次/成本） */
  INSERT INTO public.part_scrap_records (part_id, batch_id, warehouse_id, location, quantity, reason, notes, created_by)
  VALUES (p_part_id, p_batch_id, p_warehouse_id, NULLIF(TRIM(COALESCE(p_location, '')), ''),
          p_quantity, NULLIF(TRIM(COALESCE(p_reason, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id)
  RETURNING id INTO v_record_id;

  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    reference_type, reference_id, operator_id,
    warehouse_id, location, batch_id, unit_cost, notes
  ) VALUES (
    p_part_id, 'outbound', -p_quantity, v_after + p_quantity, v_after,
    'scrap_record', v_record_id, p_operator_id,
    p_warehouse_id, NULLIF(v_loc, ''), p_batch_id, v_unit_cost,
    '报废出库: ' || COALESCE(v_part.name, '')
  );

  RETURN jsonb_build_object('success', true, 'record_id', v_record_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.scrap_part_stock(uuid, uuid, uuid, text, integer, text, text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.scrap_part_stock(uuid, uuid, uuid, text, integer, text, text, uuid) TO authenticated;

/* ─── 四、手工入库：流水补操作人/仓位/批次/成本 ───
   （函数体同 0919_k 版，批次插入补 RETURNING、流水补列） */
CREATE OR REPLACE FUNCTION public.manual_part_inbound(
  p_part_id UUID,
  p_qty INTEGER,
  p_unit_cost DECIMAL DEFAULT NULL,
  p_batch_no TEXT DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL,
  p_log_notes TEXT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_location TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after_qty INTEGER;
  v_loc TEXT;
  v_batch_id UUID;
BEGIN
  /* 必须已登录（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  IF p_part_id IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于0');
  END IF;

  /* 原子加库存：数据库内部排队执行，并发不会互相覆盖 */
  UPDATE parts
  SET quantity = quantity + p_qty
  WHERE id = p_part_id
  RETURNING quantity INTO v_after_qty;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;

  /* 仓位账：传了仓库就写 part_stock_locations（无记录补建行） */
  IF p_warehouse_id IS NOT NULL THEN
    v_loc := COALESCE(NULLIF(TRIM(COALESCE(p_location, '')), ''), '');
    UPDATE public.part_stock_locations SET quantity = quantity + p_qty
    WHERE part_id = p_part_id AND warehouse_id = p_warehouse_id AND COALESCE(location, '') = v_loc;
    IF NOT FOUND THEN
      INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
      VALUES (p_part_id, p_warehouse_id, NULLIF(v_loc, ''), p_qty);
    END IF;
  END IF;

  /* 批次（与原手工入库口径一致：有批次号才建；补 RETURNING 供流水关联） */
  IF NULLIF(TRIM(COALESCE(p_batch_no, '')), '') IS NOT NULL THEN
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost)
    VALUES (p_part_id, TRIM(p_batch_no), p_qty, p_qty, COALESCE(p_unit_cost, 0))
    RETURNING id INTO v_batch_id;
  END IF;

  /* 流水（补操作人/仓位/批次/成本；前后数量在同一事务内算出，并发下也准确） */
  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    waybill_id, operator_id, warehouse_id, location, batch_id, unit_cost, notes
  ) VALUES (
    p_part_id, 'inbound', p_qty, v_after_qty - p_qty, v_after_qty,
    p_waybill_id, auth.uid(), p_warehouse_id, NULLIF(TRIM(COALESCE(p_location, '')), ''),
    v_batch_id, p_unit_cost, p_log_notes
  );

  RETURN jsonb_build_object('success', true, 'before_qty', v_after_qty - p_qty, 'after_qty', v_after_qty);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.manual_part_inbound(uuid, integer, numeric, text, uuid, text, uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_part_inbound(uuid, integer, numeric, text, uuid, text, uuid, text) TO authenticated;

/* ─── 五、仓位调拨：补写流水（此前完全不记） ───
   口径约定：调拨是仓位级变动、总库存不变，流水的 before_qty/after_qty
   记【仓位数量】而非总库存（与本表其他总库存级流水区分，靠 warehouse_id/
   location 列识别）；源仓一行 -n、目标仓一行 +n。
   （函数体同 0919_i 版，仅补流水段） */
CREATE OR REPLACE FUNCTION public.transfer_stock_location(
  p_part_id UUID,
  p_from_warehouse_id UUID,
  p_from_location TEXT,
  p_to_warehouse_id UUID,
  p_to_location TEXT,
  p_quantity INTEGER,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_loc TEXT;
  v_to_loc TEXT;
  v_from_qty INTEGER;
  v_to_qty INTEGER;
  v_part_name TEXT;
  v_transfer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作调拨');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '调拨数量必须大于 0');
  END IF;

  v_from_loc := COALESCE(NULLIF(TRIM(COALESCE(p_from_location, '')), ''), '');
  v_to_loc := COALESCE(NULLIF(TRIM(COALESCE(p_to_location, '')), ''), '');

  /* 源和目标不能是同一仓位 */
  IF p_from_warehouse_id = p_to_warehouse_id AND v_from_loc = v_to_loc THEN
    RETURN jsonb_build_object('success', false, 'error', '源仓位和目标仓位相同，无需调拨');
  END IF;

  SELECT name INTO v_part_name FROM parts WHERE id = p_part_id;
  IF v_part_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '配件档案不存在');
  END IF;

  /* 1. 锁源仓位校验并扣减 */
  SELECT quantity INTO v_from_qty FROM public.part_stock_locations
  WHERE part_id = p_part_id AND warehouse_id = p_from_warehouse_id AND COALESCE(location, '') = v_from_loc
  FOR UPDATE;
  IF v_from_qty IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '源仓位没有该配件库存记录');
  END IF;
  IF v_from_qty < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error',
      '源仓位仅剩 ' || v_from_qty || ' 件，不足调拨 ' || p_quantity || ' 件');
  END IF;
  UPDATE public.part_stock_locations SET quantity = quantity - p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_from_warehouse_id AND COALESCE(location, '') = v_from_loc;

  /* 2. 目标仓位加回（无记录补建行；取加之前的数量供流水记 before） */
  SELECT quantity INTO v_to_qty FROM public.part_stock_locations
  WHERE part_id = p_part_id AND warehouse_id = p_to_warehouse_id AND COALESCE(location, '') = v_to_loc;
  UPDATE public.part_stock_locations SET quantity = quantity + p_quantity
  WHERE part_id = p_part_id AND warehouse_id = p_to_warehouse_id AND COALESCE(location, '') = v_to_loc;
  IF NOT FOUND THEN
    INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
    VALUES (p_part_id, p_to_warehouse_id, NULLIF(v_to_loc, ''), p_quantity);
    v_to_qty := 0;
  END IF;

  /* 3. 调拨记录 */
  INSERT INTO public.stock_location_transfers (
    part_id, from_warehouse_id, from_location, to_warehouse_id, to_location, quantity, notes, created_by
  ) VALUES (
    p_part_id, p_from_warehouse_id, NULLIF(v_from_loc, ''),
    p_to_warehouse_id, NULLIF(v_to_loc, ''),
    p_quantity, NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id
  )
  RETURNING id INTO v_transfer_id;

  /* 4. 流水：源仓 -n / 目标仓 +n（before/after 记仓位数量，总库存不变） */
  INSERT INTO inventory_logs (
    part_id, type, change_qty, before_qty, after_qty,
    reference_type, reference_id, operator_id, warehouse_id, location, notes
  ) VALUES
  (
    p_part_id, 'adjust', -p_quantity, v_from_qty, v_from_qty - p_quantity,
    'stock_transfer', v_transfer_id, p_operator_id, p_from_warehouse_id, NULLIF(v_from_loc, ''),
    '仓位调拨转出（总库存不变）: ' || COALESCE(v_part_name, '')
  ),
  (
    p_part_id, 'adjust', p_quantity, v_to_qty, v_to_qty + p_quantity,
    'stock_transfer', v_transfer_id, p_operator_id, p_to_warehouse_id, NULLIF(v_to_loc, ''),
    '仓位调拨转入（总库存不变）: ' || COALESCE(v_part_name, '')
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.transfer_stock_location(uuid, uuid, text, uuid, text, integer, text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_stock_location(uuid, uuid, text, uuid, text, integer, text, uuid) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_v_inventory_log_upgrade.sql') ON CONFLICT DO NOTHING;
