/* 外包单保存/移除 —— 原子事务函数
   创建日期: 2026-08-27
   背景:
     OutsourceModal.tsx 的保存是 6 步客户端连写(建/改外包单 → 写明细 →
     改工单项目标记 → 重算总额 → 同步其他项目供应商 → 重建财务记录),
     中途失败留下"财务记录和单据对不上"的半成品;移除项目同理(3-4 步)。
     本迁移把两条链路各收进一个数据库函数,一个事务要么全成要么全败。
     财务记录重建直接调用已有函数 reset_outsource_finance(0816 已上线)。
   包含函数:
     一、save_outsource_order        —— 创建/更新外包单 + 明细 + 工单项目标记 + 总额 + 财务
     二、remove_outsource_order_item —— 移除明细(末项时整单删除) + 标记清理 + 财务
   角色: 登录即可(与 reset_outsource_finance 口径一致,外包是接待正常业务通道)
*/

/* ============================================================
   一、保存外包单(原子事务)
   p_existing_order_id 为空 = 新建外包单,非空 = 更新既有单
   p_existing_item_id  为空 = 新增明细,非空 = 更新既有明细
   ============================================================ */
CREATE OR REPLACE FUNCTION save_outsource_order(
  p_work_order_id UUID,
  p_work_order_item_id UUID,
  p_service_item_id UUID,
  p_service_name TEXT,
  p_amount DECIMAL,
  p_supplier_id UUID,
  p_is_paid BOOLEAN,
  p_payment_method TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_existing_order_id UUID DEFAULT NULL,
  p_existing_item_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_order_no TEXT;
  v_old_supplier_id UUID;
  v_date_str TEXT;
  v_seq INTEGER;
  v_new_total DECIMAL;
  v_finance_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_service_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '当前项目未关联服务项目，无法创建外包单');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '外包金额必须大于 0');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择外包供应商');
  END IF;
  IF p_is_paid AND NULLIF(TRIM(COALESCE(p_payment_method, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择支付方式');
  END IF;

  IF p_existing_order_id IS NOT NULL THEN
    /* ── 更新既有外包单(锁行读旧供应商,用于判断是否需要联动) ── */
    SELECT supplier_id INTO v_old_supplier_id
    FROM outsource_orders WHERE id = p_existing_order_id FOR UPDATE;
    IF v_old_supplier_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', '外包单不存在');
    END IF;

    UPDATE outsource_orders SET
      supplier_id = p_supplier_id,
      is_paid = p_is_paid,
      payment_method = CASE WHEN p_is_paid THEN p_payment_method ELSE NULL END,
      paid_at = CASE WHEN p_is_paid THEN NOW() ELSE NULL END,
      status = CASE WHEN p_is_paid THEN 'settled' ELSE 'pending' END,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = p_existing_order_id;

    v_order_id := p_existing_order_id;
    SELECT order_no INTO v_order_no FROM outsource_orders WHERE id = v_order_id;
  ELSE
    /* ── 新建外包单:单号当日序号,加咨询锁防并发重号 ── */
    v_date_str := to_char(NOW(), 'YYYYMMDD');
    PERFORM pg_advisory_xact_lock(hashtext('outsource_order_no_' || v_date_str));
    SELECT COUNT(*) + 1 INTO v_seq FROM outsource_orders WHERE order_no LIKE 'WB-' || v_date_str || '-%';
    v_order_no := 'WB-' || v_date_str || '-' || lpad(v_seq::TEXT, 4, '0');

    INSERT INTO outsource_orders (
      order_no, work_order_id, supplier_id, total_amount,
      is_paid, payment_method, paid_at, status, notes
    ) VALUES (
      v_order_no, p_work_order_id, p_supplier_id, 0,
      p_is_paid,
      CASE WHEN p_is_paid THEN p_payment_method ELSE NULL END,
      CASE WHEN p_is_paid THEN NOW() ELSE NULL END,
      CASE WHEN p_is_paid THEN 'settled' ELSE 'pending' END,
      NULLIF(TRIM(COALESCE(p_notes, '')), '')
    )
    RETURNING id INTO v_order_id;
  END IF;

  /* ── 写入/更新明细 ── */
  IF p_existing_item_id IS NOT NULL THEN
    UPDATE outsource_order_items SET
      service_item_id = p_service_item_id,
      service_name = p_service_name,
      amount = p_amount
    WHERE id = p_existing_item_id;
  ELSE
    INSERT INTO outsource_order_items (
      outsource_order_id, work_order_item_id, service_item_id, service_name, amount
    ) VALUES (
      v_order_id, p_work_order_item_id, p_service_item_id, p_service_name, p_amount
    );
  END IF;

  /* ── 工单项目外包标记 ── */
  UPDATE work_order_items SET
    is_outsourced = true,
    outsourced_supplier_id = p_supplier_id
  WHERE id = p_work_order_item_id;

  /* ── 重算订单总额(服务端读最新明细) ── */
  SELECT COALESCE(SUM(amount), 0) INTO v_new_total
  FROM outsource_order_items WHERE outsource_order_id = v_order_id;
  UPDATE outsource_orders SET total_amount = v_new_total WHERE id = v_order_id;

  /* ── 供应商变更时,同单其他项目的工单标记一起更新 ── */
  IF v_old_supplier_id IS NOT NULL AND v_old_supplier_id <> p_supplier_id THEN
    UPDATE work_order_items SET outsourced_supplier_id = p_supplier_id
    WHERE id IN (
      SELECT work_order_item_id FROM outsource_order_items
      WHERE outsource_order_id = v_order_id AND work_order_item_id <> p_work_order_item_id
    );
  END IF;

  /* ── 重建财务记录(复用 0816 已上线函数,清旧+建新) ── */
  v_finance_result := reset_outsource_finance(v_order_no, p_supplier_id, v_new_total, p_is_paid, auth.uid());
  IF NOT (v_finance_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION '%', v_finance_result->>'error';
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_no', v_order_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.save_outsource_order(uuid, uuid, uuid, text, numeric, uuid, boolean, text, text, uuid, uuid) FROM anon, PUBLIC;

/* ============================================================
   二、移除外包明细(原子事务)
   明细是单内最后一项 → 清财务记录 + 删整张外包单;
   否则重算总额并重建财务记录。
   ============================================================ */
CREATE OR REPLACE FUNCTION remove_outsource_order_item(
  p_order_id UUID,
  p_item_id UUID,
  p_work_order_item_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_remaining INTEGER;
  v_new_total DECIMAL;
  v_finance_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 锁外包单行 */
  SELECT id, order_no, supplier_id, is_paid INTO v_order
  FROM outsource_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '外包单不存在');
  END IF;

  DELETE FROM outsource_order_items WHERE id = p_item_id AND outsource_order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '外包明细不存在');
  END IF;

  /* 清理工单项目标记 */
  UPDATE work_order_items SET
    is_outsourced = false,
    outsourced_supplier_id = NULL
  WHERE id = p_work_order_item_id;

  SELECT COUNT(*) INTO v_remaining FROM outsource_order_items WHERE outsource_order_id = p_order_id;

  IF v_remaining <= 0 THEN
    /* 整单删除:财务清掉不重建(金额 0) */
    v_finance_result := reset_outsource_finance(v_order.order_no, NULL, 0, false, auth.uid());
    IF NOT (v_finance_result->>'success')::BOOLEAN THEN
      RAISE EXCEPTION '%', v_finance_result->>'error';
    END IF;
    DELETE FROM outsource_orders WHERE id = p_order_id;
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_new_total
    FROM outsource_order_items WHERE outsource_order_id = p_order_id;
    UPDATE outsource_orders SET total_amount = v_new_total WHERE id = p_order_id;
    v_finance_result := reset_outsource_finance(v_order.order_no, v_order.supplier_id, v_new_total, v_order.is_paid, auth.uid());
    IF NOT (v_finance_result->>'success')::BOOLEAN THEN
      RAISE EXCEPTION '%', v_finance_result->>'error';
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.remove_outsource_order_item(uuid, uuid, uuid) FROM anon, PUBLIC;
