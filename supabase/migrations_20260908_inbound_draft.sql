/* 入库确认单两阶段（2026-09-08）
 *
 * 需求（用户拍板）：
 *   点「生成入库单」后先生成一张入库确认单（draft，不动库存），
 *   确认入库前可打印入库单、打印条形码、修改内容（价格/编码/运费/抹零/销售单号金额），
 *   确认入库后库存增加，入库单和条码仍可补打。
 *
 * 设计要点：
 *   1. inbound_orders 表天生有 status（draft/completed）字段，一直闲置，本次启用
 *   2. draft 即占正式单号（RK-xxx），确认后单号不变，打印件与系统一致；作废跳号可接受
 *   3. draft 分摊算好终值存 inbound_order_items.allocated_cost；
 *      确认入库时服务端把每行 allocated_cost 作为 freight_alloc 手动行回传，
 *      complete 的自动分摊不再触发，确认单上看到的就是最终入账的（零漂移）
 *   4. draft 不动批次/采购单状态 → 现有 complete 的状态校验就是天然防双入库闸门
 *   5. 黄卡（批次）+ 蓝卡（按采购单）两条链路都改两阶段；到货单流程（存量）不动
 *
 * 内容：
 *   一、防重部分唯一索引（同批次/同采购单最多一张 draft）
 *   二、create_batch_inbound_draft：批次版建入库确认单
 *   三、create_purchase_inbound_draft：按采购单版建入库确认单
 *   四、update_inbound_draft：编辑入库确认单（数量不可改）
 *   五、void_inbound_draft：作废（硬删，items 级联删除）
 *   六、重建 complete_batch_inbound：8 参加 p_draft_inbound_id（DROP 旧签名防重载）
 *   七、重建 complete_purchase_inbound：8 参加 p_draft_inbound_id（DROP 旧签名防重载）
 *   八、revoke_pending_storage / move_item_to_batch 加 draft 存在拦截
 *   九、REVOKE 收口 + 验证 + 台账登记
*/

/* ============================================================
   一、防重部分唯一索引
   同一批次/同一采购单最多存在一张 draft 确认单；
   确认翻牌（completed）或作废（删除）后自动释放，可重新生成
   ============================================================ */
CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_draft_batch
  ON public.inbound_orders (receiving_batch_id)
  WHERE status = 'draft' AND receiving_batch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_draft_order
  ON public.inbound_orders (purchase_order_id)
  WHERE status = 'draft' AND purchase_order_id IS NOT NULL;

/* 手动运费标记：draft 编辑界面需要精确还原「该行是手动指定运费还是自动分摊」
   （建单时 freight_alloc 非空即手动行；不加这列编辑保存会把手动行静默洗成自动） */
ALTER TABLE public.inbound_order_items
  ADD COLUMN IF NOT EXISTS freight_manual BOOLEAN NOT NULL DEFAULT false;

/* ============================================================
   二、create_batch_inbound_draft：批次版建入库确认单
   校验口径与 complete_batch_inbound 完全一致（归属/编码必填/销售单对平），
   运单剩余校验额外扣除「其他 draft 已占额度」，提前防两张 draft 都按全额生成。
   只写 inbound_orders(draft) + inbound_order_items，不动任何库存/账务/状态。
   p_items 元素：{purchase_order_item_id, quantity, unit_cost, freight_alloc,
                  batch_no, warehouse_id, location, notes, is_excess}
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

  /* 运单剩余运费校验：completed 已摊 + 其他 draft 已占，提前拦截超额 */
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
    WHERE waybill_id = p_waybill_id AND status = 'draft';
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
    p_waybill_id, 'draft', '收货批次 ' || v_batch.batch_no, p_operator_id,
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
   三、create_purchase_inbound_draft：按采购单版建入库确认单
   校验口径与 complete_purchase_inbound 一致（含到货流程互斥），
   运单取采购单上的 waybill_id（与 complete 一致，不做运单选择/剩余校验）。
   p_items 元素同批次版。
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_purchase_inbound_draft(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_no TEXT DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_existing RECORD;
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
  v_supplier_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许入库(可能已入库或被退回)');
  END IF;

  /* 防双流程：走过到货确认单的采购单必须从到货单入库 */
  IF EXISTS (
    SELECT 1 FROM public.purchase_order_items
    WHERE order_id = p_purchase_order_id AND arrival_item_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该采购单已走到货确认单流程，请从到货单办理入库');
  END IF;

  /* 防重预查 */
  SELECT id, inbound_no INTO v_existing FROM public.inbound_orders
  WHERE purchase_order_id = p_purchase_order_id AND status = 'draft';
  IF FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', '该采购单已生成入库确认单 ' || v_existing.inbound_no || '，请前往确认或先作废',
      'existing_draft_id', v_existing.id);
  END IF;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_order.supplier_id;

  /* 第一遍：校验明细、编码必填、累计货款/数量、分离手动运费行 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本采购单', v_item->>'purchase_order_item_id';
    END IF;
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先在待入库列表补全编码后再生成确认单', COALESCE(v_poi.name, '');
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

  /* 销售单拦截校验 */
  IF p_supplier_order_amount IS NOT NULL THEN
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

  /* 建确认单主表（运单取采购单上的，与 complete 口径一致） */
  INSERT INTO public.inbound_orders (
    purchase_order_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id,
    supplier_order_no, supplier_order_amount, discount_amount
  ) VALUES (
    p_purchase_order_id, v_order.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_order.waybill_id, 'draft', '', p_operator_id,
    NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
    p_supplier_order_amount, COALESCE(p_discount_amount, 0)
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM public.purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
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
   四、update_inbound_draft：编辑入库确认单
   可改：入库价、手动分摊运费、批次号、仓库仓位、备注、单头运费/抹零/
        销售单号/销售单金额/分摊运单；数量不可改（数量错=收货环节错，作废重生成）。
   快照字段（编码/名称/品牌/规格/单位）从 purchase_order_items 重拉——
   编码修改走现有「行内配件关联」通道写 purchase_order_items，本函数自动跟进。
   p_items 元素：{id(inbound_order_items.id), unit_cost, freight_alloc,
                  batch_no, warehouse_id, location, notes}
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

  /* 销售单对平校验 */
  IF p_supplier_order_amount IS NOT NULL THEN
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
   五、void_inbound_draft：作废入库确认单
   draft 未产生任何库存/账务影响，硬删即可（items 级联删除），
   删除后唯一索引自动释放，可重新生成
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_inbound_draft(
  p_draft_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft RECORD;
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
    RETURN jsonb_build_object('success', false, 'error', '该单已确认入库，不能作废（如需调整请走退货流程）');
  END IF;

  DELETE FROM public.inbound_orders WHERE id = p_draft_id;

  RETURN jsonb_build_object('success', true, 'inbound_no', v_draft.inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、重建 complete_batch_inbound（批次入库，8 参）
   改动点（其余逻辑与 0907 版逐行一致）：
     1. 新签名尾部加 p_draft_inbound_id：
        传了 → 锁 draft 校验归属，UPDATE 原单代替 INSERT（单号不变），
                明细 DELETE 后按 p_items 重插，回填合计时翻牌 completed
     2. 没传 → 批次已存在 draft 则拦截（防绕过确认单直接入库导致后续双入库）
     3. 应付描述的销售单号：draft 模式取确认单上的（确认单可改），否则取批次的
   ============================================================ */
DROP FUNCTION IF EXISTS public.complete_batch_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, DECIMAL, UUID);

CREATE FUNCTION public.complete_batch_inbound(
  p_batch_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL,
  p_waybill_id UUID DEFAULT NULL,
  p_draft_inbound_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_draft RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_waybill RECORD;
  v_allocated DECIMAL(12,2);
  v_waybill_remaining DECIMAL(12,2);
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_supplier_order_no TEXT;
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
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_payable DECIMAL(12,2);
  v_order_id UUID;
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

  /* 0.4 入库确认单（2026-09-08 两阶段）：
         传了 draft → 校验归属并以它为载体；没传 → 已有 draft 则拦截 */
  IF p_draft_inbound_id IS NOT NULL THEN
    SELECT * INTO v_draft FROM public.inbound_orders WHERE id = p_draft_inbound_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单不存在');
    END IF;
    IF v_draft.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单已确认，请勿重复操作');
    END IF;
    IF v_draft.receiving_batch_id IS DISTINCT FROM p_batch_id THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单与本批次不匹配');
    END IF;
    /* 应付描述以确认单上的销售单号为准（确认单允许修改） */
    v_supplier_order_no := v_draft.supplier_order_no;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.inbound_orders
      WHERE receiving_batch_id = p_batch_id AND status = 'draft'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '该批次已生成入库确认单，请从入库单详情页确认入库（或先作废确认单）');
    END IF;
    v_supplier_order_no := v_batch.supplier_order_no;
  END IF;

  /* 0.5 运单剩余运费校验：多张销售单可分次摊同一张运单，
         但本次分摊不能超过该运单还没摊完的额度（只算 completed，
         draft 此刻未翻牌不计入，自身不会被重复计算） */
  IF p_waybill_id IS NOT NULL THEN
    SELECT * INTO v_waybill FROM public.logistics_waybills WHERE id = p_waybill_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '运单不存在');
    END IF;
    SELECT COALESCE(SUM(freight_amount), 0) INTO v_allocated
    FROM public.inbound_orders
    WHERE waybill_id = p_waybill_id AND status = 'completed';
    v_waybill_remaining := COALESCE(v_waybill.freight_amount, 0) - v_allocated;
    IF COALESCE(p_freight_amount, 0) - v_waybill_remaining > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '本次分摊运费 ¥' || ROUND(COALESCE(p_freight_amount, 0), 2) ||
        ' 超过该运单剩余未分摊 ¥' || ROUND(v_waybill_remaining, 2) ||
        '（运单总运费 ¥' || ROUND(COALESCE(v_waybill.freight_amount, 0), 2) ||
        '，已分摊 ¥' || ROUND(v_allocated, 2) || '）');
    END IF;
  END IF;

  /* 1. 第一遍：校验明细属于本批次、编码必填、累计货款/数量、分离手动运费行 */
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

    /* 编码必填（2026-09-07 拍板）：无配件档案的行不能入库 */
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先在待入库卡片补全编码后再入库', COALESCE(v_poi.name, '');
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

  /* 1.5 销售单拦截校验：填了总金额才启用 */
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

  /* 2. 入库单主表：draft 模式 UPDATE 原单（单号不变），否则新建 */
  IF p_draft_inbound_id IS NOT NULL THEN
    UPDATE public.inbound_orders
    SET supplier_id = v_batch.supplier_id,
        supplier_name = COALESCE(v_batch.supplier_name, ''),
        freight_amount = COALESCE(p_freight_amount, 0),
        waybill_id = p_waybill_id,
        notes = '收货批次 ' || v_batch.batch_no,
        operator_id = p_operator_id,
        supplier_order_amount = COALESCE(p_supplier_order_amount, NULL),
        discount_amount = COALESCE(p_discount_amount, 0)
        /* supplier_order_no 不在更新列表：保留确认单上（可编辑的）值 */
    WHERE id = p_draft_inbound_id;
    v_inbound_id := v_draft.id;
    v_inbound_no := v_draft.inbound_no;
    /* 清掉 draft 快照行，按 p_items 重插（p_items 本就来自 draft 行，内容等价） */
    DELETE FROM public.inbound_order_items WHERE inbound_order_id = v_inbound_id;
  ELSE
    INSERT INTO public.inbound_orders (
      purchase_order_id, arrival_id, receiving_batch_id, supplier_id, supplier_name,
      total_quantity, total_amount, freight_amount,
      waybill_id, status, notes, operator_id,
      supplier_order_no, supplier_order_amount, discount_amount
    ) VALUES (
      NULL, NULL, p_batch_id, v_batch.supplier_id, COALESCE(v_batch.supplier_name, ''),
      0, 0, COALESCE(p_freight_amount, 0),
      p_waybill_id, 'completed', '收货批次 ' || v_batch.batch_no, p_operator_id,
      v_batch.supplier_order_no,
      COALESCE(p_supplier_order_amount, NULL),
      COALESCE(p_discount_amount, 0)
    )
    RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;
  END IF;

  /* 3. 逐行入库：明细 + 加库存 + 仓位 + 批次 + 流水 + 价格 */
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

    IF v_poi.part_id IS NOT NULL THEN
      UPDATE public.parts
      SET quantity = quantity + v_qty,
          purchase_price = v_unit_cost,
          cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
      WHERE id = v_poi.part_id
      RETURNING quantity INTO v_after_qty;
      v_before_qty := v_after_qty - v_qty;

      IF v_poi.work_order_item_part_id IS NOT NULL THEN
        UPDATE public.work_order_item_parts
        SET cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
        WHERE id = v_poi.work_order_item_part_id;
      END IF;

      IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
        v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
        UPDATE public.part_stock_locations
        SET quantity = quantity + v_qty
        WHERE part_id = v_poi.part_id
          AND warehouse_id = (v_item->>'warehouse_id')::UUID
          AND COALESCE(location, '') = v_loc;
        IF NOT FOUND THEN
          INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
          VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty);
        END IF;
      END IF;

      INSERT INTO public.part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
      VALUES (
        v_poi.part_id,
        NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
        v_qty, v_qty, v_unit_cost, v_batch.supplier_id,
        'purchase', p_batch_id,
        NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
      );

      INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
      VALUES (
        v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
        'inbound_order', v_inbound_id, p_waybill_id, p_operator_id,
        '批次入库: ' || COALESCE(v_poi.name, '') || '（' || v_batch.batch_no || '）'
      );
    END IF;
  END LOOP;

  /* 4. 回填入库单合计（draft 模式同事务翻牌 completed，失败整体回滚可重试） */
  UPDATE public.inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount, status = 'completed'
  WHERE id = v_inbound_id;

  /* 5. 应付款 = 货款 − 抹零（=销售单总金额），按批次合并记一笔；
        销售单号以确认单上的为准（确认单允许修改） */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_batch.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO public.supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_batch.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库(批次 ' || v_batch.batch_no ||
              CASE WHEN v_supplier_order_no IS NOT NULL AND TRIM(v_supplier_order_no) <> ''
                   THEN ' 销售单 ' || TRIM(v_supplier_order_no) ELSE '' END || ')',
            v_inbound_id, 'inbound_order');
  END IF;

  /* 6. 涉及采购单：全部行已处理的转已完成 */
  FOR v_order_id IN
    SELECT DISTINCT order_id FROM public.purchase_order_items WHERE receiving_batch_id = p_batch_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items
      WHERE order_id = v_order_id AND handle_action IS NULL
    ) THEN
      UPDATE public.purchase_orders SET status = 'completed' WHERE id = v_order_id;
    END IF;
  END LOOP;

  /* 7. 批次转已入库 */
  UPDATE public.receiving_batches SET status = 'inbounded', inbounded_at = NOW() WHERE id = p_batch_id;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   七、重建 complete_purchase_inbound（按采购单入库，8 参）
   改动点同第六节：p_draft_inbound_id 校验归属、UPDATE 代替 INSERT、
   DELETE 重插明细、翻牌 completed；没传时已有 draft 则拦截。
   必须先 DROP 7 参旧签名，否则新旧重载共存、旧签名仍可被调绕过拦截。
   ============================================================ */
DROP FUNCTION IF EXISTS public.complete_purchase_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, TEXT, NUMERIC);

CREATE FUNCTION public.complete_purchase_inbound(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_no TEXT DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL,
  p_draft_inbound_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_draft RECORD;
  v_item JSONB;
  v_poi RECORD;
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
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
  v_payable DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 锁定采购单并校验状态(防并发重复入库) */
  SELECT * INTO v_order
  FROM purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许入库(可能已入库或被退回)');
  END IF;

  /* 1.4 入库确认单（2026-09-08 两阶段）：同批次版口径 */
  IF p_draft_inbound_id IS NOT NULL THEN
    SELECT * INTO v_draft FROM public.inbound_orders WHERE id = p_draft_inbound_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单不存在');
    END IF;
    IF v_draft.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单已确认，请勿重复操作');
    END IF;
    IF v_draft.purchase_order_id IS DISTINCT FROM p_purchase_order_id THEN
      RETURN jsonb_build_object('success', false, 'error', '入库确认单与本采购单不匹配');
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.inbound_orders
      WHERE purchase_order_id = p_purchase_order_id AND status = 'draft'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '该采购单已生成入库确认单，请从入库单详情页确认入库（或先作废确认单）');
    END IF;
  END IF;

  /* 1.5 防双流程(2026-08-20 二期):走过到货确认单的采购单必须从没到货单入库 */
  IF EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND arrival_item_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该采购单已走到货确认单流程，请从到货单办理入库');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

  /* 2. 第一遍扫描：校验明细、编码必填、累计货款/数量、分离手动运费行 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    /* 以服务端采购明细为准取快照字段,不信客户端 */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本采购单', v_item->>'purchase_order_item_id';
    END IF;

    /* 编码必填（2026-09-07 拍板）：无配件档案的行不能入库 */
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先在待入库列表补全编码后再入库', COALESCE(v_poi.name, '');
    END IF;

    /* 自定义入库价优先（对销售单改价），缺省采购明细价 */
    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, '');
    END IF;

    v_line_amount := v_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_qty;

    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      /* 手动指定运费的行：锁定，不参与自动分摊 */
      v_manual_freight := v_manual_freight + COALESCE((v_item->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;

  /* 2.5 销售单拦截校验（2026-08-21 拍板）：填了销售单总金额才启用；
         Σ(入库价×数量) − 优惠抹零(减项) 必须等于销售单总金额，否则拦住 */
  IF p_supplier_order_amount IS NOT NULL THEN
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

  /* 3. 入库单主表：draft 模式 UPDATE 原单（单号不变），否则新建 */
  IF p_draft_inbound_id IS NOT NULL THEN
    UPDATE inbound_orders
    SET supplier_id = v_order.supplier_id,
        supplier_name = COALESCE(v_supplier_name, ''),
        freight_amount = COALESCE(p_freight_amount, 0),
        waybill_id = v_order.waybill_id,
        operator_id = p_operator_id,
        supplier_order_no = NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
        supplier_order_amount = p_supplier_order_amount,
        discount_amount = COALESCE(p_discount_amount, 0)
    WHERE id = p_draft_inbound_id;
    v_inbound_id := v_draft.id;
    v_inbound_no := v_draft.inbound_no;
    DELETE FROM inbound_order_items WHERE inbound_order_id = v_inbound_id;
  ELSE
    INSERT INTO inbound_orders (
      purchase_order_id, supplier_id, supplier_name,
      total_quantity, total_amount, freight_amount,
      waybill_id, status, notes, operator_id,
      supplier_order_no, supplier_order_amount, discount_amount
    ) VALUES (
      p_purchase_order_id, v_order.supplier_id, COALESCE(v_supplier_name, ''),
      0, 0, COALESCE(p_freight_amount, 0),
      v_order.waybill_id, 'completed', '', p_operator_id,
      NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
      p_supplier_order_amount, COALESCE(p_discount_amount, 0)
    )
    RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;
  END IF;

  /* 3.5 销售单号/金额回写采购单（收货时没填、入库时补录的场景） */
  IF NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), '') IS NOT NULL THEN
    UPDATE purchase_orders
    SET supplier_order_no = TRIM(p_supplier_order_no),
        supplier_order_amount = COALESCE(p_supplier_order_amount, supplier_order_amount)
    WHERE id = p_purchase_order_id;
  END IF;

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;

    v_unit_cost := COALESCE((v_item->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0);

    /* 运费分摊：手动行用指定值；其余按行金额占比分摊剩余运费 */
    IF (v_item->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_item->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_qty * v_unit_cost + v_alloc;

    INSERT INTO inbound_order_items (
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

    IF v_poi.part_id IS NULL THEN CONTINUE; END IF;

    /* 加库存 + 更新价格（2026-08-21 口径）：
       purchase_price = 裸采购价（销售单入库单价）
       cost_price     = 采购价 + 单位运费分摊（本单成本价） */
    UPDATE parts
    SET quantity = quantity + v_qty,
        purchase_price = v_unit_cost,
        cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
    WHERE id = v_poi.part_id
    RETURNING quantity INTO v_after_qty;
    v_before_qty := v_after_qty - v_qty;

    /* 工单配件行成本价同步（毛利计算基准，该列 5 月已建但从未启用） */
    IF v_poi.work_order_item_part_id IS NOT NULL THEN
      UPDATE work_order_item_parts
      SET cost_price = v_unit_cost + ROUND(v_alloc / v_qty, 2)
      WHERE id = v_poi.work_order_item_part_id;
    END IF;

    /* 仓位库存:空仓位统一按空串口径匹配/存储 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      UPDATE part_stock_locations
      SET quantity = quantity + v_qty
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty);
      END IF;
    END IF;

    /* 批次（unit_cost 记裸入库价，分摊成本在 allocated_cost/配件档案） */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty, v_unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    /* 库存流水 */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
      'inbound_order', v_inbound_id, v_order.waybill_id, p_operator_id,
      '采购入库: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), '') IS NOT NULL
             THEN ' 批次:' || TRIM(v_item->>'batch_no') ELSE '' END
    );
  END LOOP;

  /* 5. 回填入库单合计（draft 模式同事务翻牌 completed） */
  UPDATE inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount, status = 'completed'
  WHERE id = v_inbound_id;

  /* 6. 破损/错发/弃货类:退库减库存 */
  FOR v_ret IN
    SELECT * FROM purchase_order_items
    WHERE order_id = p_purchase_order_id
      AND handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
  LOOP
    v_ret_qty := v_ret.quantity;
    IF v_ret.part_id IS NOT NULL AND v_ret_qty > 0 THEN
      UPDATE parts SET quantity = GREATEST(0, quantity - v_ret_qty)
      WHERE id = v_ret.part_id;
    END IF;
  END LOOP;

  /* 7. 应付款 = 货款 − 抹零（有销售单时即销售单总金额，已校验相等）；
        运费单独和物流公司结算，不进供应商账 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_order.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_order.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库' || CASE WHEN p_supplier_order_no IS NOT NULL AND TRIM(p_supplier_order_no) <> ''
                              THEN '(销售单 ' || TRIM(p_supplier_order_no) || ')' ELSE '' END,
            v_inbound_id, 'inbound_order');
  END IF;

  /* 8. 采购单状态 → 已完成 */
  UPDATE purchase_orders SET status = 'completed' WHERE id = p_purchase_order_id;

  /* 8.5 关联工单配件行标记已到货 */
  UPDATE work_order_item_parts
  SET is_arrived = true
  WHERE id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  );

  /* 9. 自动生成待退货记录(破损/错发/多发退货) */
  INSERT INTO supplier_return_records (work_order_item_part_id, return_reason, quantity, supplier_name, photos, status)
  SELECT
    poi.work_order_item_part_id,
    CASE poi.handle_action
      WHEN 'broken_exchange' THEN 'damaged'
      WHEN 'broken_discard'  THEN 'damaged'
      WHEN 'wrong_exchange'  THEN 'wrong_ship'
      WHEN 'wrong_discard'   THEN 'wrong_ship'
      WHEN 'excess_return'   THEN 'excess'
    END,
    CASE WHEN poi.handle_action = 'excess_return'
         THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
         ELSE poi.quantity END,
    COALESCE(v_supplier_name, ''),
    (SELECT ARRAY(SELECT jsonb_array_elements_text(poi.evidence_photos))),
    'pending'
  FROM purchase_order_items poi
  WHERE poi.order_id = p_purchase_order_id
    AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard','excess_return')
    AND poi.work_order_item_part_id IS NOT NULL
    AND CASE WHEN poi.handle_action = 'excess_return'
             THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
             ELSE poi.quantity END > 0;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   八、revoke_pending_storage / move_item_to_batch 加 draft 存在拦截
   draft 已按当时明细快照建单，退回待收货/跨批次移动会导致确认时校验失败，
   必须先作废确认单（函数体与现行版一致，只加拦截段）
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_pending_storage(
  p_purchase_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅待入库状态可退回');
  END IF;

  /* 入库确认单拦截（2026-09-08）：已生成确认单的采购单须先作废确认单 */
  IF EXISTS (
    SELECT 1 FROM public.inbound_orders
    WHERE purchase_order_id = p_purchase_order_id AND status = 'draft'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '该采购单已生成入库确认单，请先在入库单详情页作废确认单');
  END IF;

  /* 1. 删除该单配件行关联的补货分支(未采购未到货的 purchase_reason 克隆行) */
  DELETE FROM work_order_item_parts
  WHERE work_order_item_id IN (
    SELECT DISTINCT p.work_order_item_id
    FROM purchase_order_items poi
    JOIN work_order_item_parts p ON p.id = poi.work_order_item_part_id
    WHERE poi.order_id = p_purchase_order_id
      AND poi.work_order_item_part_id IS NOT NULL
  )
  AND purchase_reason IS NOT NULL
  AND is_purchased = false
  AND is_arrived = false;

  /* 2. 删除该单生成的待退货记录 */
  DELETE FROM supplier_return_records
  WHERE work_order_item_part_id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  )
  AND status = 'pending';

  /* 3. 清空明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
  WHERE order_id = p_purchase_order_id;

  /* 4. 状态回已提交 */
  UPDATE purchase_orders SET status = 'submitted' WHERE id = p_purchase_order_id;

  /* 5. 运单回退:同运单下无其他待入库单才回退 */
  IF v_order.waybill_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM purchase_orders
       WHERE waybill_id = v_order.waybill_id
         AND status = 'pending_storage'
         AND id <> p_purchase_order_id
     ) THEN
    UPDATE logistics_waybills SET status = 'pending', received_at = NULL
    WHERE id = v_order.waybill_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.move_item_to_batch(
  p_item_id UUID,
  p_target_batch_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_src RECORD;
  v_tgt RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_item FROM public.purchase_order_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;
  IF v_item.receiving_batch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件不在任何收货批次中');
  END IF;
  IF v_item.receiving_batch_id = p_target_batch_id THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件已在目标批次中');
  END IF;

  SELECT * INTO v_src FROM public.receiving_batches WHERE id = v_item.receiving_batch_id FOR UPDATE;
  SELECT * INTO v_tgt FROM public.receiving_batches WHERE id = p_target_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '目标批次不存在');
  END IF;
  IF v_src.status <> 'pending_storage' OR v_tgt.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '已入库的批次不能调整配件归属');
  END IF;

  /* 入库确认单拦截（2026-09-08）：源/目标批次有确认单时禁止移动
     （确认单已按当时明细快照建单，移动会导致确认时「明细不属于本批次」校验失败） */
  IF EXISTS (
    SELECT 1 FROM public.inbound_orders
    WHERE status = 'draft'
      AND (receiving_batch_id = v_item.receiving_batch_id OR receiving_batch_id = p_target_batch_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '源批次或目标批次已生成入库确认单，请先确认或作废确认单再移动配件');
  END IF;

  /* 同供应商限制（2026-09-07 拍板）：不同供应商的账不能混在一起 */
  IF v_src.supplier_id IS DISTINCT FROM v_tgt.supplier_id THEN
    RETURN jsonb_build_object('success', false, 'error', '只能移动到同一供应商的收货批次（不同供应商的账不能混在一起）');
  END IF;

  /* 移到目标批次末尾；源批次留的空洞不影响显示，下次拖排序自然重排 */
  UPDATE public.purchase_order_items
  SET receiving_batch_id = p_target_batch_id,
      sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1
                    FROM public.purchase_order_items
                    WHERE receiving_batch_id = p_target_batch_id)
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'source_batch_no', v_src.batch_no,
    'target_batch_no', v_tgt.batch_no
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   九、旧签名兼容 wrapper（过渡用）
   迁移执行后、前端部署完成前的窗口期，旧前端仍按 7 参旧签名调 RPC；
   建两个转调 wrapper 防止窗口期「函数不存在」报错。
   wrapper 以 p_draft_inbound_id=NULL 转调新函数——旧流程不会产生 draft，
   「无 draft 时存在性拦截」不会触发，行为与旧版完全一致。
   下次迁移可 DROP 这两个 wrapper（前端全部走两阶段后）。
   ============================================================ */
CREATE FUNCTION public.complete_batch_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, DECIMAL, UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.complete_batch_inbound($1, $2, $3, $4, $5, $6, $7, NULL::UUID);
$$ LANGUAGE SQL;

CREATE FUNCTION public.complete_purchase_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, TEXT, NUMERIC)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.complete_purchase_inbound($1, $2, $3, $4, $5, $6, $7, NULL::UUID);
$$ LANGUAGE SQL;

/* ============================================================
   十、REVOKE 收口（连 PUBLIC 一起收，只收 anon 收不干净）
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.create_batch_inbound_draft(uuid, jsonb, numeric, uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_purchase_inbound_draft(uuid, jsonb, numeric, uuid, numeric, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_inbound_draft(uuid, jsonb, numeric, numeric, text, numeric, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_inbound_draft(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric) FROM PUBLIC, anon;

/* 权限验证：anon 必须真的收不到（防 PUBLIC 暗道） */
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.create_batch_inbound_draft(uuid, jsonb, numeric, uuid, numeric, numeric, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_purchase_inbound_draft(uuid, jsonb, numeric, uuid, numeric, text, numeric)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_inbound_draft(uuid, jsonb, numeric, numeric, text, numeric, uuid, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.void_inbound_draft(uuid, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric, uuid, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '权限回收失败：anon 仍可执行新函数';
  END IF;
END $$;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260908_inbound_draft.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证（执行完后跑）：
   1. 防重索引：SELECT indexname FROM pg_indexes WHERE tablename='inbound_orders'
      AND indexname LIKE 'ux_inbound_draft%'; 应 2 行
   2. 新函数：SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('create_batch_inbound_draft','create_purchase_inbound_draft',
                      'update_inbound_draft','void_inbound_draft'); 应 4 行
   3. complete 新签名（8 参数）：SELECT proname, pronargs FROM pg_proc
      WHERE proname IN ('complete_batch_inbound','complete_purchase_inbound');
      应各 1 行且 pronargs=8（旧 7 参签名已 DROP）
   ============================================================
*/
