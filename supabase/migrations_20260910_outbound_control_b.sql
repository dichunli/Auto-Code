/* ============================================================
   配件出库管控 B：RPC 重建与新增（2026-09-11）

   依赖迁移 A（字段 + draft 状态 + fn_picking_deduct_record + 触发器薄壳）。

   一、create_picking_order 重建：管控解析（三级 OR）+ 扫码权威校验 + 需确认则 draft
   二、create_direct_picking_order 重建：同上（以 relax_direct_pick_code 版为底）
   三、confirm_picking_order 新建：库管确认出库，逐条补扣库存
   四、void_picking_draft 新建：作废待确认单（先删记录再删单）
   五、权限收口 + 台账

   管控判定：parts ∪ part_names ∪ part_categories 任一级勾了即生效。
   扫码校验权威在 RPC 层：p_scan_codes 为 {part_id: 扫到的码文本}，
   与打印口径一致比对 barcode / part_number / part_id 三值，前端绕过 action 直调也过不去。
   ============================================================ */

/* ═══ 一、create_picking_order：加第 6 参 p_scan_codes ═══ */
/* 改签名必须先 DROP 旧签名（防止重载残留），重建后重收权限 */
DROP FUNCTION IF EXISTS public.create_picking_order(uuid, jsonb, text, text, uuid);

CREATE FUNCTION public.create_picking_order(
  p_work_order_id UUID,
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID,
  p_scan_codes JSONB DEFAULT NULL
)
RETURNS JSONB
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_picking_no TEXT;
  v_item JSONB;
  v_record_id UUID;
  v_total INTEGER := 0;
  v_ctl RECORD;
  v_code TEXT;
  v_need_confirm BOOLEAN := false;
  v_status TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '领料明细不能为空');
  END IF;

  /* 未传工单时从第一条明细的配件分支反查工单 */
  IF p_work_order_id IS NULL THEN
    SELECT woi.work_order_id INTO p_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = (p_items->0->>'work_order_item_part_id')::UUID;
  END IF;

  /* 第 0 步：管控解析。以批次所属配件为权威（不信客户端传的 part_id），
     三级 OR：配件 / 配件名称 / 配件分类 任一级勾了即生效 */
  FOR v_ctl IN
    SELECT DISTINCT p.id, p.name AS part_name, p.part_number, p.barcode,
      (COALESCE(p.require_scan_check, false) OR COALESCE(pn.require_scan_check, false)
        OR COALESCE(pc.require_scan_check, false)) AS need_scan,
      (COALESCE(p.require_confirm, false) OR COALESCE(pn.require_confirm, false)
        OR COALESCE(pc.require_confirm, false)) AS need_confirm
    FROM part_batches pb
    JOIN parts p ON p.id = pb.part_id
    LEFT JOIN part_names pn ON pn.id = p.part_name_id
    LEFT JOIN part_categories pc ON pc.id = COALESCE(pn.category_id, p.category_id)
    WHERE pb.id IN (
      SELECT (e->>'batch_id')::UUID FROM jsonb_array_elements(p_items) e
    )
  LOOP
    /* 扫码出库管控：必须提供扫到的码，且与条码/编码/配件id 三值之一相符 */
    IF v_ctl.need_scan THEN
      v_code := NULLIF(TRIM(COALESCE(p_scan_codes ->> v_ctl.id::TEXT, '')), '');
      IF v_code IS NULL THEN
        RAISE EXCEPTION '配件「%」要求扫码出库，请先扫码核对后再提交', v_ctl.part_name;
      END IF;
      IF NOT (v_code = v_ctl.barcode OR v_code = v_ctl.part_number OR v_code = v_ctl.id::TEXT) THEN
        RAISE EXCEPTION '配件「%」扫码核对失败：扫到的码与该配件条码/编码不符', v_ctl.part_name;
      END IF;
    END IF;
    IF v_ctl.need_confirm THEN
      v_need_confirm := true;
    END IF;
  END LOOP;

  /* 含需确认配件 → 整单 draft（占位不动库存，库管确认出库时才扣） */
  v_status := CASE WHEN v_need_confirm THEN 'draft' ELSE 'confirmed' END;

  /* 1. 建领料单主表(单号由触发器生成) */
  INSERT INTO picking_orders (work_order_id, receiver_name, notes, operator_id, status)
  VALUES (p_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id, v_status)
  RETURNING id, picking_no INTO v_order_id, v_picking_no;

  /* 2. 逐条插领料记录(触发器扣库存,draft 单触发器旁路;不足则整体回滚) */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO part_picking_records (work_order_item_part_id, batch_id, quantity, picked_by, picking_order_id)
    VALUES (
      (v_item->>'work_order_item_part_id')::UUID,
      (v_item->>'batch_id')::UUID,
      (v_item->>'quantity')::INTEGER,
      p_operator_id,
      v_order_id
    )
    RETURNING id INTO v_record_id;

    INSERT INTO picking_order_items (
      picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id,
      part_number, name, brand, specification, unit, batch_no, unit_cost, quantity
    ) VALUES (
      v_order_id, v_record_id,
      (v_item->>'work_order_item_part_id')::UUID,
      NULLIF(v_item->>'part_id', '')::UUID,
      (v_item->>'batch_id')::UUID,
      v_item->>'part_number', v_item->>'name', v_item->>'brand',
      v_item->>'specification', v_item->>'unit', v_item->>'batch_no',
      NULLIF(v_item->>'unit_cost', '')::DECIMAL,
      (v_item->>'quantity')::INTEGER
    );

    v_total := v_total + (v_item->>'quantity')::INTEGER;
  END LOOP;

  UPDATE picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no,
    'status', v_status, 'need_confirm', v_need_confirm);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;

/* ═══ 二、create_direct_picking_order：加第 5 参 p_scan_codes ═══ */
DROP FUNCTION IF EXISTS public.create_direct_picking_order(jsonb, text, text, uuid);

CREATE FUNCTION public.create_direct_picking_order(
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID,
  p_scan_codes JSONB DEFAULT NULL
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
  v_ctl RECORD;
  v_code TEXT;
  v_need_confirm BOOLEAN := false;
  v_status TEXT;
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

  /* 第 0 步：管控解析（三级 OR）。以分支配件档案为权威；
     无配件档案的分支（relax 后允许）解析不到，不参与管控 */
  FOR v_ctl IN
    SELECT DISTINCT p.id, p.name AS part_name, p.part_number, p.barcode,
      (COALESCE(p.require_scan_check, false) OR COALESCE(pn.require_scan_check, false)
        OR COALESCE(pc.require_scan_check, false)) AS need_scan,
      (COALESCE(p.require_confirm, false) OR COALESCE(pn.require_confirm, false)
        OR COALESCE(pc.require_confirm, false)) AS need_confirm
    FROM work_order_item_parts b
    JOIN parts p ON p.id = b.part_id
    LEFT JOIN part_names pn ON pn.id = p.part_name_id
    LEFT JOIN part_categories pc ON pc.id = COALESCE(pn.category_id, p.category_id)
    WHERE b.id IN (
      SELECT (e->>'work_order_item_part_id')::UUID FROM jsonb_array_elements(p_items) e
    )
  LOOP
    IF v_ctl.need_scan THEN
      v_code := NULLIF(TRIM(COALESCE(p_scan_codes ->> v_ctl.id::TEXT, '')), '');
      IF v_code IS NULL THEN
        RAISE EXCEPTION '配件「%」要求扫码出库，请先扫码核对后再提交', v_ctl.part_name;
      END IF;
      IF NOT (v_code = v_ctl.barcode OR v_code = v_ctl.part_number OR v_code = v_ctl.id::TEXT) THEN
        RAISE EXCEPTION '配件「%」扫码核对失败：扫到的码与该配件条码/编码不符', v_ctl.part_name;
      END IF;
    END IF;
    IF v_ctl.need_confirm THEN
      v_need_confirm := true;
    END IF;
  END LOOP;

  /* 含需确认配件 → 整单 draft（直领本来就只登记不动库存，draft 是"库管确认后生效"的状态标记） */
  v_status := CASE WHEN v_need_confirm THEN 'draft' ELSE 'confirmed' END;

  INSERT INTO public.picking_orders (work_order_id, receiver_name, notes, operator_id, status)
  VALUES (v_work_order_id, NULLIF(TRIM(COALESCE(p_receiver_name, '')), ''), NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_operator_id, v_status)
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

    /* 按待入库采购行从老到新分摊；容量 = 实收数 - 该行已被直领占用数。
       不要求已关联编码：入库环节强制编码必填，冲账在入库事务内执行，闸已存在 */
    v_found_line := false;
    FOR v_poi IN
      SELECT poi.id, poi.quantity, poi.received_qty
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders o ON o.id = poi.order_id
      LEFT JOIN public.receiving_batches rb ON rb.id = poi.receiving_batch_id
      WHERE poi.work_order_item_part_id = v_branch.id
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
        RAISE EXCEPTION '配件「%」没有可直领的待入库在途行（需已收货且批次/采购单在待入库）',
          COALESCE(v_branch.name, '');
      ELSE
        RAISE EXCEPTION '配件「%」待入库在途数量不足，还差 % 件无法直领',
          COALESCE(v_branch.name, ''), v_need;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.picking_orders SET total_quantity = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'picking_order_id', v_order_id, 'picking_no', v_picking_no,
    'status', v_status, 'need_confirm', v_need_confirm);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_direct_picking_order(jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;

/* ═══ 三、confirm_picking_order：库管确认出库（draft → confirmed，逐条补扣库存） ═══ */
CREATE OR REPLACE FUNCTION public.confirm_picking_order(
  p_picking_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_rec RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可确认出库');
  END IF;

  SELECT * INTO v_order FROM public.picking_orders WHERE id = p_picking_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '领料单不存在');
  END IF;
  IF v_order.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', '该领料单已确认出库或已作废，请勿重复操作');
  END IF;

  /* 逐条补扣库存（共用函数与建单即扣同一口径）；
     批次被别的单领走导致不足时报错整单回滚，单保持 draft */
  FOR v_rec IN
    SELECT * FROM public.part_picking_records
    WHERE picking_order_id = p_picking_order_id
    ORDER BY picked_at, id
    FOR UPDATE
  LOOP
    /* 直领登记（未冲账）不动库存，等确认入库时即入即出 */
    IF v_rec.is_direct AND v_rec.batch_id IS NULL THEN
      CONTINUE;
    END IF;
    PERFORM public.fn_picking_deduct_record(v_rec.id);
  END LOOP;

  UPDATE public.picking_orders SET status = 'confirmed' WHERE id = p_picking_order_id;

  RETURN jsonb_build_object('success', true, 'picking_no', v_order.picking_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.confirm_picking_order(uuid, uuid) FROM PUBLIC, anon;

/* ═══ 四、void_picking_draft：作废待确认单（draft 未动库存，直接删） ═══ */
CREATE OR REPLACE FUNCTION public.void_picking_draft(
  p_picking_order_id UUID,
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
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可作废领料单');
  END IF;

  SELECT * INTO v_order FROM public.picking_orders WHERE id = p_picking_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '领料单不存在');
  END IF;
  IF v_order.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅待确认的领料单可作废');
  END IF;

  /* 必须先删领料记录再删单：part_picking_records.picking_order_id 是 ON DELETE SET NULL，
     直接删单会留下 picking_order_id 为空的孤儿记录，污染净领统计导致配件显示"已领" */
  DELETE FROM public.part_picking_records WHERE picking_order_id = p_picking_order_id;
  DELETE FROM public.picking_order_items WHERE picking_order_id = p_picking_order_id;
  DELETE FROM public.picking_orders WHERE id = p_picking_order_id;

  RETURN jsonb_build_object('success', true, 'picking_no', v_order.picking_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_picking_draft(uuid, uuid) FROM PUBLIC, anon;

/* ═══ 五、台账登记 ═══ */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260910_outbound_control_b.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ============================================================
   验证 SQL（执行后应全部通过）：

   -- 新签名存在且旧签名已删
   SELECT proname, pronargs FROM pg_proc
   WHERE proname IN ('create_picking_order','create_direct_picking_order','confirm_picking_order','void_picking_draft');
   -- create_picking_order 应 6 参，create_direct_picking_order 应 5 参，各只有一行

   -- anon 权限已收
   SELECT has_function_privilege('anon', 'public.confirm_picking_order(uuid,uuid)', 'EXECUTE');  -- f
   ============================================================ */
