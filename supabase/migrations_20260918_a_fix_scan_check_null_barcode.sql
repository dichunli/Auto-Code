/* ============================================================
 * 修复扫码核对 NULL 缺陷：配件未填条码时错码也能放行
 *
 * 2026-09-17 CI 集成测试（picking-order.test.ts）抓到：
 *   「扫码管控：错码拒绝」用例失败——扫错码居然放行。
 * 根因：三值比对 `v_code = v_ctl.barcode OR v_code = v_ctl.part_number OR ...`，
 *   配件没录条码时 barcode 为 NULL，NULL 参与 OR 使整个表达式变 NULL，
 *   `IF NOT NULL` 按 false 处理 → 不报错 → 错码直接放行。
 *   即：没填条码的配件，扫码管控形同虚设（扫什么都能出库）。
 * 修法：比对值全部 COALESCE 成空串。v_code 在前面已被 NULLIF 保证非空，
 *   空串永远不会等于 v_code，语义不变、NULL 安全。
 * 涉及函数：create_picking_order / create_direct_picking_order（同样的写法各一处）。
 * 参数列表未变，CREATE OR REPLACE 即可，无需 DROP。
 * ============================================================ */

/* ─── 一、create_picking_order（工单领料出库） ─── */
CREATE OR REPLACE FUNCTION public.create_picking_order(
  p_work_order_id UUID,
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID,
  p_scan_codes JSONB DEFAULT NULL
)
RETURNS JSONB
SET search_path = public
AS $func$
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
      /* 2026-09-18 修复：barcode/part_number 为 NULL 时 OR 表达式变 NULL 导致错码放行，
         统一 COALESCE 为空串（v_code 已保证非空，空串永不命中） */
      IF NOT (v_code = COALESCE(v_ctl.barcode, '') OR v_code = COALESCE(v_ctl.part_number, '') OR v_code = v_ctl.id::TEXT) THEN
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
$func$ LANGUAGE plpgsql;

ALTER FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.create_picking_order(uuid, jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;

/* ─── 二、create_direct_picking_order（待入库直领） ─── */
CREATE OR REPLACE FUNCTION public.create_direct_picking_order(
  p_items JSONB,
  p_receiver_name TEXT,
  p_notes TEXT,
  p_operator_id UUID,
  p_scan_codes JSONB DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $func$
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
      /* 2026-09-18 修复：barcode/part_number 为 NULL 时 OR 表达式变 NULL 导致错码放行，
         统一 COALESCE 为空串（v_code 已保证非空，空串永不命中） */
      IF NOT (v_code = COALESCE(v_ctl.barcode, '') OR v_code = COALESCE(v_ctl.part_number, '') OR v_code = v_ctl.id::TEXT) THEN
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
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_direct_picking_order(jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;

/* 台账登记（幂等） */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260918_a_fix_scan_check_null_barcode.sql') ON CONFLICT DO NOTHING;
