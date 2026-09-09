/* ============================================================
   批次卡单运单 + 销售单总金额必填
   创建日期: 2026-09-09
   背景: 待入库批次卡（黄卡）试用后三点修正——
         1. 一张批次卡只关联一张运单，且可在卡片上变更（不限供应商，
            从全部待签收运单中选）。receiving_batches 需要自己的 waybill_id。
         2. 生成入库确认单时，客户端没传分摊运单则默认取批次关联运单。
         3. 入库确认单的「供应商销售单总金额」从选填改必填：未填不能保存。
   内容:
     一、receiving_batches 加 waybill_id 列 + 索引 + 注释
     二、存量批次回填（卡内配件行运单去重恰好一张才带入）
     三、receive_staged_batch：批次创建时定初始 waybill_id
     四、create_batch_inbound_draft：分摊运单兜底取批次运单
     五、update_inbound_draft：销售单总金额必填
     六、REVOKE 收口 + 权限验证 + 台账登记
   说明:
     - 三个函数均为 CREATE OR REPLACE，签名与线上完全一致
       （执行前已用 pg_get_function_arguments 核对，不会产生新重载）。
     - complete_batch_inbound / complete_purchase_inbound 不动：
       update_inbound_draft 保证金额非空后，complete 里「填了才校验对平」必然生效；
       存量 NULL 金额旧单由 Server Action「确认入库单」前置拦截。
   ============================================================ */

/* ============================================================
   一、receiving_batches 加 waybill_id（批次关联运单）
   口径: 这批货跟着哪张运单来的（展示 + 生成确认单时的默认分摊运单），
         可变更；入库单实际账务分摊运单仍以 inbound_orders.waybill_id 为准
   ============================================================ */
ALTER TABLE public.receiving_batches
  ADD COLUMN IF NOT EXISTS waybill_id UUID REFERENCES public.logistics_waybills(id);

COMMENT ON COLUMN public.receiving_batches.waybill_id IS
  '批次关联运单（2026-09-09）：一张批次卡只挂一张运单，可在待入库卡片变更；仅展示/默认分摊用，入库单实际分摊运单以 inbound_orders.waybill_id 为准';

CREATE INDEX IF NOT EXISTS ix_receiving_batches_waybill
  ON public.receiving_batches (waybill_id) WHERE waybill_id IS NOT NULL;

/* ============================================================
   二、存量批次回填：卡内配件行运单（行级优先、回退采购单单头）
      去重后恰好一张才带入；多张/没有则留 NULL，由用户「变更运单」指定
   ============================================================ */
UPDATE public.receiving_batches b
SET waybill_id = t.waybill_id
FROM (
  /* 注意：PostgreSQL 没有 min(uuid)，用 ARRAY_AGG 取第一个值（HAVING 已保证全组同值） */
  SELECT receiving_batch_id, (ARRAY_AGG(waybill_id))[1] AS waybill_id
  FROM (
    SELECT poi.receiving_batch_id,
           COALESCE(poi.waybill_id, o.waybill_id) AS waybill_id
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders o ON o.id = poi.order_id
    WHERE poi.receiving_batch_id IS NOT NULL
  ) w
  WHERE waybill_id IS NOT NULL
  GROUP BY receiving_batch_id
  HAVING COUNT(DISTINCT waybill_id) = 1
) t
WHERE b.id = t.receiving_batch_id AND b.waybill_id IS NULL;

/* ============================================================
   三、receive_staged_batch：批次创建时定初始 waybill_id
      逻辑同回填——行运单去重恰好一张才带入，否则留 NULL
      （函数体与 0904 版逐字一致，仅在尾部新增初始值段）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.receive_staged_batch(
  p_supplier_id UUID,
  p_supplier_order_no TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_res JSONB;
  v_count INTEGER := 0;
  v_batch_id UUID;
  v_batch_no TEXT;
  v_date_str TEXT;
  v_seq INTEGER;
  v_supplier_name TEXT;
  v_order_ids UUID[] := '{}';
  v_waybill_count INTEGER;
  v_waybill_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 批次号：SH-YYYYMMDD-序号（当日序号，咨询锁防重号） */
  v_date_str := to_char(NOW(), 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext('receiving_batch_no_' || v_date_str));
  SELECT COUNT(*) + 1 INTO v_seq FROM public.receiving_batches WHERE batch_no LIKE 'SH-' || v_date_str || '-%';
  v_batch_no := 'SH-' || v_date_str || '-' || lpad(v_seq::TEXT, 3, '0');

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = p_supplier_id;

  INSERT INTO public.receiving_batches (batch_no, supplier_id, supplier_name, supplier_order_no, status, created_by)
  VALUES (v_batch_no, p_supplier_id, COALESCE(v_supplier_name, ''),
          NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''), 'pending_storage', p_operator_id)
  RETURNING id INTO v_batch_id;

  /* 逐行调既有收货事务函数；它返回 success:false 不抛异常，这里手动 RAISE 让整批回滚 */
  FOR v_row IN
    SELECT poi.id, poi.order_id, poi.staged_action, poi.staged_qty, poi.staged_evidence
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders o ON o.id = poi.order_id
    WHERE o.supplier_id = p_supplier_id
      AND poi.staged_at IS NOT NULL
      AND poi.handle_action IS NULL
    ORDER BY poi.staged_at
    FOR UPDATE OF poi
  LOOP
    v_res := public.receive_purchase_item(
      v_row.order_id, v_row.id, v_row.staged_action, v_row.staged_qty,
      v_row.staged_evidence, true, p_operator_id
    );
    IF NOT COALESCE((v_res->>'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '配件 % 提交失败: %', v_row.id, COALESCE(v_res->>'error', '未知错误');
    END IF;

    /* 清暂存 + 写批次关联 */
    UPDATE public.purchase_order_items
    SET staged_qty = NULL, staged_action = NULL, staged_evidence = NULL, staged_at = NULL, staged_by = NULL,
        receiving_batch_id = v_batch_id
    WHERE id = v_row.id;

    v_count := v_count + 1;
    IF NOT v_row.order_id = ANY(v_order_ids) THEN
      v_order_ids := array_append(v_order_ids, v_row.order_id);
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION '该供应商没有待提交的暂存收货';
  END IF;

  /* 销售单号同步写到涉及的所有采购单（对账用） */
  IF NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), '') IS NOT NULL THEN
    UPDATE public.purchase_orders
    SET supplier_order_no = TRIM(p_supplier_order_no)
    WHERE id = ANY(v_order_ids);
  END IF;

  /* 批次关联运单初始值（2026-09-09）：卡内配件行运单（行级优先、回退采购单单头）
     去重后恰好一张才带入；多张或没有则留 NULL，由待入库卡片「变更运单」指定。
     注意：PostgreSQL 没有 min(uuid)，用 ARRAY_AGG 取第一个值（COUNT 已保证全组同值） */
  SELECT COUNT(DISTINCT w), (ARRAY_AGG(w))[1] INTO v_waybill_count, v_waybill_id
  FROM (
    SELECT COALESCE(poi.waybill_id, o.waybill_id) AS w
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders o ON o.id = poi.order_id
    WHERE poi.receiving_batch_id = v_batch_id
  ) t
  WHERE w IS NOT NULL;

  IF v_waybill_count = 1 THEN
    UPDATE public.receiving_batches SET waybill_id = v_waybill_id WHERE id = v_batch_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'count', v_count, 'batch_id', v_batch_id, 'batch_no', v_batch_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   四、create_batch_inbound_draft：分摊运单兜底取批次运单
      改动点（相对 0908 版）：
      1. DECLARE 加 v_alloc_waybill_id
      2. 锁批次后归一化：v_alloc_waybill_id := COALESCE(p_waybill_id, v_batch.waybill_id)
      3. 运单剩余校验段和 INSERT 全部改用 v_alloc_waybill_id
      其余逐字不动
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_batch_inbound_draft(
  p_batch_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_waybill RECORD;
  v_existing RECORD;
  v_allocated DECIMAL(12,2);
  v_draft_allocated DECIMAL(12,2);
  v_waybill_remaining DECIMAL(12,2);
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;
  v_auto_amount DECIMAL(12,2) := 0;
  v_remain_freight DECIMAL(12,2) := 0;
  v_line_amount DECIMAL(12,2);
  /* 归一化后的分摊运单（2026-09-09）：客户端没传时取批次关联运单 */
  v_alloc_waybill_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_batch FROM public.receiving_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '收货批次不存在');
  END IF;
  IF v_batch.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '该批次已入库或状态不允许');
  END IF;

  /* 防重预查（唯一索引兜底并发）：给出友好报错和已有单号 */
  SELECT id, inbound_no INTO v_existing FROM public.inbound_orders
  WHERE receiving_batch_id = p_batch_id AND status = 'draft';
  IF FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', '该批次已生成入库确认单 ' || v_existing.inbound_no || '，请前往确认或先作废',
      'existing_draft_id', v_existing.id);
  END IF;

  /* 分摊运单兜底（2026-09-09）：客户端没传时默认取批次关联运单，
     保证「批次关联运单」与「入库单分摊运单」默认一致 */
  v_alloc_waybill_id := COALESCE(p_waybill_id, v_batch.waybill_id);

  /* 运单剩余运费校验：completed 已摊 + 其他 draft 已占，提前拦截超额 */
  IF v_alloc_waybill_id IS NOT NULL THEN
    SELECT * INTO v_waybill FROM public.logistics_waybills WHERE id = v_alloc_waybill_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '运单不存在');
    END IF;
    SELECT COALESCE(SUM(freight_amount), 0) INTO v_allocated
    FROM public.inbound_orders
    WHERE waybill_id = v_alloc_waybill_id AND status = 'completed';
    SELECT COALESCE(SUM(freight_amount), 0) INTO v_draft_allocated
    FROM public.inbound_orders
    WHERE waybill_id = v_alloc_waybill_id AND status = 'draft';
    v_waybill_remaining := COALESCE(v_waybill.freight_amount, 0) - v_allocated - v_draft_allocated;
    IF COALESCE(p_freight_amount, 0) - v_waybill_remaining > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '本次分摊运费 ¥' || ROUND(COALESCE(p_freight_amount, 0), 2) ||
        ' 超过该运单剩余未分摊 ¥' || ROUND(v_waybill_remaining, 2) ||
        '（运单总运费 ¥' || ROUND(COALESCE(v_waybill.freight_amount, 0), 2) ||
        '，已分摊/已占用 ¥' || ROUND(v_allocated + v_draft_allocated, 2) || '）');
    END IF;
  END IF;

  /* 第一遍：校验明细属于本批次、编码必填、累计货款/数量、分离手动运费行 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND receiving_batch_id = p_batch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本收货批次', v_item->>'purchase_order_item_id';
    END IF;
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先在待入库卡片补全编码后再生成确认单', COALESCE(v_poi.name, '');
    END IF;

    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, '');
    END IF;

    v_line_amount := v_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_qty;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_manual_freight := v_manual_freight + COALESCE((v_item->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;

  /* 销售单拦截校验：填了总金额才启用 */
  IF COALESCE(p_supplier_order_amount, NULL) IS NOT NULL THEN
    IF ABS((v_goods_amount - COALESCE(p_discount_amount, 0)) - p_supplier_order_amount) > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '入库货款合计 ¥' || ROUND(v_goods_amount, 2) ||
        ' − 抹零 ¥' || ROUND(COALESCE(p_discount_amount, 0), 2) ||
        ' ≠ 销售单总金额 ¥' || ROUND(p_supplier_order_amount, 2) ||
        '，请逐行核对入库单价，或在「优惠抹零」填入差额');
    END IF;
  END IF;

  v_remain_freight := COALESCE(p_freight_amount, 0) - v_manual_freight;
  IF v_remain_freight < 0 THEN v_remain_freight := 0; END IF;

  /* 建确认单主表（draft 即占正式单号，确认后不变） */
  INSERT INTO public.inbound_orders (
    purchase_order_id, arrival_id, receiving_batch_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id,
    supplier_order_no, supplier_order_amount, discount_amount
  ) VALUES (
    NULL, NULL, p_batch_id, v_batch.supplier_id, COALESCE(v_batch.supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_alloc_waybill_id, 'draft', '收货批次 ' || v_batch.batch_no, p_operator_id,
    v_batch.supplier_order_no,
    COALESCE(p_supplier_order_amount, NULL),
    COALESCE(p_discount_amount, 0)
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 逐行写明细：分摊算好终值存 allocated_cost（确认时按手动行回传，零漂移） */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID;
    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_item->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_qty * v_unit_cost + v_alloc;

    INSERT INTO public.inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost, freight_manual,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc, (v_item->>'freight_alloc') IS NOT NULL,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );
  END LOOP;

  UPDATE public.inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  RETURN jsonb_build_object('success', true, 'draft_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、update_inbound_draft：销售单总金额必填（2026-09-09）
      改动点（相对 0908 版）：对平校验段前加 NULL 拦截，其余逐字不动
   ============================================================ */
CREATE OR REPLACE FUNCTION public.update_inbound_draft(
  p_draft_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_no TEXT DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL,
  p_operator_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft RECORD;
  v_item JSONB;
  v_ioi RECORD;
  v_poi RECORD;
  v_waybill RECORD;
  v_allocated DECIMAL(12,2);
  v_draft_allocated DECIMAL(12,2);
  v_waybill_remaining DECIMAL(12,2);
  v_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;
  v_auto_amount DECIMAL(12,2) := 0;
  v_remain_freight DECIMAL(12,2) := 0;
  v_line_amount DECIMAL(12,2);
  /* 第一遍扫描时暂存合并后的行数据（旧行数量/采购明细 id + 新表单值），
     避免「先 DELETE 再查旧行」找不到记录的问题 */
  v_rows JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_draft FROM public.inbound_orders WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '入库确认单不存在');
  END IF;
  IF v_draft.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', '该单已确认入库，不能再修改');
  END IF;

  /* 运单剩余校验（仅批次来源可换运单）：排除自身已占额度 */
  IF p_waybill_id IS NOT NULL THEN
    SELECT * INTO v_waybill FROM public.logistics_waybills WHERE id = p_waybill_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '运单不存在');
    END IF;
    SELECT COALESCE(SUM(freight_amount), 0) INTO v_allocated
    FROM public.inbound_orders
    WHERE waybill_id = p_waybill_id AND status = 'completed';
    SELECT COALESCE(SUM(freight_amount), 0) INTO v_draft_allocated
    FROM public.inbound_orders
    WHERE waybill_id = p_waybill_id AND status = 'draft' AND id <> p_draft_id;
    v_waybill_remaining := COALESCE(v_waybill.freight_amount, 0) - v_allocated - v_draft_allocated;
    IF COALESCE(p_freight_amount, 0) - v_waybill_remaining > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '本次分摊运费 ¥' || ROUND(COALESCE(p_freight_amount, 0), 2) ||
        ' 超过该运单剩余未分摊 ¥' || ROUND(v_waybill_remaining, 2));
    END IF;
  END IF;

  /* 第一遍：逐行校验 + 累计（数量取 draft 行原值，不信客户端） */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    SELECT * INTO v_ioi FROM public.inbound_order_items
    WHERE id = (v_item->>'id')::UUID AND inbound_order_id = p_draft_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '明细行 % 不属于本确认单', v_item->>'id';
    END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items WHERE id = v_ioi.purchase_order_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细已被删除，请作废确认单后重新生成';
    END IF;

    v_qty := v_ioi.quantity;
    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_ioi.unit_cost, 0);
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_ioi.name, '');
    END IF;

    v_line_amount := v_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_qty;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_manual_freight := v_manual_freight + COALESCE((v_item->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;

    /* 暂存合并后的行（旧数量/采购明细 id + 新表单值），第二遍重插用 */
    v_rows := v_rows || jsonb_build_object(
      'purchase_order_item_id', v_ioi.purchase_order_item_id,
      'quantity', v_qty,
      'unit_cost', v_unit_cost,
      'freight_alloc', (v_item->>'freight_alloc')::DECIMAL,
      'batch_no', v_item->>'batch_no',
      'warehouse_id', v_item->>'warehouse_id',
      'location', v_item->>'location',
      'notes', v_item->>'notes'
    );
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '确认单明细不能为空');
  END IF;

  /* 销售单对平校验（2026-09-09 起金额必填：未填直接拒绝保存） */
  IF p_supplier_order_amount IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商销售单总金额必填，请填写后再保存');
  END IF;
  IF ABS((v_goods_amount - COALESCE(p_discount_amount, 0)) - p_supplier_order_amount) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error',
      '入库货款合计 ¥' || ROUND(v_goods_amount, 2) ||
      ' − 抹零 ¥' || ROUND(COALESCE(p_discount_amount, 0), 2) ||
      ' ≠ 销售单总金额 ¥' || ROUND(p_supplier_order_amount, 2) ||
      '，请逐行核对入库单价，或在「优惠抹零」填入差额');
  END IF;

  v_remain_freight := COALESCE(p_freight_amount, 0) - v_manual_freight;
  IF v_remain_freight < 0 THEN v_remain_freight := 0; END IF;

  /* 单头全量更新（前端始终传表单完整值）；批次来源的销售单号允许改，
     确认时以确认单上的为准（不回写批次原始凭证号） */
  UPDATE public.inbound_orders
  SET freight_amount = COALESCE(p_freight_amount, 0),
      discount_amount = COALESCE(p_discount_amount, 0),
      supplier_order_no = NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
      supplier_order_amount = p_supplier_order_amount,
      waybill_id = p_waybill_id,
      operator_id = COALESCE(p_operator_id, operator_id)
  WHERE id = p_draft_id;

  /* 明细重插：快照从 purchase_order_items 重拉（编码经行内关联改过会自动跟进） */
  DELETE FROM public.inbound_order_items WHERE inbound_order_id = p_draft_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_rows)
  LOOP
    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细已被删除，请作废确认单后重新生成';
    END IF;

    v_qty := (v_item->>'quantity')::INTEGER;
    v_unit_cost := (v_item->>'unit_cost')::DECIMAL;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND((v_item->>'freight_alloc')::DECIMAL, 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_qty * v_unit_cost + v_alloc;

    INSERT INTO public.inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost, freight_manual,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      p_draft_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc, (v_item->>'freight_alloc') IS NOT NULL,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );
  END LOOP;

  UPDATE public.inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = p_draft_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、REVOKE 收口（连 PUBLIC 一起收，只收 anon 收不干净）
      CREATE OR REPLACE 会保留原有授权，按项目惯例再收一遍兜底
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.receive_staged_batch(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_batch_inbound_draft(uuid, jsonb, numeric, uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_inbound_draft(uuid, jsonb, numeric, numeric, text, numeric, uuid, uuid) FROM PUBLIC, anon;

/* 权限验证：anon 必须真的收不到（防 PUBLIC 暗道） */
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.receive_staged_batch(uuid, text, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_batch_inbound_draft(uuid, jsonb, numeric, uuid, numeric, numeric, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_inbound_draft(uuid, jsonb, numeric, numeric, text, numeric, uuid, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '权限回收失败：anon 仍可执行函数';
  END IF;
END $$;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260909_batch_waybill.sql', '批次卡单运单(加waybill_id+回填+创建/建单带入)+销售单总金额必填')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证（执行完后跑）：
   1. 列与索引：SELECT column_name FROM information_schema.columns
      WHERE table_name='receiving_batches' AND column_name='waybill_id'; 应 1 行
      SELECT indexname FROM pg_indexes WHERE tablename='receiving_batches'
      AND indexname='ix_receiving_batches_waybill'; 应 1 行
   2. 函数签名未变（防新重载）：SELECT proname, pronargs FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname IN
      ('receive_staged_batch','create_batch_inbound_draft','update_inbound_draft')
      ORDER BY proname; 应 3 行，pronargs 分别为 3/7/8
   ============================================================
*/
