/* 待入库批次卡片化（2026-09-07）
 *
 * 需求（用户拍板）：
 *   1. 待入库按销售单（收货批次）卡片式展示，卡片内配件可拖拽排序、顺序存库
 *   2. 零件编码必填：所有入库入口（批次/老流程按单/到货单）没有配件档案的行一律拦截
 *   3. 批次入库可指定分摊的运单：写 inbound_orders.waybill_id，
 *      且本次运费不能超过该运单「剩余未分摊」额度（多张销售单分次摊同一张运单）
 *   4. 配件可跨批次移动归属（改 receiving_batch_id），限制同供应商
 *
 * 内容：
 *   一、purchase_order_items 加 sort_order（批次内对照销售单排序）+ 存量回填 + 索引
 *   二、重建 complete_batch_inbound：新签名加 p_waybill_id（先 DROP 旧签名防重载静默生效）
 *   三、complete_purchase_inbound 加 part_id 必填校验（签名不变，CREATE OR REPLACE 安全）
 *   四、complete_arrival_inbound 加 part_id 必填校验（到货明细/采购明细两边都空才拦，防历史单死锁）
 *   五、新函数 save_batch_sort_order（保存批次内排序）
 *   六、新函数 move_item_to_batch（配件跨批次移动，限同供应商）
 *   七、REVOKE 收口 + has_function_privilege 验证
*/

/* ============================================================
   一、purchase_order_items 加 sort_order
   ============================================================ */
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

/* 存量回填：同批次内按创建时间编 1..N（无批次的行保持 0，不参与批次卡片） */
UPDATE public.purchase_order_items poi
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY receiving_batch_id ORDER BY created_at) AS rn
  FROM public.purchase_order_items
  WHERE receiving_batch_id IS NOT NULL
) sub
WHERE poi.id = sub.id;

CREATE INDEX IF NOT EXISTS idx_poi_batch_sort
  ON public.purchase_order_items (receiving_batch_id, sort_order)
  WHERE receiving_batch_id IS NOT NULL;

/* ============================================================
   二、重建 complete_batch_inbound（批次入库）
   改动点：
     1. 新签名尾部加 p_waybill_id：写 inbound_orders.waybill_id / inventory_logs.waybill_id
     2. 编码必填：非 excess 行 part_id 为空直接报错
     3. 运单剩余运费校验：本次运费 > 运单 freight_amount − 已完成入库单已分摊之和 则报错
   ============================================================ */
DROP FUNCTION IF EXISTS public.complete_batch_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, DECIMAL);

CREATE FUNCTION public.complete_batch_inbound(
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
  v_allocated DECIMAL(12,2);
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

  /* 0.5 运单剩余运费校验（2026-09-07）：多张销售单可分次摊同一张运单，
         但本次分摊不能超过该运单还没摊完的额度 */
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

  /* 1.5 销售单拦截校验：填了总金额才启用（金额取批次上已录的，参数可覆盖） */
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

  /* 2. 入库单主表（关联批次，携带销售单信息 + 分摊运单） */
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
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc,
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

  /* 4. 回填入库单合计 */
  UPDATE public.inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 5. 应付款 = 货款 − 抹零（=销售单总金额），按批次合并记一笔 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_batch.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO public.supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_batch.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库(批次 ' || v_batch.batch_no ||
              CASE WHEN v_batch.supplier_order_no IS NOT NULL AND TRIM(v_batch.supplier_order_no) <> ''
                   THEN ' 销售单 ' || TRIM(v_batch.supplier_order_no) ELSE '' END || ')',
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
   三、complete_purchase_inbound 加 part_id 必填校验（老流程按单入库）
   签名不变，CREATE OR REPLACE 安全；其余逻辑与 0821 版完全一致
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_purchase_inbound(
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
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;   /* 手动行运费合计 */
  v_auto_amount DECIMAL(12,2) := 0;      /* 参与自动分摊的行金额合计 */
  v_remain_freight DECIMAL(12,2) := 0;   /* 剩余待分摊运费 */
  v_line_amount DECIMAL(12,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
  v_payable DECIMAL(12,2);
BEGIN
  /* 0. 必须已登录(SECURITY DEFINER 绕过 RLS,身份在此兜底) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
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

  /* 3. 创建入库单主表(单号由触发器生成)；带供应商销售单信息 */
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
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_unit_cost, v_alloc,
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

  /* 5. 回填入库单合计 */
  UPDATE inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
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
   四、complete_arrival_inbound 加 part_id 必填校验（到货单入库）
   签名不变；只拦「到货明细和采购明细两边都没档案」的行，
   避免历史到货单因单边缺数据死锁（0904 起不再新建到货单）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_arrival_inbound(
  p_arrival_id UUID,
  p_freight_amount DECIMAL,
  p_operator_id UUID,
  p_price_overrides JSONB DEFAULT '[]'::JSONB,
  p_discount_amount DECIMAL DEFAULT NULL,
  p_supplier_order_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_item RECORD;
  v_poi RECORD;
  v_override JSONB;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_supplier_name TEXT;
  v_stock_qty INTEGER;
  v_unit_cost DECIMAL(12,2);
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_goods_amount DECIMAL(12,2) := 0;
  v_alloc DECIMAL(10,2);
  v_manual_freight DECIMAL(12,2) := 0;
  v_auto_amount DECIMAL(12,2) := 0;
  v_remain_freight DECIMAL(12,2) := 0;
  v_line_amount DECIMAL(12,2);
  v_payable DECIMAL(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_receipt FROM arrival_receipts WHERE id = p_arrival_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单不存在');
  END IF;
  IF v_receipt.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '到货单当前状态不允许入库（需先确认到货）');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_receipt.supplier_id;

  /* 1. 第一遍：累计货款/数量，分离手动运费行 */
  FOR v_item IN
    SELECT * FROM arrival_receipt_items
    WHERE arrival_id = p_arrival_id AND handling <> 'skipped'
  LOOP
    v_stock_qty := CASE v_item.handling
      WHEN 'normal'           THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_repurchase' THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_discard'    THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_return'    THEN LEAST(COALESCE(v_item.received_qty, 0), v_item.expected_qty)
      WHEN 'excess_paid'      THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_free'      THEN COALESCE(v_item.received_qty, 0)
      ELSE 0 END;
    IF v_stock_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM purchase_order_items WHERE id = v_item.purchase_order_item_id;

    /* 编码必填（2026-09-07）：到货明细和采购明细两边都没档案才拦
       （错发/多发行可能只挂一边，避免历史单死锁） */
    IF v_item.part_id IS NULL AND v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '配件「%」未关联零件编码，请先补全编码后再入库',
        COALESCE(v_poi.name, v_item.part_name_snapshot, '');
    END IF;

    /* 价格覆盖：按到货明细 id 匹配 p_price_overrides */
    SELECT * INTO v_override FROM jsonb_array_elements(COALESCE(p_price_overrides, '[]'::JSONB)) o
    WHERE (o->>'arrival_item_id')::UUID = v_item.id LIMIT 1;

    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE((v_override->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0) END;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION '入库单价不能为负（%）', COALESCE(v_poi.name, v_item.part_name_snapshot, '');
    END IF;

    v_line_amount := v_stock_qty * v_unit_cost;
    v_goods_amount := v_goods_amount + v_line_amount;
    v_total_qty := v_total_qty + v_stock_qty;

    IF v_override IS NOT NULL AND (v_override->>'freight_alloc') IS NOT NULL THEN
      v_manual_freight := v_manual_freight + COALESCE((v_override->>'freight_alloc')::DECIMAL, 0);
    ELSE
      v_auto_amount := v_auto_amount + v_line_amount;
    END IF;
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '本到货单没有可入库的数量');
  END IF;

  /* 1.5 销售单拦截校验（金额以到货单已录的 supplier_order_amount 为准，参数可覆盖） */
  IF COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount) IS NOT NULL THEN
    IF ABS((v_goods_amount - COALESCE(p_discount_amount, 0))
           - COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount)) > 0.01 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '入库货款合计 ¥' || ROUND(v_goods_amount, 2) ||
        ' − 抹零 ¥' || ROUND(COALESCE(p_discount_amount, 0), 2) ||
        ' ≠ 销售单总金额 ¥' || ROUND(COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount), 2) ||
        '，请逐行核对入库单价，或在「优惠抹零」填入差额');
    END IF;
  END IF;

  v_remain_freight := COALESCE(p_freight_amount, 0) - v_manual_freight;
  IF v_remain_freight < 0 THEN v_remain_freight := 0; END IF;

  /* 2. 入库单主表（带供应商销售单信息） */
  INSERT INTO inbound_orders (
    purchase_order_id, arrival_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id,
    supplier_order_no, supplier_order_amount, discount_amount
  ) VALUES (
    NULL, p_arrival_id, v_receipt.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_receipt.waybill_id, 'completed', '到货单 ' || v_receipt.receipt_no, p_operator_id,
    v_receipt.supplier_order_no,
    COALESCE(p_supplier_order_amount, v_receipt.supplier_order_amount),
    COALESCE(p_discount_amount, 0)
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 3. 逐行写入库明细（只记账，库存在确认到货时已上架） */
  FOR v_item IN
    SELECT * FROM arrival_receipt_items
    WHERE arrival_id = p_arrival_id AND handling <> 'skipped'
  LOOP
    v_stock_qty := CASE v_item.handling
      WHEN 'normal'           THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_repurchase' THEN COALESCE(v_item.received_qty, 0)
      WHEN 'short_discard'    THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_return'    THEN LEAST(COALESCE(v_item.received_qty, 0), v_item.expected_qty)
      WHEN 'excess_paid'      THEN COALESCE(v_item.received_qty, 0)
      WHEN 'excess_free'      THEN COALESCE(v_item.received_qty, 0)
      ELSE 0 END;
    IF v_stock_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi FROM purchase_order_items WHERE id = v_item.purchase_order_item_id;
    SELECT * INTO v_override FROM jsonb_array_elements(COALESCE(p_price_overrides, '[]'::JSONB)) o
    WHERE (o->>'arrival_item_id')::UUID = v_item.id LIMIT 1;

    v_unit_cost := CASE WHEN v_item.handling = 'excess_free' THEN 0
                        ELSE COALESCE((v_override->>'unit_cost')::DECIMAL, v_poi.unit_cost, 0) END;

    IF v_override IS NOT NULL AND (v_override->>'freight_alloc') IS NOT NULL THEN
      v_alloc := ROUND(COALESCE((v_override->>'freight_alloc')::DECIMAL, 0), 2);
    ELSIF v_auto_amount > 0 THEN
      v_alloc := ROUND(v_remain_freight * (v_stock_qty * v_unit_cost) / v_auto_amount, 2);
    ELSE
      v_alloc := 0;
    END IF;

    v_total_amount := v_total_amount + v_stock_qty * v_unit_cost + v_alloc;

    INSERT INTO inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_item.purchase_order_item_id, v_item.part_id,
      v_poi.part_number, COALESCE(v_poi.name, v_item.part_name_snapshot), v_poi.brand, v_poi.specification, v_poi.unit,
      v_stock_qty, v_unit_cost, v_alloc,
      NULL, v_item.warehouse_id, v_item.location, NULL
    );

    /* 更正价格（确认到货时已按采购明细价写过 purchase_price）：
       purchase_price = 实际入库裸价；cost_price = 裸价 + 单位运费分摊 */
    IF v_item.part_id IS NOT NULL AND v_stock_qty > 0 THEN
      UPDATE parts SET purchase_price = v_unit_cost,
                      cost_price = v_unit_cost + ROUND(v_alloc / v_stock_qty, 2)
      WHERE id = v_item.part_id;
    END IF;

    /* 工单配件行成本价同步（毛利计算基准） */
    IF v_poi.work_order_item_part_id IS NOT NULL AND v_stock_qty > 0 THEN
      UPDATE work_order_item_parts
      SET cost_price = v_unit_cost + ROUND(v_alloc / v_stock_qty, 2)
      WHERE id = v_poi.work_order_item_part_id;
    END IF;
  END LOOP;

  /* 4. 回填入库单合计 */
  UPDATE inbound_orders SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 5. 应付款 = 货款 − 抹零（=销售单总金额）；运费不进供应商账 */
  v_payable := v_goods_amount - COALESCE(p_discount_amount, 0);
  IF v_receipt.supplier_id IS NOT NULL AND v_payable > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_receipt.supplier_id, 'debit', ROUND(v_payable, 2),
            '采购入库(到货单 ' || v_receipt.receipt_no ||
              CASE WHEN v_receipt.supplier_order_no IS NOT NULL AND TRIM(v_receipt.supplier_order_no) <> ''
                   THEN ' 销售单 ' || TRIM(v_receipt.supplier_order_no) ELSE '' END || ')',
            v_inbound_id, 'inbound_order');
  END IF;

  /* 6. 涉及采购单：全部行已处理完（pending_storage）的转已完成 */
  UPDATE purchase_orders SET status = 'completed'
  WHERE id IN (
    SELECT DISTINCT poi.order_id
    FROM arrival_receipt_items ai
    JOIN purchase_order_items poi ON poi.id = ai.purchase_order_item_id
    WHERE ai.arrival_id = p_arrival_id AND poi.order_id IS NOT NULL
  )
  AND status = 'pending_storage';

  /* 7. 到货单转已入库 */
  UPDATE arrival_receipts SET status = 'inbounded' WHERE id = p_arrival_id;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、save_batch_sort_order：保存批次内配件排序
   p_orders: [{id, sort_order}]
   ============================================================ */
CREATE OR REPLACE FUNCTION public.save_batch_sort_order(
  p_batch_id UUID,
  p_orders JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_bad INTEGER;
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
    RETURN jsonb_build_object('success', false, 'error', '该批次已入库，不能再调整顺序');
  END IF;

  /* 校验：所有 id 都必须属于本批次，防止越权改别的批次 */
  SELECT COUNT(*) INTO v_bad
  FROM jsonb_array_elements(COALESCE(p_orders, '[]'::JSONB)) e
  LEFT JOIN public.purchase_order_items poi
    ON poi.id = (e->>'id')::UUID AND poi.receiving_batch_id = p_batch_id
  WHERE poi.id IS NULL;
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '存在不属于本批次的配件，排序未保存');
  END IF;

  UPDATE public.purchase_order_items p
  SET sort_order = t.sort_order
  FROM (
    SELECT (e->>'id')::UUID AS id, (e->>'sort_order')::INTEGER AS sort_order
    FROM jsonb_array_elements(p_orders) e
  ) t
  WHERE p.id = t.id AND p.receiving_batch_id = p_batch_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、move_item_to_batch：配件跨批次移动归属（限同供应商）
   应付按批次（=供应商销售单口径）记账，移动后该配件的账计入目标批次
   ============================================================ */
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
   七、REVOKE 收口（连 PUBLIC 一起收，只收 anon 收不干净）
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_arrival_inbound(uuid, numeric, uuid, jsonb, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_batch_sort_order(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.move_item_to_batch(uuid, uuid, uuid) FROM PUBLIC, anon;

/* 权限验证：anon 必须真的收不到（防 PUBLIC 暗道） */
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.complete_batch_inbound(uuid, jsonb, numeric, uuid, numeric, numeric, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_batch_sort_order(uuid, jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.move_item_to_batch(uuid, uuid, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '权限回收失败：anon 仍可执行新函数';
  END IF;
END $$;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260907_batch_storage_cards.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证（执行完后跑）：
   1. sort_order 列：SELECT column_name FROM information_schema.columns
      WHERE table_name='purchase_order_items' AND column_name='sort_order'; 应 1 行
   2. 批次入库新签名（7 参数）：SELECT oidvectortypes(proargtypes) FROM pg_proc
      WHERE proname='complete_batch_inbound'; 应只有一行且含 7 个参数
   3. 新函数存在：SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('save_batch_sort_order','move_item_to_batch'); 应 2 行
   ============================================================
*/
