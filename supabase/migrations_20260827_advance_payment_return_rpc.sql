/* 涉钱涉库存三处客户端直写收编 —— 原子事务函数
   创建日期: 2026-08-27
   背景:
     待办清单第5项"最急三处":
     一、预收款登记/退款原来是客户端"先写记录表、再改工单预收额"两步直写,
         网络闪断会出现记录写了但工单金额没改(或反之),钱对不上。
     二、采购退库原来是客户端"扣批次→扣总库存→建退货单→记日志"四步连写,
         中途失败库存就乱。
     本迁移把这两类多步写收进数据库函数,一个事务要么全成要么全败;
     金额/库存全部改为服务端读最新值再原子增减,不再信客户端旧值。
   包含函数:
     一、register_advance_payment  —— 登记预收款(插记录 + 工单预收额原子累加)
     二、refund_advance_payment    —— 预收款退款(改记录已退额 + 工单预收额原子扣减)
     三、create_purchase_return    —— 采购退库(扣批次/扣库存/建退货单/记日志)
   角色门禁与 RLS 口径一致:
     预收款 = admin/boss/receptionist/accountant(同 advance_payment_records 策略)
     采购退库 = admin/boss/warehouse(同采购域其它函数)
*/

/* ============================================================
   一、登记预收款(原子事务)
   参数: p_work_order_id 工单id / p_amount 金额(>0) /
         p_method 收款方式编码 / p_collector_name 收款人姓名(可空)
   收款人id一律取 auth.uid(),不接受客户端传入。
   ============================================================ */
CREATE OR REPLACE FUNCTION register_advance_payment(
  p_work_order_id UUID,
  p_amount DECIMAL,
  p_method TEXT,
  p_collector_name TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可登记预收款');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入有效金额');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_method, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择收款方式');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM work_orders WHERE id = p_work_order_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;

  INSERT INTO advance_payment_records (work_order_id, amount, method, collector_id, collector_name, paid_at)
  VALUES (
    p_work_order_id, p_amount, p_method, auth.uid(),
    NULLIF(TRIM(COALESCE(p_collector_name, '')), ''), NOW()
  );

  /* 工单预收额原子累加(服务端读最新值,不用客户端旧值) */
  UPDATE work_orders
  SET advance_payment = COALESCE(advance_payment, 0) + p_amount
  WHERE id = p_work_order_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、预收款退款(原子事务)
   参数: p_record_id 预收款记录id / p_amount 退款金额(>0) /
         p_refund_method 退款方式编码
   行锁防止并发退款超退;工单预收额原子扣减、最低为 0(与原客户端口径一致)。
   ============================================================ */
CREATE OR REPLACE FUNCTION refund_advance_payment(
  p_record_id UUID,
  p_amount DECIMAL,
  p_refund_method TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_max_refund DECIMAL;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可退款');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入有效退款金额');
  END IF;

  /* 锁行读最新已退额,防并发超退 */
  SELECT id, work_order_id, amount, refunded_amount INTO v_rec
  FROM advance_payment_records WHERE id = p_record_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '预收款记录不存在');
  END IF;

  v_max_refund := v_rec.amount - COALESCE(v_rec.refunded_amount, 0);
  IF p_amount > v_max_refund THEN
    RETURN jsonb_build_object('success', false, 'error', '最多可退 ' || v_max_refund::TEXT);
  END IF;

  UPDATE advance_payment_records
  SET refunded_amount = COALESCE(refunded_amount, 0) + p_amount,
      refunded_at = NOW(),
      refund_method = NULLIF(TRIM(COALESCE(p_refund_method, '')), '')
  WHERE id = p_record_id;

  UPDATE work_orders
  SET advance_payment = GREATEST(0, COALESCE(advance_payment, 0) - p_amount)
  WHERE id = v_rec.work_order_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   三、采购退库(原子事务)
   参数: p_part_id 配件id / p_batch_id 批次id /
         p_quantity 退货数量(>0) / p_reason 退货原因(可空)
   语义与原客户端一致:扣批次剩余 → 扣配件总库存 → 建退货单(completed) → 记库存日志。
   改进:批次/配件行加锁读最新值,数量原子扣减,四步同事务。
   ============================================================ */
CREATE OR REPLACE FUNCTION create_purchase_return(
  p_part_id UUID,
  p_batch_id UUID,
  p_quantity INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_before_qty INTEGER;
  v_return_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购退库');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '退货数量必须大于0');
  END IF;

  /* 锁批次行读最新剩余,防并发超退 */
  SELECT id, part_id, remaining INTO v_batch
  FROM part_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL OR v_batch.part_id <> p_part_id THEN
    RETURN jsonb_build_object('success', false, 'error', '批次不存在');
  END IF;
  IF v_batch.remaining < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', '该批次剩余仅 ' || v_batch.remaining || '，不足退货');
  END IF;

  /* 锁配件行读最新库存 */
  SELECT quantity INTO v_before_qty
  FROM parts WHERE id = p_part_id FOR UPDATE;
  IF v_before_qty IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '配件不存在');
  END IF;

  UPDATE part_batches SET remaining = remaining - p_quantity WHERE id = p_batch_id;
  UPDATE parts SET quantity = quantity - p_quantity WHERE id = p_part_id;

  INSERT INTO purchase_returns (part_id, batch_id, quantity, reason, status)
  VALUES (p_part_id, p_batch_id, p_quantity, NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'completed')
  RETURNING id INTO v_return_id;

  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
  VALUES (
    p_part_id, 'return_out', -p_quantity, v_before_qty, v_before_qty - p_quantity,
    'purchase_return', v_return_id, auth.uid(),
    '供应商退货: ' || COALESCE(NULLIF(TRIM(p_reason), ''), '无原因')
  );

  RETURN jsonb_build_object('success', true, 'id', v_return_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
