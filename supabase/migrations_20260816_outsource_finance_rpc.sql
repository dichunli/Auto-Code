/* 外包财务记录重置 —— 原子事务函数（2026-08-16 批次3 破口修复）
 *
 * 背景：
 *   supplier_transactions（0802 round3）和 accounts_payable 的写已收紧到
 *   admin/boss/warehouse / accountant，但外包流程的财务记录仍是客户端直写——
 *   OutsourceModal.tsx:132-168（改供应商/改付款状态时清旧建新）、
 *   MobileItemEditor.tsx:1765-1804（移除外包项目时清旧+按剩余金额重建）。
 *   接待操作外包付款今天就会被 RLS 拦截（现存故障点）。
 *   另：原按 description ILIKE '%单号%' 模糊删，单号子串撞车会误删（问题清单 16）。
 *
 * 本函数：清旧财务记录 + 按当前金额建新，一个事务；
 * 删除改用精确匹配（写入格式固定为 '外包服务单 <单号>'，旧数据同格式可兼容）。
 *
 * 角色：登录即可（外包建应付/付款是接待的正常业务通道，
 * 财务表的角色收紧针对的是"无业务入口的手工改账"，不针对系统内流程）。
 * 外包单本身的状态/明细变更仍由前端完成（outsource_orders 表策略未收紧）。
*/

CREATE OR REPLACE FUNCTION reset_outsource_finance(
  p_order_no TEXT,
  p_supplier_id UUID,
  p_amount DECIMAL,
  p_paid BOOLEAN,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  IF p_order_no IS NULL OR trim(p_order_no) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', '外包单号不能为空');
  END IF;
  IF COALESCE(p_amount, 0) > 0 AND p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '缺少供应商，无法生成财务记录');
  END IF;

  /* 清旧：精确匹配写入格式，替代 ILIKE 模糊删（防单号子串撞车误删，如
     WB-...-1 匹配 WB-...-11）；历史数据同为该格式写入，可正常匹配 */
  DELETE FROM supplier_transactions WHERE description = '外包服务单 ' || p_order_no;
  DELETE FROM accounts_payable WHERE notes = '外包服务单 ' || p_order_no;

  /* 建新：金额大于 0 才建（已付记付款流水，未付记应付账款） */
  IF COALESCE(p_amount, 0) > 0 THEN
    IF p_paid THEN
      INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, created_by)
      VALUES (p_supplier_id, 'payment', ROUND(p_amount, 2), '外包服务单 ' || p_order_no, p_operator_id);
    ELSE
      INSERT INTO accounts_payable (supplier_id, amount, paid_amount, status, notes)
      VALUES (p_supplier_id, ROUND(p_amount, 2), 0, 'pending', '外包服务单 ' || p_order_no);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 权限收尾(对齐 20260813 双保险):新建函数默认 PUBLIC 可执行,回收 anon/PUBLIC;
   authenticated 由 Supabase default privileges 单独授权,不受影响 */
REVOKE EXECUTE ON FUNCTION public.reset_outsource_finance(text, uuid, numeric, boolean, uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='reset_outsource_finance';
   应返回 1 行。
   ============================================================
*/
