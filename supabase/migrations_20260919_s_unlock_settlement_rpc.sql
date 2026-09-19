/* ============================================================
 * 返工解锁必须回滚收款（2026-09-19，严谨性整改阶段一 · 任务7）
 *
 * 问题（诊断实锤，最高危）：
 *   旧"解锁工单"只把 status 从 settled 改回 pending_settlement，
 *   payments / finance_transactions / 会员扣款 / 应收账款全部留在原地，
 *   而结算防重只判 status='settled' —— 解锁后可再次走完整结算：
 *   重复收款记录、重复财务收入流水、重复应收账款，钱被记两遍。
 *
 * 口径定义（修复后）——解锁 = 完整撤销这次结算的全部资金痕迹：
 *   1. 财务流水：删 related_type='work_order' 的流水（触发器自动回吐账户余额）
 *   2. 会员扣款：逐笔 consume 反向退回余额，并插 refund 行留痕（不删 consume，审计链完整）
 *   3. 支付记录：删 payments（重新结算时按实际重新登记）
 *   4. 应收账款：仅允许删除"一分钱都还没核销"的应收；
 *      已有收款核销（paid_amount>0）的工单【拒绝解锁】——必须先作废对应收款单
 *   5. 工单状态：settled/delivered → pending_settlement，settled_at 清空
 *   全程单事务，任一步失败整体回滚；工单行 FOR UPDATE 防并发。
 *
 * 为什么解锁后重新结算不会错账：
 *   解锁把账面收款记录清零，钱实际还在抽屉/微信里；返工完成重新结算时
 *   前台按实际收款方式重新登记，账面重新记一遍——物理现金全程没动，账实一致。
 *
 * 角色门禁：admin/boss/receptionist/accountant（与结算同口径）。
 *   原来"解锁工单"任何登录用户都能点，涉钱操作收紧到收钱角色。
 * 幂等：新函数 CREATE OR REPLACE，重跑无害。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.unlock_work_order_settlement(p_order_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_order RECORD;
  v_consume RECORD;
  v_ar_locked INTEGER;
  v_payments_deleted INTEGER;
  v_finance_deleted INTEGER;
  v_member_refunded NUMERIC(12,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 涉钱操作：与结算同口径的收钱角色才可解锁 */
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可解锁已结算工单');
  END IF;

  /* 锁工单，防与结算/解锁并发 */
  SELECT * INTO v_order FROM work_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;
  IF v_order.status NOT IN ('settled', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', '只有已结算/已交车的工单才能解锁');
  END IF;

  /* 门禁：应收已被收款核销过的，禁止解锁（会破坏收款单的销账链） */
  SELECT COUNT(*) INTO v_ar_locked
  FROM accounts_receivable
  WHERE work_order_id = p_order_id AND COALESCE(paid_amount, 0) > 0;
  IF v_ar_locked > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      '该工单的欠款已有收款核销记录，不能解锁。请先在客户收款中作废相关收款单，再重试');
  END IF;

  /* 1. 删财务流水（触发器自动回吐资金账户余额） */
  DELETE FROM finance_transactions
  WHERE related_type = 'work_order' AND related_id = p_order_id;
  GET DIAGNOSTICS v_finance_deleted = ROW_COUNT;

  /* 2. 会员扣款逐笔退回（consume 留档，补 refund 对冲行） */
  FOR v_consume IN
    SELECT id, member_id, amount
    FROM member_transactions
    WHERE work_order_id = p_order_id AND type = 'consume'
  LOOP
    UPDATE members
    SET balance = COALESCE(balance, 0) + v_consume.amount, updated_at = NOW()
    WHERE id = v_consume.member_id;

    INSERT INTO member_transactions (member_id, type, amount, balance_after, work_order_id, notes)
    VALUES (
      v_consume.member_id, 'refund', v_consume.amount,
      (SELECT balance FROM members WHERE id = v_consume.member_id),
      p_order_id,
      '结算解锁退回 工单 ' || v_order.order_no
    );
    v_member_refunded := v_member_refunded + v_consume.amount;
  END LOOP;

  /* 3. 删支付记录（重新结算时按实际重新登记） */
  DELETE FROM payments WHERE work_order_id = p_order_id;
  GET DIAGNOSTICS v_payments_deleted = ROW_COUNT;

  /* 4. 删未核销的应收（挂账/尾款；已核销的上面已拦截） */
  DELETE FROM accounts_receivable
  WHERE work_order_id = p_order_id AND COALESCE(paid_amount, 0) = 0;

  /* 5. 工单回到待结算 */
  UPDATE work_orders
  SET status = 'pending_settlement', settled_at = NULL
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'payments_deleted', v_payments_deleted,
    'finance_deleted', v_finance_deleted,
    'member_refunded', v_member_refunded
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.unlock_work_order_settlement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_work_order_settlement(UUID) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_s_unlock_settlement_rpc.sql') ON CONFLICT DO NOTHING;
