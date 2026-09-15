/*
 * 字典表写权限收紧第二批（2026-09-16，承接 0916_a 员工分组）
 * 同为 0802 加固文件里"登录即可写"的错法。本批 3 张纯字典表（写入入口只有管理页）：
 *   mechanic_levels（技师等级）          → admin / boss
 *   other_payment_methods（其它收支收款方式）→ admin / boss / accountant（财务域）
 *   other_transaction_categories（收支分类）→ admin / boss / accountant（财务域）
 * 口径：读不动（登录即可读，页面/下拉不受影响），只收紧写；
 *       与同批三个 actions.ts 的服务端校验保持一致。
 * 注：同文件其余表（other_transactions / supplier_* / outsource_* / 价格表 / 仓位表）
 *     有业务流程写入路径（手机端、SECURITY DEFINER RPC 等），逐张核实后分批处理，不在本批。
 */

/* ═══ 一、技师等级 → admin/boss ═══ */
DROP POLICY IF EXISTS mechanic_levels_insert ON mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_update ON mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_delete ON mechanic_levels;
CREATE POLICY mechanic_levels_insert ON mechanic_levels FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin','boss'));
CREATE POLICY mechanic_levels_update ON mechanic_levels FOR UPDATE TO authenticated
  USING (public.has_role('admin','boss'));
CREATE POLICY mechanic_levels_delete ON mechanic_levels FOR DELETE TO authenticated
  USING (public.has_role('admin','boss'));

/* ═══ 二、其它收支收款方式 → admin/boss/accountant ═══ */
DROP POLICY IF EXISTS "登录用户可插入" ON other_payment_methods;
DROP POLICY IF EXISTS "登录用户可更新" ON other_payment_methods;
DROP POLICY IF EXISTS "登录用户可删除" ON other_payment_methods;
CREATE POLICY "登录用户可插入" ON other_payment_methods FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY "登录用户可更新" ON other_payment_methods FOR UPDATE TO authenticated
  USING (public.has_role('admin','boss','accountant'));
CREATE POLICY "登录用户可删除" ON other_payment_methods FOR DELETE TO authenticated
  USING (public.has_role('admin','boss','accountant'));

/* ═══ 三、其它收支分类 → admin/boss/accountant ═══ */
DROP POLICY IF EXISTS "登录用户可插入" ON other_transaction_categories;
DROP POLICY IF EXISTS "登录用户可更新" ON other_transaction_categories;
DROP POLICY IF EXISTS "登录用户可删除" ON other_transaction_categories;
CREATE POLICY "登录用户可插入" ON other_transaction_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin','boss','accountant'));
CREATE POLICY "登录用户可更新" ON other_transaction_categories FOR UPDATE TO authenticated
  USING (public.has_role('admin','boss','accountant'));
CREATE POLICY "登录用户可删除" ON other_transaction_categories FOR DELETE TO authenticated
  USING (public.has_role('admin','boss','accountant'));

INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_b_dict_tables_write_policy.sql') ON CONFLICT DO NOTHING;
