/* 撤销已退货（采退单）—— 原子事务函数（2026-08-16 批次2）
 *
 * 背景（采购流程梳理 2026-08 问题清单 中危9）：
 *   「已退货」页撤销操作此前是客户端 5 步连环删（CompletedReturnList.tsx）：
 *   删采退单明细 → 删应收冲减财务记录 → 删采退单 → 退货记录回 pending，
 *   无事务、不检查错误，中途失败留半成品（如财务记录已删但采退单还在）。
 *   且该操作是 revoke_completed_inbound 拒绝回滚后的补救通道（先撤销采退单
 *   才能回滚入库），使用频率上升，必须事务化。
 *
 * 本迁移：revoke_purchase_return_order —— 一个事务完成全部回退。
 * 语义与原客户端一致：撤销的是整张采退单（同单全部退货记录回 pending），
 * 不是只撤一条记录。
*/

CREATE OR REPLACE FUNCTION revoke_purchase_return_order(
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

/* 权限收尾(对齐 20260813 双保险):新建函数默认 PUBLIC 可执行,回收 anon/PUBLIC */
REVOKE EXECUTE ON FUNCTION public.revoke_purchase_return_order(uuid, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='revoke_purchase_return_order'
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 1 行。
   ============================================================
*/
