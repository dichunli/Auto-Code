/*
 * 工单删除权限放宽：管理员+老板（2026-08-02 用户拍板）
 * 仍保留"只能删已作废单"的限制
 */
DROP POLICY IF EXISTS work_orders_delete ON work_orders;
CREATE POLICY work_orders_delete ON work_orders FOR DELETE TO authenticated
USING (public.has_role('admin','boss') AND order_type = 'cancelled');
