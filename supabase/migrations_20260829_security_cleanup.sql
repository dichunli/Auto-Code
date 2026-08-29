/* 安全小尾巴(数据库两项)
   创建日期: 2026-08-29
   背景: 待办清单第4项。
     一、training_categories 写操作目前是"登录即可",收紧为 登录可读/管理员可写。
     二、vehicles_dedup_backup_20260813 是 2026-08-13 车辆去重时的临时备份表,
         去重已稳定运行两周无后遗症,删除(无主键残留表)。
*/

/* 一、training_categories 写操作收紧: 仅 admin/boss 可写,登录可读保持不变 */
DROP POLICY IF EXISTS "training_categories_insert" ON training_categories;
DROP POLICY IF EXISTS "training_categories_update" ON training_categories;
DROP POLICY IF EXISTS "training_categories_delete" ON training_categories;

CREATE POLICY "training_categories_insert" ON training_categories
  FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss'));

CREATE POLICY "training_categories_update" ON training_categories
  FOR UPDATE TO authenticated USING (public.has_role('admin','boss')) WITH CHECK (public.has_role('admin','boss'));

CREATE POLICY "training_categories_delete" ON training_categories
  FOR DELETE TO authenticated USING (public.has_role('admin','boss'));

/* 二、删除车辆去重临时备份表 */
DROP TABLE IF EXISTS vehicles_dedup_backup_20260813;
