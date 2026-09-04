/* 运单自动关闭（2026-09-05 用户拍板）
 *
 * 口径：本次待收货中的货都收完了，运单关闭（转已签收，不再出现在待签收列表）。
 * 实现：receive_staged_batch 提交入账后检查——本次涉及运单所关联的所有采购单明细
 * 若已全部处理（无 handle_action 为空的行），运单自动转 received。
 *
 * 注意：只回写 receive_staged_batch（加末尾"运单自动关闭"段），函数其余逻辑与
 * 20260904_receiving_staged.sql 完全一致。
*/

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
  v_item_ids UUID[] := '{}';
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
    v_item_ids := array_append(v_item_ids, v_row.id);
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

  /* 运单自动关闭（2026-09-05 用户拍板口径，两层条件同时满足才关）：
     ① 本次涉及运单关联的采购单中，"需要关联运单的商品"（外阜+未豁免）
        已全部提交至待入库（无 handle_action 为空的行）
     ② 整个待收货页中，不存在"需要关联运单但还没关联任何运单"的待收商品——
        因为那些商品之后可能要挂到这张运单上，运单留着等关联。
     豁免（不关联运单）的商品和本地供货不参与判断——它们不用走运单。 */
  UPDATE public.logistics_waybills SET status = 'received', received_at = NOW()
  WHERE status = 'pending'
    AND id IN (
      SELECT DISTINCT o.waybill_id
      FROM public.purchase_orders o
      JOIN public.purchase_order_items poi ON poi.order_id = o.id
      WHERE poi.id = ANY(v_item_ids) AND o.waybill_id IS NOT NULL
    )
    /* 条件①：本运单关联的单里，需要关联运单的商品都提交待入库了 */
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchase_orders o
      JOIN public.purchase_order_items poi ON poi.order_id = o.id
      JOIN public.suppliers s ON s.id = o.supplier_id
      WHERE o.waybill_id = logistics_waybills.id
        AND poi.handle_action IS NULL
        AND COALESCE(o.waybill_exempt, false) = false
        AND COALESCE(poi.waybill_exempt, false) = false
        AND s.region <> 'local'
    )
    /* 条件②（用户 09-05 补充）：待收货页还有外阜未关联运单、未收的商品 → 不关 */
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchase_orders o
      JOIN public.purchase_order_items poi ON poi.order_id = o.id
      JOIN public.suppliers s ON s.id = o.supplier_id
      WHERE o.status IN ('submitted', 'approved', 'partial_received')
        AND o.waybill_id IS NULL
        AND poi.waybill_id IS NULL
        AND poi.handle_action IS NULL
        AND COALESCE(o.waybill_exempt, false) = false
        AND COALESCE(poi.waybill_exempt, false) = false
        AND s.region <> 'local'
    );

  RETURN jsonb_build_object('success', true, 'count', v_count, 'batch_id', v_batch_id, 'batch_no', v_batch_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.receive_staged_batch(uuid, text, uuid) FROM anon, PUBLIC;

/* 台账登记（台账表不存在时跳过） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260905_waybill_auto_close.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* 验证：SELECT pg_get_functiondef(oid) LIKE '%运单自动关闭%' AS 含关闭段
   FROM pg_proc WHERE proname='receive_staged_batch' AND pronamespace='public'::regnamespace;
   应返回 t。 */
