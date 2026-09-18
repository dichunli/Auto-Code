/* ============================================================
 * 工单其它成本 + 退货运费分摊（2026-09-18 用户拍板）
 * 背景：带车牌的采购（工单件）退货时，我方承担的退货运费应计入对应工单成本。
 *   用户拍板：按退货金额占比分摊（尾差并入金额最大的工单）；工单里用明细列表展示。
 * 注意：work_orders.other_cost 是"其他收费"（向客户收，算营收），不是成本，
 *   本功能不复用它，新建独立明细表。
 * 改动：
 *   1. 新建 work_order_other_costs 明细表（索引 + RLS：登录可读，写/删走 RPC）
 *   2. allocate_return_freight_to_work_orders：把采退单运费按退货金额占比摊到关联工单
 *   3. create_purchase_return_orders：我方付运费时同事务自动分摊（分摊失败不阻断主流程）
 *   4. delete_work_order_other_cost：删除误记的成本明细
 * 幂等：IF NOT EXISTS + CREATE OR REPLACE，可重跑。
 * ============================================================ */

/* ─── 一、工单其它成本明细表 ─── */
CREATE TABLE IF NOT EXISTS public.work_order_other_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id),
  name TEXT NOT NULL,                            /* 成本名称，如"退货运费" */
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL DEFAULT 'manual',         /* return_freight=退货运费分摊 / manual=手工补记 */
  reference_id UUID,                             /* 来源单据 id（如采退单） */
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_other_costs_order ON public.work_order_other_costs(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_other_costs_ref ON public.work_order_other_costs(source, reference_id);

ALTER TABLE public.work_order_other_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_order_other_costs_select ON public.work_order_other_costs;
CREATE POLICY work_order_other_costs_select ON public.work_order_other_costs
  FOR SELECT TO authenticated USING (true);

/* ─── 二、退货运费分摊到工单（按退货金额占比，尾差给金额最大的工单） ─── */
CREATE OR REPLACE FUNCTION public.allocate_return_freight_to_work_orders(
  p_return_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ro RECORD;
  v_fee NUMERIC(12,2);
  v_wos UUID[];
  v_weights NUMERIC[];
  v_total_weight NUMERIC;
  v_share NUMERIC(12,2);
  v_shares NUMERIC[] := '{}';
  v_sum NUMERIC(12,2) := 0;
  v_max_idx INT := 1;
  i INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_ro FROM purchase_return_orders WHERE id = p_return_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单不存在');
  END IF;
  IF v_ro.shipping_fee_payer <> 'self' OR COALESCE(v_ro.return_shipping_fee, 0) <= 0 THEN
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;
  /* 防重复分摊（撤销采退单会先删成本明细，见 revoke_purchase_return_order 配套） */
  IF EXISTS (SELECT 1 FROM work_order_other_costs
             WHERE source = 'return_freight' AND reference_id = p_return_order_id) THEN
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;

  v_fee := v_ro.return_shipping_fee;

  /* 本采退单各退货记录反查工单（工单配件行 → 工单项目 → 工单），按退货金额聚合权重 */
  SELECT array_agg(t.work_order_id), array_agg(t.weight), SUM(t.weight)
  INTO v_wos, v_weights, v_total_weight
  FROM (
    SELECT woi.work_order_id,
           SUM(srr.quantity * COALESCE(srr.unit_cost, 0)) AS weight
    FROM supplier_return_records srr
    JOIN work_order_item_parts woip ON woip.id = srr.work_order_item_part_id
    JOIN work_order_items woi ON woi.id = woip.work_order_item_id
    WHERE srr.return_order_id = p_return_order_id
    GROUP BY woi.work_order_id
  ) t;

  IF v_total_weight IS NULL OR v_total_weight <= 0 THEN
    /* 都是备货件/没关联工单，无工单一摊，不报错 */
    RETURN jsonb_build_object('success', true, 'allocated', 0);
  END IF;

  /* 逐工单按比例分摊，四舍五入到分 */
  FOR i IN 1..array_length(v_wos, 1) LOOP
    v_share := ROUND(v_fee * v_weights[i] / v_total_weight, 2);
    v_shares := array_append(v_shares, v_share);
    v_sum := v_sum + v_share;
    IF v_weights[i] > v_weights[v_max_idx] THEN
      v_max_idx := i;
    END IF;
  END LOOP;
  /* 尾差并入金额最大的工单 */
  v_shares[v_max_idx] := v_shares[v_max_idx] + (v_fee - v_sum);

  FOR i IN 1..array_length(v_wos, 1) LOOP
    IF v_shares[i] > 0 THEN
      INSERT INTO public.work_order_other_costs (
        work_order_id, name, amount, source, reference_id, notes, created_by
      ) VALUES (
        v_wos[i], '退货运费', v_shares[i], 'return_freight', p_return_order_id,
        '采退单 ' || COALESCE(v_ro.return_no, ''), p_operator_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'allocated', array_length(v_wos, 1));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.allocate_return_freight_to_work_orders(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_return_freight_to_work_orders(uuid, uuid) TO authenticated;

/* ─── 三、删除误记的其它成本明细 ─── */
CREATE OR REPLACE FUNCTION public.delete_work_order_other_cost(p_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可删除');
  END IF;
  DELETE FROM public.work_order_other_costs WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '记录不存在或已删除');
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.delete_work_order_other_cost(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_work_order_other_cost(uuid) TO authenticated;

/* ─── 四、create_purchase_return_orders 接入运费分摊（函数体同 _d 版，仅末尾加分摊调用） ─── */
CREATE OR REPLACE FUNCTION create_purchase_return_orders(
  p_groups JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group JSONB;
  v_rec JSONB;
  v_return_id UUID;
  v_return_no TEXT;
  v_total_qty INTEGER;
  v_total_amount DECIMAL(12,2);
  v_record_ids UUID[];
  v_goods_photos TEXT[];
  v_package_photos TEXT[];
  v_handover_photos TEXT[];
  v_company_id UUID;
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_groups IS NULL OR jsonb_array_length(p_groups) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单不能为空');
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    IF v_group->'records' IS NULL OR jsonb_array_length(v_group->'records') = 0 THEN
      RAISE EXCEPTION '采退单明细不能为空';
    END IF;

    /* 2026-09-18：确认退货必填校验（货物/外包装/交接三类照片 + 物流公司；我方付必填运费金额） */
    IF jsonb_typeof(v_group->'goods_photos') <> 'array'
       OR jsonb_array_length(v_group->'goods_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少货物照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF jsonb_typeof(v_group->'package_photos') <> 'array'
       OR jsonb_array_length(v_group->'package_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少外包装照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF jsonb_typeof(v_group->'handover_photos') <> 'array'
       OR jsonb_array_length(v_group->'handover_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少交接照片，交货给物流公司/供应商时必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), '') IS NULL THEN
      RAISE EXCEPTION '供应商「%」未选物流公司，确认退货时物流公司必选', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF v_group->>'shipping_fee_payer' = 'self'
       AND COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0) <= 0 THEN
      RAISE EXCEPTION '供应商「%」退货运费为我方付，必须填写运费金额', COALESCE(v_group->>'supplier_name', '');
    END IF;

    v_goods_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'goods_photos')));
    v_package_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'package_photos')));
    v_handover_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'handover_photos')));

    SELECT COALESCE(SUM(COALESCE((r->>'quantity')::INTEGER, 0)), 0) INTO v_total_qty
    FROM jsonb_array_elements(v_group->'records') r;

    /* 建采退单(单号触发器生成)，2026-09-18 起带货物/外包装/交接三类照片 */
    INSERT INTO purchase_return_orders (
      supplier_id, supplier_name, total_quantity, status,
      logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer,
      notes, operator_id, goods_photos, package_photos, handover_photos
    ) VALUES (
      NULLIF(v_group->>'supplier_id', '')::UUID,
      v_group->>'supplier_name',
      v_total_qty,
      'completed',
      NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), ''),
      NULLIF(TRIM(COALESCE(v_group->>'tracking_no', '')), ''),
      COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0),
      NULLIF(v_group->>'shipping_fee_payer', ''),
      v_group->>'notes',
      p_operator_id,
      v_goods_photos,
      v_package_photos,
      v_handover_photos
    )
    RETURNING id, return_no INTO v_return_id, v_return_no;

    /* 明细 */
    v_record_ids := '{}';
    v_total_amount := 0;
    FOR v_rec IN SELECT * FROM jsonb_array_elements(v_group->'records')
    LOOP
      INSERT INTO purchase_return_order_items (
        return_order_id, supplier_return_record_id, part_id,
        part_number, name, brand, specification,
        quantity, return_reason, unit_cost
      ) VALUES (
        v_return_id,
        (v_rec->>'record_id')::UUID,
        NULLIF(v_rec->>'part_id', '')::UUID,
        v_rec->>'part_number', v_rec->>'name', v_rec->>'brand', v_rec->>'specification',
        COALESCE((v_rec->>'quantity')::INTEGER, 0),
        v_rec->>'return_reason',
        COALESCE((v_rec->>'unit_cost')::DECIMAL, 0)
      );
      v_record_ids := array_append(v_record_ids, (v_rec->>'record_id')::UUID);
      v_total_amount := v_total_amount
        + COALESCE((v_rec->>'quantity')::INTEGER, 0) * COALESCE((v_rec->>'unit_cost')::DECIMAL, 0);
    END LOOP;

    /* 退货记录标记完成并关联采退单；
       同步回写最终照片/物流信息（已退货列表按记录查，2026-09-18） */
    UPDATE supplier_return_records
    SET status = 'completed', return_order_id = v_return_id,
        photos = v_goods_photos,
        package_photos = v_package_photos,
        handover_photos = v_handover_photos,
        logistics_company = NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), ''),
        tracking_no = NULLIF(TRIM(COALESCE(v_group->>'tracking_no', '')), '')
    WHERE id = ANY(v_record_ids);

    /* 应收冲减 */
    IF NULLIF(v_group->>'supplier_id', '') IS NOT NULL AND v_total_amount > 0 THEN
      INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
      VALUES ((v_group->>'supplier_id')::UUID, 'credit', ROUND(v_total_amount, 2), '采购退货', v_return_id, 'purchase_return_order');
    END IF;

    /* 退货运费自动入物流应付（2026-09-18 用户拍板）：
       我方付 + 运费>0 + 物流公司能匹配到档案 → 同一事务记一笔应付并置 freight_recorded；
       匹配不到档案不报错（采退单详情页仍可手动补记）；
       本地交接（logistics_company='本地交接'）匹配不到档案，天然跳过 */
    IF v_group->>'shipping_fee_payer' = 'self'
       AND COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0) > 0 THEN
      SELECT id INTO v_company_id FROM logistics_companies
      WHERE name = BTRIM(v_group->>'logistics_company') LIMIT 1;
      IF v_company_id IS NOT NULL THEN
        INSERT INTO logistics_transactions (
          logistics_company_id, transaction_type, amount, description,
          reference_id, reference_type, created_by
        ) VALUES (
          v_company_id, 'debit', (v_group->>'return_shipping_fee')::DECIMAL,
          '退货运费(采退单 ' || COALESCE(v_return_no, '') || ')',
          v_return_id, 'purchase_return_order', p_operator_id
        );
        UPDATE purchase_return_orders SET freight_recorded = true WHERE id = v_return_id;
      END IF;

      /* 退货运费分摊到工单其它成本（2026-09-18 用户拍板：按退货金额占比）；
         分摊失败不阻断退货主流程（可人工补记） */
      BEGIN
        PERFORM public.allocate_return_freight_to_work_orders(v_return_id, p_operator_id);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    v_result := v_result || jsonb_build_object('id', v_return_id, 'return_no', v_return_no);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'orders', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) TO authenticated;

/* ─── 五、撤销采退单时同步删掉运费分摊的成本明细 + 物流应付流水 ───
   函数体与 migrations_20260816_revoke_purchase_return_order.sql 一致，
   仅新增两段清理（工单其它成本分摊、物流应付流水——0915 运费入账后留下的孤儿账） */

CREATE OR REPLACE FUNCTION public.revoke_purchase_return_order(
  p_record_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_return_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 1. 查退货记录并校验状态 */
  SELECT id, status, return_order_id INTO v_rec
  FROM supplier_return_records WHERE id = p_record_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '退货记录不存在');
  END IF;
  IF v_rec.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅「已退货」状态的记录可撤销');
  END IF;

  v_return_id := v_rec.return_order_id;

  IF v_return_id IS NOT NULL THEN
    /* 2. 锁采退单(防并发重复撤销) */
    PERFORM 1 FROM purchase_return_orders WHERE id = v_return_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '关联的采退单不存在(数据异常)');
    END IF;

    /* 2.5 删运费分摊的工单其它成本明细 + 物流应付流水（2026-09-18 配套） */
    DELETE FROM public.work_order_other_costs
    WHERE source = 'return_freight' AND reference_id = v_return_id;
    DELETE FROM public.logistics_transactions
    WHERE reference_type = 'purchase_return_order' AND reference_id = v_return_id;

    /* 3. 删采退单明细 */
    DELETE FROM purchase_return_order_items WHERE return_order_id = v_return_id;

    /* 4. 删应收冲减财务记录 */
    DELETE FROM supplier_transactions
    WHERE reference_type = 'purchase_return_order' AND reference_id = v_return_id;

    /* 5. 同采退单的全部退货记录回 pending 并解除关联
       (先于删采退单执行,无论 FK 的 ON DELETE 行为如何都安全) */
    UPDATE supplier_return_records
    SET status = 'pending', return_order_id = NULL
    WHERE return_order_id = v_return_id;

    /* 6. 删采退单 */
    DELETE FROM purchase_return_orders WHERE id = v_return_id;
  ELSE
    /* 未生成采退单的记录(单条"标记完成"路径):直接回 pending */
    UPDATE supplier_return_records SET status = 'pending' WHERE id = p_record_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.revoke_purchase_return_order(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_purchase_return_order(uuid, uuid) TO authenticated;

/* ============================================================
 * 验证（执行后自查）：
 * 1. 表已建：SELECT COUNT(*) FROM work_order_other_costs; 不报错即可
 * 2. 函数权限：
 *    SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon可执行
 *    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 *    WHERE n.nspname='public' AND proname IN
 *      ('allocate_return_freight_to_work_orders','delete_work_order_other_cost');
 *    应返回 2 行且 anon可执行 都是 false。
 * ============================================================ */

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_e_work_order_other_costs.sql', '工单其它成本明细表+退货运费按金额占比分摊到工单+撤销采退单同步删分摊')
ON CONFLICT (file_name) DO NOTHING;
