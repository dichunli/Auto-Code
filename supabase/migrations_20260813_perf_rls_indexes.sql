/*
 * 性能优化：低效 RLS 策略改写 + 重复索引清理 + 外键补索引
 * 背景：Supabase 性能顾问报告 12 条策略每行都重复计算 auth.uid()/auth.jwt()，
 * 改成 (select auth.uid()) 写法后数据库只算一次，大表查询提速。
 * 行为完全不变，只是写法优化。
 */

/* ========== 1. 入库单/采购退货单：admin 策略改写（auth.jwt 加 select 缓存） ========== */
DROP POLICY IF EXISTS inbound_orders_admin_all ON public.inbound_orders;
CREATE POLICY inbound_orders_admin_all ON public.inbound_orders
  FOR ALL TO authenticated
  USING ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
  WITH CHECK ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text);

DROP POLICY IF EXISTS inbound_order_items_admin_all ON public.inbound_order_items;
CREATE POLICY inbound_order_items_admin_all ON public.inbound_order_items
  FOR ALL TO authenticated
  USING ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
  WITH CHECK ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text);

DROP POLICY IF EXISTS purchase_return_orders_admin_all ON public.purchase_return_orders;
CREATE POLICY purchase_return_orders_admin_all ON public.purchase_return_orders
  FOR ALL TO authenticated
  USING ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
  WITH CHECK ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text);

DROP POLICY IF EXISTS purchase_return_order_items_admin_all ON public.purchase_return_order_items;
CREATE POLICY purchase_return_order_items_admin_all ON public.purchase_return_order_items
  FOR ALL TO authenticated
  USING ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
  WITH CHECK ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text);

/* ========== 2. 知识库/工具表：auth.uid() 加 select 缓存 ========== */
DROP POLICY IF EXISTS knowledge_article_reads_admin ON public.knowledge_article_reads;
CREATE POLICY knowledge_article_reads_admin ON public.knowledge_article_reads
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                 WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                      WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'));

/* knowledge_article_reads 有两个一模一样的 INSERT 策略，只保留一个 */
DROP POLICY IF EXISTS knowledge_reads_insert_own ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_reads_insert ON public.knowledge_article_reads;
CREATE POLICY knowledge_article_reads_insert ON public.knowledge_article_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS knowledge_article_roles_admin ON public.knowledge_article_roles;
CREATE POLICY knowledge_article_roles_admin ON public.knowledge_article_roles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                 WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                      WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'));

DROP POLICY IF EXISTS knowledge_admin_all ON public.knowledge_articles;
CREATE POLICY knowledge_admin_all ON public.knowledge_articles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                 WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                      WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'));

DROP POLICY IF EXISTS knowledge_owner_manage ON public.knowledge_articles;
CREATE POLICY knowledge_owner_manage ON public.knowledge_articles
  FOR ALL TO authenticated
  USING (created_by = (select auth.uid()) OR created_by IS NULL)
  WITH CHECK (created_by = (select auth.uid()) OR created_by IS NULL);

DROP POLICY IF EXISTS knowledge_role_read ON public.knowledge_articles;
CREATE POLICY knowledge_role_read ON public.knowledge_articles
  FOR SELECT TO authenticated
  USING (visibility = 'role'::text AND EXISTS (
    SELECT 1 FROM knowledge_article_roles kar
    WHERE kar.article_id = knowledge_articles.id
      AND kar.role_name IN (SELECT r.name FROM roles r JOIN profile_roles pr ON r.id = pr.role_id
                            WHERE pr.profile_id = (select auth.uid()))));

DROP POLICY IF EXISTS tools_write_admin ON public.tools;
CREATE POLICY tools_write_admin ON public.tools
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                 WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profile_roles pr JOIN roles r ON pr.role_id = r.id
                      WHERE pr.profile_id = (select auth.uid()) AND r.name = 'admin'));

/* ========== 3. 重复索引清理（每组保留一个） ========== */
DROP INDEX IF EXISTS public.idx_knowledge_reads_article;
DROP INDEX IF EXISTS public.idx_knowledge_reads_user;
DROP INDEX IF EXISTS public.idx_work_order_items_req_sort;

/* ========== 4. 外键补索引（供应商报价表） ========== */
CREATE INDEX IF NOT EXISTS idx_supplier_quote_sheets_supplier ON public.supplier_quote_sheets(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_matched_part ON public.supplier_quote_items(matched_part_id);
