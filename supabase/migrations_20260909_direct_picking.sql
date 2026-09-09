/* 急件直领（2026-09-09 二期）
 *
 * 需求（用户拍板）：
 *   已到货进入待入库流程、但还没确认入库的配件，库管可以直接开领料单领给技师，
 *   实物先走；库存账在后续"确认入库"事务里即入即出轧平（入库+直领出库同事务完成）。
 *
 * 设计要点：
 *   1. 直领登记 = part_picking_records 一行：is_direct=true、batch_id=NULL、
 *      purchase_order_item_id 指向待入库采购行；不动库存、不写流水
 *   2. 冲账 = complete_batch_inbound / complete_purchase_inbound 逐行入库时：
 *      批次 remaining 直接建成 实收-直领、仓位只加净额、直领记录回填 batch_id、
 *      每条直领补写一条 outbound 流水（备注"急件直领出库（即入即出）"）
 *   3. 拦截：未冲账直领件禁止撤销收货/退回待收货/删明细/退料（退料会凭空加库存）；
 *      可让库管用 cancel_direct_picking 取消直领（删登记，本就无库存影响）
 *   4. 顺带修黄卡缺口：receive_purchase_item 实物到货动作补标 is_arrived=true，
 *      撤销收货对称回退（黄卡链路原来从不标，配件状态机停在"待收货"）
 *   5. 到货单流程（complete_arrival_inbound）不在本次范围内——它确认到货时库存已上架，
 *      直领件走普通领料即可，绝不能给它加冲账段（会双重扣减）
 *
 * 内容：
 *   一、part_picking_records 加 is_direct / purchase_order_item_id 列 + 部分索引
 *   二、fn_deduct_batch_on_picking：直领旁路（batch_id 空且 is_direct 时放行不动库存）
 *   三、fn_restore_batch_on_return：未冲账直领件退料拦截
 *   四、create_direct_picking_order：直领开单 RPC（自动按采购行分摊）
 *   五、cancel_direct_picking：取消直领 RPC
 *   六、complete_batch_inbound 重建：加冲账段（签名不变，CREATE OR REPLACE）
 *   七、complete_purchase_inbound 重建：加冲账段（签名不变）
 *   八、receive_purchase_item 重建：实物到货动作标 is_arrived
 *   九、revoke_purchase_receipt / revoke_pending_storage / delete_purchase_item 重建：
 *       直领拦截 + is_arrived 对称回退
 *   十、REVOKE 收口 + has_function_privilege 验证 + 台账登记
*/

/* ============================================================
   一、part_picking_records 加列
   is_direct=true 且 batch_id IS NULL = 待冲账的直领登记
   ============================================================ */
ALTER TABLE public.part_picking_records
  ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

/* 待冲账直领快速查找（入库确认时按采购行匹配） */
CREATE INDEX IF NOT EXISTS idx_picking_records_pending_direct
  ON public.part_picking_records(purchase_order_item_id)
  WHERE is_direct AND batch_id IS NULL;

/* ============================================================
   二、领料扣减触发器：直领旁路
   普通领料路径一行不动；batch_id 空且 is_direct 的直领登记直接放行
   （数量校验在 create_direct_picking_order RPC 里做），库存账等入库冲账
   ============================================================ */
CREATE OR REPLACE FUNCTION fn_deduct_batch_on_picking()
RETURNS TRIGGER AS $$
DECLARE
  v_part_id UUID;
  v_remaining INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 直领登记：不动批次/总库存/流水，确认入库时即入即出冲账 */
  IF NEW.batch_id IS NULL THEN
    IF NEW.is_direct THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '库存批次不存在';
  END IF;

  /* 锁定批次行,校验剩余量 */
  SELECT part_id, remaining INTO v_part_id, v_remaining
  FROM part_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '库存批次不存在';
  END IF;
  IF v_remaining < NEW.quantity THEN
    RAISE EXCEPTION '批次剩余库存不足:剩余 % 件,本次要领 % 件', v_remaining, NEW.quantity;
  END IF;

  /* 扣批次剩余 */
  UPDATE part_batches SET remaining = remaining - NEW.quantity WHERE id = NEW.batch_id;

  /* 扣配件总库存,不足则报错整单回滚 */
  UPDATE parts SET quantity = quantity - NEW.quantity
  WHERE id = v_part_id AND quantity >= NEW.quantity
  RETURNING quantity INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION '配件总库存不足,无法出库';
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = NEW.work_order_item_part_id;

  /* 写库存流水 */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
  VALUES (v_part_id, 'outbound', -NEW.quantity, v_after + NEW.quantity, v_after, v_work_order_id, 'picking_record', NEW.id, '工单领料出库');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   三、退料回库触发器：未冲账直领件拦截
   直领未冲账（batch_id 空）时库存账上根本没有这批货，走退料会凭空加库存，
   必须拦住，提示找库管取消直领
   ============================================================ */
CREATE OR REPLACE FUNCTION fn_restore_batch_on_return()
RETURNS TRIGGER AS $$
DECLARE
  v_batch_id UUID;
  v_part_id UUID;
  v_picked INTEGER;
  v_is_direct BOOLEAN;
  v_returned INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 校验退料数量不超过该领料记录的净领量 */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT batch_id, quantity, COALESCE(is_direct, false) INTO v_batch_id, v_picked, v_is_direct
    FROM part_picking_records WHERE id = NEW.picking_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '领料记录不存在';
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

/* ============================================================
   四、create_direct_picking_order：急件直领开单
   p_items 元素：{work_order_item_part_id, quantity}
   每个分支自动按"待入库采购行"从老到新分摊（黄卡批次 pending_storage
   或蓝卡采购单 pending_storage，且行已收货、已关联编码）；
   在途数量不足则整单回滚。
   建正常 LL- 领料单，详情/打印/列表复用现有页面。
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_direct_picking_order(
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_picking_no TEXT;
  v_work_order_id UUID;
  v_item JSONB;
  v_branch RECORD;
  v_poi RECORD;
  v_need INTEGER;
  v_picked INTEGER;
  v_returned INTEGER;
  v_remain INTEGER;
  v_alloc INTEGER;
  v_direct_used INTEGER;
  v_capacity INTEGER;
  v_found_line BOOLEAN;
  v_total INTEGER := 0;
  v_record_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 直领是库管操作，权限对齐入库/采购函数 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可直领');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '直领明细不能为空');
  END IF;

  /* 从第一条明细的分支反查工单（领料单要挂工单） */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;

  INSERT INTO public.picking_orders (work_order_id, receiver_name, notes, operator_id)
  VALUES (v_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id)
  RETURNING id, picking_no INTO v_order_id, v_picking_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_need := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_need <= 0 THEN
      RAISE EXCEPTION '直领数量必须是大于 0 的整数';
    END IF;

    /* 锁分支并校验：必须选中、客户同意、数量已定 */
    SELECT * INTO v_branch FROM public.work_order_item_parts
    WHERE id = (v_item->>'work_order_item_part_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '工单配件分支不存在';
    END IF;
    IF NOT v_branch.is_selected THEN
      RAISE EXCEPTION '配件「%」不是选中分支，不能直领', COALESCE(v_branch.name, '');
    END IF;
    IF v_branch.customer_opinion IS DISTINCT FROM 'agree' THEN
      RAISE EXCEPTION '配件「%」客户尚未同意，不能直领', COALESCE(v_branch.name, '');
    END IF;
    IF v_branch.quantity IS NULL THEN
      RAISE EXCEPTION '配件「%」数量未填写，请先在工单上补数量', COALESCE(v_branch.name, '');
    END IF;

    /* 剩余需领 = 目录数量 - 净领（领-退）；直领登记在册即占用 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_picked
    FROM public.part_picking_records WHERE work_order_item_part_id = v_branch.id;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM public.part_return_records WHERE work_order_item_part_id = v_branch.id;
    v_remain := v_branch.quantity - (v_picked - v_returned);
    IF v_need > v_remain THEN
      RAISE EXCEPTION '配件「%」剩余需领 % 件，本次直领 % 件超量',
        COALESCE(v_branch.name, ''), v_remain, v_need;
    END IF;

    /* 按待入库采购行从老到新分摊；容量 = 实收数 - 该行已被直领占用数 */
    v_found_line := false;
    FOR v_poi IN
      SELECT poi.id, poi.quantity, poi.received_qty
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders o ON o.id = poi.order_id
      LEFT JOIN public.receiving_batches rb ON rb.id = poi.receiving_batch_id
      WHERE poi.work_order_item_part_id = v_branch.id
        AND poi.part_id IS NOT NULL
        AND poi.handle_action IN ('normal','excess_paid','excess_free','excess_return','short_repurchase','short_discard')
        AND (rb.status = 'pending_storage'
             OR (poi.receiving_batch_id IS NULL AND o.status = 'pending_storage'))
      ORDER BY poi.created_at
      FOR UPDATE OF poi
    LOOP
      EXIT WHEN v_need <= 0;
      v_found_line := true;
      SELECT COALESCE(SUM(quantity), 0) INTO v_direct_used
      FROM public.part_picking_records
      WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL;
      v_capacity := COALESCE(v_poi.received_qty, v_poi.quantity) - v_direct_used;
      IF v_capacity <= 0 THEN CONTINUE; END IF;

      v_alloc := LEAST(v_need, v_capacity);

      /* 直领登记：batch_id NULL、不动库存（触发器旁路），入库确认时冲账 */
      INSERT INTO public.part_picking_records (
        work_order_item_part_id, batch_id, quantity, picked_by, picking_order_id,
        is_direct, purchase_order_item_id
      ) VALUES (
        v_branch.id, NULL, v_alloc, p_operator_id, v_order_id,
        true, v_poi.id
      )
      RETURNING id INTO v_record_id;

      INSERT INTO public.picking_order_items (
        picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
        part_number, name, brand, specification, unit, batch_no, unit_cost, quantity
      ) VALUES (
        v_order_id, v_record_id, v_branch.id, v_branch.part_id, NULL,
        v_branch.part_number, COALESCE(v_branch.alias_name, v_branch.name), v_branch.brand,
        v_branch.specification, v_branch.unit, NULL, v_branch.unit_cost, v_alloc
      );

      v_need := v_need - v_alloc;
      v_total := v_total + v_alloc;
    END LOOP;

    IF v_need > 0 THEN
      IF NOT v_found_line THEN
        RAISE EXCEPTION '配件「%」没有可直领的待入库在途行（需已收货、已关联编码且批次/采购单在待入库）',
          COALESCE(v_branch.name, '');
      ELSE
        RAISE EXCEPTION '配件「%」待入库在途数量不足，还差 % 件无法直领',
          COALESCE(v_branch.name, ''), v_need;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、cancel_direct_picking：取消直领
   仅限未冲账（batch_id 仍 NULL）的直领记录：删登记+删明细行，
   单空则整单删除。本就无库存影响，直接删即可。
   已冲账（batch_id 已回填）的不能取消，请走退料流程。
   ============================================================ */
CREATE OR REPLACE FUNCTION public.cancel_direct_picking(
  p_picking_record_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_order_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可取消直领');
  END IF;

  SELECT * INTO v_rec FROM public.part_picking_records WHERE id = p_picking_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '领料记录不存在');
  END IF;
  IF NOT v_rec.is_direct OR v_rec.batch_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '该记录不是待冲账的直领记录（已冲账的请走退料流程）');
  END IF;

  v_order_id := v_rec.picking_order_id;

  DELETE FROM public.picking_order_items WHERE picking_record_id = v_rec.id;
  DELETE FROM public.part_picking_records WHERE id = v_rec.id;

  IF v_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.picking_order_items WHERE picking_order_id = v_order_id) THEN
      DELETE FROM public.picking_orders WHERE id = v_order_id;
      RETURN jsonb_build_object('success', true, 'order_deleted', true);
    END IF;
    UPDATE public.picking_orders
    SET total_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM public.picking_order_items WHERE picking_order_id = v_order_id)
    WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_deleted', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、complete_batch_inbound 重建：加直领冲账段
   签名与 0908 版完全一致（8 参），CREATE OR REPLACE 不产生重载。
   改动点（其余与 0908 版逐行一致）：
     1. DECLARE 加 v_direct_qty / v_new_batch_id / v_direct_rec / v_running_qty / v_direct_wo
     2. 逐行入库段：查该行待冲账直领量 v_direct_qty（>入库量报错）；
        批次 remaining 直接建成 实收-直领；仓位只加净额；
        直领记录回填 batch_id、领料单明细补批次、逐条补写 outbound 流水
   ============================================================ */
CREATE OR REPLACE FUNCTION public.complete_batch_inbound(
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
  v_payable DECIMAL(12,2);
  v_order_id UUID;
  /* 急件直领冲账用 */
  v_direct_qty INTEGER;
  v_new_batch_id UUID;
  v_direct_rec RECORD;
  v_running_qty INTEGER;
  v_direct_wo UUID;
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

  /* 3. 逐行入库：明细 + 加库存 + 仓位 + 批次 + 流水 + 价格 + 直领冲账 */
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
      /* 直领冲账（2026-09-09 急件直领）：该采购行待冲账直领合计 */
      SELECT COALESCE(SUM(quantity), 0) INTO v_direct_qty
      FROM public.part_picking_records
      WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL;
      IF v_direct_qty > v_qty THEN
        RAISE EXCEPTION '配件「%」直领 % 件超过本次入库 % 件，请先在领料单详情取消多余的直领',
          COALESCE(v_poi.name, ''), v_direct_qty, v_qty;
      END IF;

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

      /* 仓位库存：直领件实物没上过架，仓位只加净额（避免虚进虚出） */
      IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL AND (v_qty - v_direct_qty) > 0 THEN
        v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
        UPDATE public.part_stock_locations
        SET quantity = quantity + (v_qty - v_direct_qty)
        WHERE part_id = v_poi.part_id
          AND warehouse_id = (v_item->>'warehouse_id')::UUID
          AND COALESCE(location, '') = v_loc;
        IF NOT FOUND THEN
          INSERT INTO public.part_stock_locations (part_id, warehouse_id, location, quantity)
          VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty - v_direct_qty);
        END IF;
      END IF;

      /* 批次：初始量记真实实收，剩余直接扣掉直领量（直领件不入架） */
      INSERT INTO public.part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
      VALUES (
        v_poi.part_id,
        NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
        v_qty, v_qty - v_direct_qty, v_unit_cost, v_batch.supplier_id,
        'purchase', p_batch_id,
        NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
      )
      RETURNING id INTO v_new_batch_id;

      INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
      VALUES (
        v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
        'inbound_order', v_inbound_id, p_waybill_id, p_operator_id,
        '批次入库: ' || COALESCE(v_poi.name, '') || '（' || v_batch.batch_no || '）'
      );

      /* 直领冲账：回填批次 + 领料单明细补批次 + 逐条补写 outbound 流水（即入即出） */
      IF v_direct_qty > 0 THEN
        v_running_qty := v_after_qty;
        FOR v_direct_rec IN
          SELECT * FROM public.part_picking_records
          WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL
          ORDER BY picked_at
          FOR UPDATE
        LOOP
          UPDATE public.part_picking_records
          SET batch_id = v_new_batch_id
          WHERE id = v_direct_rec.id;

          UPDATE public.picking_order_items
          SET batch_id = v_new_batch_id,
              batch_no = COALESCE(batch_no, NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''))
          WHERE picking_record_id = v_direct_rec.id;

          SELECT woi.work_order_id INTO v_direct_wo
          FROM public.work_order_item_parts p
          JOIN public.work_order_items woi ON woi.id = p.work_order_item_id
          WHERE p.id = v_direct_rec.work_order_item_part_id;

          INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, waybill_id, operator_id, notes)
          VALUES (
            v_poi.part_id, 'outbound', -v_direct_rec.quantity, v_running_qty, v_running_qty - v_direct_rec.quantity,
            v_direct_wo, 'picking_record', v_direct_rec.id, p_waybill_id, p_operator_id,
            '急件直领出库（即入即出）'
          );
          v_running_qty := v_running_qty - v_direct_rec.quantity;
        END LOOP;
      END IF;
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
   七、complete_purchase_inbound 重建：加直领冲账段
   签名与 0908 版完全一致（8 参）。冲账逻辑同批次版，
   outbound 流水的运单取采购单上的 waybill_id（与 inbound 流水口径一致）。
   先 DROP 再建：CREATE OR REPLACE 不能改同一签名的同时稳妥处理 wrapper 共存，
   沿用 0908 的 DROP 防重载写法（7 参 wrapper 最后重建）。
   ============================================================ */
DROP FUNCTION IF EXISTS public.complete_purchase_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, TEXT, NUMERIC, UUID);
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
  /* 急件直领冲账用 */
  v_direct_qty INTEGER;
  v_new_batch_id UUID;
  v_direct_rec RECORD;
  v_running_qty INTEGER;
  v_direct_wo UUID;
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

  /* 1.5 防双流程(2026-08-20 二期):走过到货确认单的采购单必须从到货单入库 */
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

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 + 直领冲账 */
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

    /* 直领冲账（2026-09-09 急件直领）：该采购行待冲账直领合计 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_direct_qty
    FROM public.part_picking_records
    WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL;
    IF v_direct_qty > v_qty THEN
      RAISE EXCEPTION '配件「%」直领 % 件超过本次入库 % 件，请先在领料单详情取消多余的直领',
        COALESCE(v_poi.name, ''), v_direct_qty, v_qty;
    END IF;

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

    /* 仓位库存:空仓位统一按空串口径匹配/存储；直领件实物没上过架，只加净额 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL AND (v_qty - v_direct_qty) > 0 THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      UPDATE part_stock_locations
      SET quantity = quantity + (v_qty - v_direct_qty)
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty - v_direct_qty);
      END IF;
    END IF;

    /* 批次：初始量记真实实收，剩余直接扣掉直领量（unit_cost 记裸入库价，分摊成本在 allocated_cost/配件档案） */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty - v_direct_qty, v_unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    )
    RETURNING id INTO v_new_batch_id;

    /* 库存流水 */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
      'inbound_order', v_inbound_id, v_order.waybill_id, p_operator_id,
      '采购入库: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), '') IS NOT NULL
             THEN ' 批次:' || TRIM(v_item->>'batch_no') ELSE '' END
    );

    /* 直领冲账：回填批次 + 领料单明细补批次 + 逐条补写 outbound 流水（即入即出） */
    IF v_direct_qty > 0 THEN
      v_running_qty := v_after_qty;
      FOR v_direct_rec IN
        SELECT * FROM public.part_picking_records
        WHERE purchase_order_item_id = v_poi.id AND is_direct AND batch_id IS NULL
        ORDER BY picked_at
        FOR UPDATE
      LOOP
        UPDATE public.part_picking_records
        SET batch_id = v_new_batch_id
        WHERE id = v_direct_rec.id;

        UPDATE public.picking_order_items
        SET batch_id = v_new_batch_id,
            batch_no = COALESCE(batch_no, NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''))
        WHERE picking_record_id = v_direct_rec.id;

        SELECT woi.work_order_id INTO v_direct_wo
        FROM public.work_order_item_parts p
        JOIN public.work_order_items woi ON woi.id = p.work_order_item_id
        WHERE p.id = v_direct_rec.work_order_item_part_id;

        INSERT INTO public.inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, waybill_id, operator_id, notes)
        VALUES (
          v_poi.part_id, 'outbound', -v_direct_rec.quantity, v_running_qty, v_running_qty - v_direct_rec.quantity,
          v_direct_wo, 'picking_record', v_direct_rec.id, v_order.waybill_id, p_operator_id,
          '急件直领出库（即入即出）'
        );
        v_running_qty := v_running_qty - v_direct_rec.quantity;
      END LOOP;
    END IF;
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

/* 旧签名兼容 wrapper（过渡用，同 0908）：旧前端按 7 参旧签名调 RPC 时转调新函数 */
CREATE OR REPLACE FUNCTION public.complete_purchase_inbound(UUID, JSONB, DECIMAL, UUID, DECIMAL, TEXT, NUMERIC)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.complete_purchase_inbound($1, $2, $3, $4, $5, $6, $7, NULL::UUID);
$$ LANGUAGE SQL;

/* ============================================================
   八、receive_purchase_item 重建：实物到货动作标 is_arrived
   函数体与 0819 版逐行一致，仅新增 1.5 段：
   实物留店的动作（正常/多发买断/多发免费/多发退货/少发补货/少发弃货且实收>0）
   把关联工单配件标"已到货"。黄卡批次链路原来从不标 is_arrived，
   配件状态机停在"待收货"，待领料列表靠采购行反查——补上后语义自洽。
   弃货/换货类实物不留店，不标。
   ============================================================ */
CREATE OR REPLACE FUNCTION receive_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_handle_action TEXT,
  p_received_qty INTEGER,
  p_evidence_photos JSONB,
  p_set_evidence BOOLEAN,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_reason TEXT;
  v_branch_qty INTEGER;
  v_all_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_handle_action NOT IN (
    'normal','broken_exchange','broken_discard','wrong_exchange','wrong_discard',
    'excess_return','excess_paid','excess_free','short_repurchase','short_discard'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的处理动作');
  END IF;
  IF p_received_qty IS NULL OR p_received_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '实收数量必须 ≥ 0');
  END IF;

  /* 锁单,防并发收货状态算错 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved', 'partial_received') THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许收货');
  END IF;

  /* 1. 更新明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = p_handle_action,
      received_qty = p_received_qty,
      evidence_photos = CASE WHEN p_set_evidence
                             THEN COALESCE(p_evidence_photos, '[]'::JSONB)
                             ELSE evidence_photos END
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING * INTO v_item;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 1.5 急件直领配套（2026-09-09）：实物到货动作补标工单配件"已到货"。
         黄卡批次链路原来从不标 is_arrived，配件状态机停在"待收货"。
         弃货/换货类实物不留店，不标；实收 0 也不算到货 */
  IF p_received_qty > 0
     AND p_handle_action IN ('normal','excess_paid','excess_free','excess_return','short_repurchase','short_discard')
     AND v_item.work_order_item_part_id IS NOT NULL THEN
    UPDATE work_order_item_parts SET is_arrived = true WHERE id = v_item.work_order_item_part_id;
  END IF;

  /* 2. 需要补货的动作 → 克隆工单配件行 */
  v_reason := CASE p_handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    /* 少发补货数量 = 订购数 - 实收数;其他场景沿用原数量 */
    IF p_handle_action = 'short_repurchase' THEN
      v_branch_qty := v_item.quantity - p_received_qty;
    ELSE
      SELECT quantity INTO v_branch_qty FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;

    IF COALESCE(v_branch_qty, 0) > 0 THEN
      INSERT INTO work_order_item_parts (
        work_order_item_id, part_name_id, branch_group_id, is_selected,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, quantity, customer_opinion,
        is_purchased, is_arrived, supplier_name, logistics_agreement, notes,
        purchase_reason
      )
      SELECT
        work_order_item_id, part_name_id, branch_group_id, false,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, v_branch_qty, 'agree',
        false, false, supplier_name, logistics_agreement, notes,
        v_reason
      FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;
  END IF;

  /* 3. 服务端重算采购单状态(不再由客户端重读重算) */
  SELECT bool_and(handle_action IS NOT NULL) INTO v_all_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_all_handled THEN
    UPDATE purchase_orders SET status = 'pending_storage' WHERE id = p_order_id;
    /* 运单标记已签收 */
    IF v_order.waybill_id IS NOT NULL THEN
      UPDATE logistics_waybills SET status = 'received', received_at = NOW()
      WHERE id = v_order.waybill_id;
    END IF;
  ELSE
    UPDATE purchase_orders SET status = 'partial_received' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'all_handled', v_all_handled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   九、撤销/退回/删除 三个函数重建：直领拦截 + is_arrived 对称回退
   函数体分别与 0820 签名修正版 / 0908 版 / 0819 版逐行一致，只加新段。
   ============================================================ */

/* 9.1 撤销收货：未冲账直领拦截 + is_arrived 对称回退 */
CREATE OR REPLACE FUNCTION public.revoke_purchase_receipt(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_reason TEXT;
  v_any_handled BOOLEAN;
  v_ar_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;

  /* 1. 读出旧处理动作(删补货分支要用),再清空 */
  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 1.2 直领拦截（2026-09-09）：该明细有未冲账直领时禁止撤销收货（实物已被技师领走） */
  IF EXISTS (
    SELECT 1 FROM public.part_picking_records
    WHERE purchase_order_item_id = p_item_id AND is_direct AND batch_id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件已直领出库，不能撤销收货；可先在领料单详情取消直领');
  END IF;

  /* 1.5 到货单联动(2026-08-20 二期) */
  IF v_item.arrival_item_id IS NOT NULL THEN
    SELECT ar.status INTO v_ar_status
    FROM arrival_receipt_items ai
    JOIN arrival_receipts ar ON ar.id = ai.arrival_id
    WHERE ai.id = v_item.arrival_item_id;
    IF v_ar_status IS NOT NULL AND v_ar_status <> 'receiving' THEN
      RETURN jsonb_build_object('success', false, 'error', '该明细的到货单已确认，库存已上架，不能撤销收货');
    END IF;
    /* 验货中 → 同步复位到货明细（可重新处理） */
    UPDATE arrival_receipt_items
    SET received_qty = NULL, handling = NULL, warehouse_id = NULL, location = NULL, photos = NULL
    WHERE id = v_item.arrival_item_id;
  END IF;

  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL,
      arrival_item_id = NULL
  WHERE id = p_item_id;

  /* 2. 删除该动作生成的补货分支(未采购未到货的) */
  v_reason := CASE v_item.handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts
    WHERE work_order_item_id = (
            SELECT work_order_item_id FROM work_order_item_parts
            WHERE id = v_item.work_order_item_part_id
          )
      AND purchase_reason = v_reason
      AND is_purchased = false
      AND is_arrived = false;
  END IF;

  /* 2.5 is_arrived 对称回退（2026-09-09）：该行曾标"已到货"，且没有其他
         实物到货行还关联同一分支时才回退（防误撤别的正常到货行的标记） */
  IF v_item.work_order_item_part_id IS NOT NULL
     AND v_item.handle_action IN ('normal','excess_paid','excess_free','excess_return','short_repurchase','short_discard')
     AND NOT EXISTS (
       SELECT 1 FROM purchase_order_items
       WHERE work_order_item_part_id = v_item.work_order_item_part_id
         AND id <> p_item_id
         AND handle_action IN ('normal','excess_paid','excess_free','excess_return','short_repurchase','short_discard')
     ) THEN
    UPDATE work_order_item_parts SET is_arrived = false WHERE id = v_item.work_order_item_part_id;
  END IF;

  /* 3. 服务端重算状态 */
  SELECT bool_or(handle_action IS NOT NULL) INTO v_any_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  UPDATE purchase_orders
  SET status = CASE WHEN v_any_handled THEN 'partial_received' ELSE 'submitted' END
  WHERE id = p_order_id;

  /* 4. 若原先是待入库状态被回退,且同运单无其他待入库单,运单回退 */
  IF v_order.status = 'pending_storage' AND v_order.waybill_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM purchase_orders
       WHERE waybill_id = v_order.waybill_id AND status = 'pending_storage' AND id <> p_order_id
     ) THEN
    UPDATE logistics_waybills SET status = 'pending', received_at = NULL
    WHERE id = v_order.waybill_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 9.2 退回待收货：未冲账直领拦截 + is_arrived 对称回退 */
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

  /* 直领拦截（2026-09-09）：该单下有未冲账直领时禁止退回待收货（实物已被领走） */
  IF EXISTS (
    SELECT 1 FROM public.part_picking_records pr
    JOIN public.purchase_order_items poi ON poi.id = pr.purchase_order_item_id
    WHERE poi.order_id = p_purchase_order_id AND pr.is_direct AND pr.batch_id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '该采购单有配件已直领出库，不能退回待收货；请先在领料单详情取消直领');
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

  /* 3.5 is_arrived 对称回退（2026-09-09）：整单收货全部清空，已到货标记同步撤掉 */
  UPDATE work_order_item_parts SET is_arrived = false
  WHERE id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  );

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

/* 9.3 少发弃货删明细：未冲账直领拦截 */
CREATE OR REPLACE FUNCTION delete_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_remaining INTEGER;
  v_any_handled BOOLEAN;
  v_any_unhandled BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 锁单 */
  PERFORM 1 FROM purchase_orders WHERE id = p_order_id FOR UPDATE;

  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 直领拦截（2026-09-09）：该明细有未冲账直领时禁止删除（删了冲账无处匹配） */
  IF EXISTS (
    SELECT 1 FROM public.part_picking_records
    WHERE purchase_order_item_id = p_item_id AND is_direct AND batch_id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '该配件已直领出库，不能删除明细；请先在领料单详情取消直领');
  END IF;

  /* 1. 删采购明细 */
  DELETE FROM purchase_order_items WHERE id = p_item_id;

  /* 2. 删关联工单配件行 */
  IF v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts WHERE id = v_item.work_order_item_part_id;
  END IF;

  /* 3. 采购单剩余明细:无则整单删除,有则重算状态 */
  SELECT COUNT(*),
         bool_or(handle_action IS NOT NULL),
         bool_or(handle_action IS NULL)
  INTO v_remaining, v_any_handled, v_any_unhandled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    DELETE FROM purchase_orders WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_deleted', true);
  END IF;

  v_new_status := CASE
    WHEN v_any_handled AND v_any_unhandled THEN 'partial_received'
    WHEN v_any_handled THEN 'pending_storage'
    ELSE 'submitted' END;
  UPDATE purchase_orders SET status = v_new_status WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_deleted', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   十、REVOKE 收口（连 PUBLIC 一起收，只收 anon 收不干净）
   新建的直领函数按惯例回收；重建的函数 CREATE OR REPLACE 保留原权限，
   但 complete_purchase_inbound 是 DROP 后重建的，默认授权会回来，必须重收
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.create_direct_picking_order(jsonb, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_direct_picking(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric) FROM PUBLIC, anon;

/* 权限验证：anon 必须真的收不到（防 PUBLIC 暗道） */
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.create_direct_picking_order(jsonb, text, text, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.cancel_direct_picking(uuid, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric, uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_purchase_inbound(uuid, jsonb, numeric, uuid, numeric, text, numeric)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '权限回收失败：anon 仍可执行新函数';
  END IF;
END $$;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260909_direct_picking.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证（执行完后跑）：
   1. 新列：SELECT column_name FROM information_schema.columns
      WHERE table_name='part_picking_records' AND column_name IN ('is_direct','purchase_order_item_id'); 应 2 行
   2. 新函数：SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('create_direct_picking_order','cancel_direct_picking'); 应 2 行
   3. complete 函数签名：SELECT proname, pronargs FROM pg_proc
      WHERE proname IN ('complete_batch_inbound','complete_purchase_inbound');
      批次版 1 行 pronargs=8；采购单版 2 行（8 参主函数 + 7 参 wrapper）
   4. 触发器旁路：SELECT pg_get_functiondef(oid) LIKE '%is_direct%'
      FROM pg_proc WHERE proname='fn_deduct_batch_on_picking'; 应 true
   ============================================================
*/
