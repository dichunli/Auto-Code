/*
 * 数据库精简（2026-08-14 体检整改第二轮）
 *
 * 第一部分：删除 14 个"真重复"索引
 *   这些索引与同字段的唯一约束索引完全重复（唯一索引本身就具备查询加速能力），
 *   删掉不影响任何查询速度，只减少写入开销。
 *   注意：体检报告里其余 160 来个"未使用"索引有意保留——数据量小 Postgres 才不用索引，
 *   它们是数据涨上去之后的保险，删了将来查询会变慢。
 *
 * 第二部分：合并 12 张表的重复 RLS 策略（Supabase 性能顾问 24 条 WARN）
 *   同一张表同一个动作有多条策略时，每行查询都要把每条策略各算一遍。
 *   合并后权限语义严格不变（只是把 OR 关系写进同一条策略里）。
 *   知识库相关策略的判定表达式逐字保留原样，不简化、不改语义。
 *
 * 执行方式：Supabase Dashboard → SQL Editor → 粘贴 → Run
 * 可重复执行：索引 DROP 带 IF EXISTS；策略先 DROP IF EXISTS 再 CREATE，
 *   重复执行时 DROP 把上次的建好的删掉再建一遍，结果一致。
 *
 * 验证方法（执行完后跑）：应返回 0 行（没有表还存在同动作多策略）
 *   SELECT tablename, cmd, count(*) FROM pg_policies
 *   WHERE schemaname='public' AND 'authenticated' = ANY(roles)
 *   GROUP BY tablename, cmd HAVING count(*) > 1;
 */

/* ══════════════ 第一部分：删重复索引 ══════════════ */

/* 以下普通索引与同字段唯一索引完全重复，唯一索引已覆盖查询需求 */
DROP INDEX IF EXISTS public.idx_attendance_records_profile;      /* 与 attendance_records_profile_id_work_date_key 重复 */
DROP INDEX IF EXISTS public.idx_company_part_prices;             /* 与 company_part_prices_company_id_part_id_key 重复 */
DROP INDEX IF EXISTS public.idx_company_service_prices;          /* 与 company_service_prices_company_id_service_item_id_key 重复 */
DROP INDEX IF EXISTS public.idx_members_card_no;                 /* 与 members_card_no_key 重复 */
DROP INDEX IF EXISTS public.idx_outsource_orders_work_order;     /* 与 outsource_orders_work_order_id_key 重复 */
DROP INDEX IF EXISTS public.idx_part_name_brands;                /* 与 part_name_brands_part_name_id_brand_id_key 重复 */
DROP INDEX IF EXISTS public.idx_part_name_specs;                 /* 与 part_name_specifications_part_name_id_specification_id_key 重复 */
DROP INDEX IF EXISTS public.idx_part_models;                     /* 与 part_vehicle_models_part_id_vehicle_model_id_key 重复 */
DROP INDEX IF EXISTS public.idx_part_vehicle_prices;             /* 与 part_vehicle_prices_part_id_vehicle_model_id_key 重复 */
DROP INDEX IF EXISTS public.idx_parts_number;                    /* 与 parts_part_number_unique 重复 */
DROP INDEX IF EXISTS public.idx_reimbursements_work_order;       /* 与 work_order_reimbursements_work_order_id_key 重复 */
DROP INDEX IF EXISTS public.idx_tools_code;                      /* 与 tools_code_key 重复 */
DROP INDEX IF EXISTS public.idx_vehicles_plate;                  /* 与 vehicles_plate_number_unique 重复 */
/* 部分索引（WHERE remaining > 0）被同表全量索引 idx_part_batches_part 覆盖，删除部分索引保留全量 */
DROP INDEX IF EXISTS public.idx_part_batches_part_remaining;

/* ══════════════ 第二部分：合并重复 RLS 策略 ══════════════ */

/* 幂等保护：先把本脚本要建的新策略名全部删掉（存在才删），保证重复执行不报错 */
DROP POLICY IF EXISTS inbound_orders_admin_insert ON public.inbound_orders;
DROP POLICY IF EXISTS inbound_orders_admin_update ON public.inbound_orders;
DROP POLICY IF EXISTS inbound_orders_admin_delete ON public.inbound_orders;
DROP POLICY IF EXISTS inbound_order_items_admin_insert ON public.inbound_order_items;
DROP POLICY IF EXISTS inbound_order_items_admin_update ON public.inbound_order_items;
DROP POLICY IF EXISTS inbound_order_items_admin_delete ON public.inbound_order_items;
DROP POLICY IF EXISTS purchase_return_orders_admin_insert ON public.purchase_return_orders;
DROP POLICY IF EXISTS purchase_return_orders_admin_update ON public.purchase_return_orders;
DROP POLICY IF EXISTS purchase_return_orders_admin_delete ON public.purchase_return_orders;
DROP POLICY IF EXISTS purchase_return_order_items_admin_insert ON public.purchase_return_order_items;
DROP POLICY IF EXISTS purchase_return_order_items_admin_update ON public.purchase_return_order_items;
DROP POLICY IF EXISTS purchase_return_order_items_admin_delete ON public.purchase_return_order_items;
DROP POLICY IF EXISTS knowledge_article_reads_select ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_reads_update ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_reads_delete ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_roles_update ON public.knowledge_article_roles;
DROP POLICY IF EXISTS knowledge_articles_select ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_articles_insert ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_articles_update ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_articles_delete ON public.knowledge_articles;
DROP POLICY IF EXISTS synonym_mapping_select ON public.synonym_mapping;
DROP POLICY IF EXISTS synonym_mapping_insert ON public.synonym_mapping;
DROP POLICY IF EXISTS synonym_mapping_update ON public.synonym_mapping;
DROP POLICY IF EXISTS synonym_mapping_delete ON public.synonym_mapping;
DROP POLICY IF EXISTS system_settings_select ON public.system_settings;
DROP POLICY IF EXISTS system_settings_insert ON public.system_settings;
DROP POLICY IF EXISTS system_settings_update ON public.system_settings;
DROP POLICY IF EXISTS system_settings_delete ON public.system_settings;
DROP POLICY IF EXISTS tools_select ON public.tools;
DROP POLICY IF EXISTS tools_insert ON public.tools;
DROP POLICY IF EXISTS tools_update ON public.tools;
DROP POLICY IF EXISTS tools_delete ON public.tools;

/* ── 1. inbound_orders / inbound_order_items / purchase_return_orders / purchase_return_order_items ──
 * 原状：admin_all(ALL, jwt app_metadata role=admin) + read(SELECT true)，SELECT 动作两条都算
 * 合并：SELECT 只留 read(true)；admin_all 拆成 INSERT/UPDATE/DELETE 三条（jwt 表达式逐字保留） */
DROP POLICY IF EXISTS inbound_orders_admin_all ON public.inbound_orders;
CREATE POLICY inbound_orders_admin_insert ON public.inbound_orders FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY inbound_orders_admin_update ON public.inbound_orders FOR UPDATE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY inbound_orders_admin_delete ON public.inbound_orders FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

DROP POLICY IF EXISTS inbound_order_items_admin_all ON public.inbound_order_items;
CREATE POLICY inbound_order_items_admin_insert ON public.inbound_order_items FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY inbound_order_items_admin_update ON public.inbound_order_items FOR UPDATE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY inbound_order_items_admin_delete ON public.inbound_order_items FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

DROP POLICY IF EXISTS purchase_return_orders_admin_all ON public.purchase_return_orders;
CREATE POLICY purchase_return_orders_admin_insert ON public.purchase_return_orders FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY purchase_return_orders_admin_update ON public.purchase_return_orders FOR UPDATE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY purchase_return_orders_admin_delete ON public.purchase_return_orders FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

DROP POLICY IF EXISTS purchase_return_order_items_admin_all ON public.purchase_return_order_items;
CREATE POLICY purchase_return_order_items_admin_insert ON public.purchase_return_order_items FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY purchase_return_order_items_admin_update ON public.purchase_return_order_items FOR UPDATE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin')
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');
CREATE POLICY purchase_return_order_items_admin_delete ON public.purchase_return_order_items FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

/* ── 2. knowledge_article_reads ──
 * 原状：admin(ALL) + insert(本人) + 两条一模一样的 select(true)
 * 合并：select(true) 一条；insert(本人或管理员) 一条；update/delete 仅管理员 */
DROP POLICY IF EXISTS knowledge_article_reads_admin ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_reads_insert ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_article_reads_select_all ON public.knowledge_article_reads;
DROP POLICY IF EXISTS knowledge_reads_select_all ON public.knowledge_article_reads;
CREATE POLICY knowledge_article_reads_select ON public.knowledge_article_reads FOR SELECT TO authenticated
  USING (true);
CREATE POLICY knowledge_article_reads_insert ON public.knowledge_article_reads FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()) OR is_admin());
CREATE POLICY knowledge_article_reads_update ON public.knowledge_article_reads FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY knowledge_article_reads_delete ON public.knowledge_article_reads FOR DELETE TO authenticated
  USING (is_admin());

/* ── 3. knowledge_article_roles ──
 * 原状：admin(ALL) + select(true) + insert(true) + delete(true)，UPDATE 仅管理员
 * 合并：select/insert/delete 各留一条 true（管理员天然包含），update 仅管理员 */
DROP POLICY IF EXISTS knowledge_article_roles_admin ON public.knowledge_article_roles;
DROP POLICY IF EXISTS knowledge_article_roles_select ON public.knowledge_article_roles;
DROP POLICY IF EXISTS knowledge_article_roles_insert ON public.knowledge_article_roles;
DROP POLICY IF EXISTS knowledge_article_roles_delete ON public.knowledge_article_roles;
CREATE POLICY knowledge_article_roles_select ON public.knowledge_article_roles FOR SELECT TO authenticated
  USING (true);
CREATE POLICY knowledge_article_roles_insert ON public.knowledge_article_roles FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY knowledge_article_roles_update ON public.knowledge_article_roles FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY knowledge_article_roles_delete ON public.knowledge_article_roles FOR DELETE TO authenticated
  USING (true);

/* ── 4. knowledge_articles（判定表达式逐字保留原语义）──
 * 原状：admin(ALL) + owner_manage(ALL, 本人或 created_by 为空) + public_read(公开/内部) + role_read(按角色可见)
 * 合并：四个动作各一条，OR 关系写进同一条 */
DROP POLICY IF EXISTS knowledge_admin_all ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_owner_manage ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_public_read ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_role_read ON public.knowledge_articles;
CREATE POLICY knowledge_articles_select ON public.knowledge_articles FOR SELECT TO authenticated
  USING (
    is_admin()
    OR (created_by = auth.uid()) OR (created_by IS NULL)
    OR (visibility = ANY (ARRAY['public'::text, 'internal'::text]))
    OR ((visibility = 'role'::text) AND (EXISTS (
         SELECT 1 FROM knowledge_article_roles kar
         WHERE ((kar.article_id = knowledge_articles.id) AND (kar.role_name IN (
           SELECT r.name FROM roles r JOIN profile_roles pr ON ((r.id = pr.role_id))
           WHERE (pr.profile_id = auth.uid())))))))
  );
CREATE POLICY knowledge_articles_insert ON public.knowledge_articles FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR (created_by = auth.uid()) OR (created_by IS NULL));
CREATE POLICY knowledge_articles_update ON public.knowledge_articles FOR UPDATE TO authenticated
  USING (is_admin() OR (created_by = auth.uid()) OR (created_by IS NULL))
  WITH CHECK (is_admin() OR (created_by = auth.uid()) OR (created_by IS NULL));
CREATE POLICY knowledge_articles_delete ON public.knowledge_articles FOR DELETE TO authenticated
  USING (is_admin() OR (created_by = auth.uid()) OR (created_by IS NULL));

/* ── 5. mechanic_levels ──
 * 原状：auth_full_access(ALL true) + 四条单动作 true，后者完全是前者的子集
 * 合并：删掉四条单动作，只留 auth_full_access */
DROP POLICY IF EXISTS mechanic_levels_select ON public.mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_insert ON public.mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_update ON public.mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_delete ON public.mechanic_levels;

/* ── 6. synonym_mapping / system_settings ──
 * 原状：admin(ALL) + select(true)；合并：select(true) + 写操作仅管理员 */
DROP POLICY IF EXISTS "admin 可管理同义词" ON public.synonym_mapping;
DROP POLICY IF EXISTS "登录用户可查看同义词" ON public.synonym_mapping;
CREATE POLICY synonym_mapping_select ON public.synonym_mapping FOR SELECT TO authenticated
  USING (true);
CREATE POLICY synonym_mapping_insert ON public.synonym_mapping FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY synonym_mapping_update ON public.synonym_mapping FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY synonym_mapping_delete ON public.synonym_mapping FOR DELETE TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS system_settings_admin_manage ON public.system_settings;
DROP POLICY IF EXISTS system_settings_select_all ON public.system_settings;
CREATE POLICY system_settings_select ON public.system_settings FOR SELECT TO authenticated
  USING (true);
CREATE POLICY system_settings_insert ON public.system_settings FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY system_settings_update ON public.system_settings FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY system_settings_delete ON public.system_settings FOR DELETE TO authenticated
  USING (is_admin());

/* ── 7. tools ──
 * 原状：write_admin(ALL) + select_all(SELECT true)；合并：select(true) + 写操作仅管理员 */
DROP POLICY IF EXISTS tools_write_admin ON public.tools;
DROP POLICY IF EXISTS tools_select_all ON public.tools;
CREATE POLICY tools_select ON public.tools FOR SELECT TO authenticated
  USING (true);
CREATE POLICY tools_insert ON public.tools FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY tools_update ON public.tools FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY tools_delete ON public.tools FOR DELETE TO authenticated
  USING (is_admin());

/* ── 8. vehicle_photos ──
 * 原状：auth_full_access(ALL true) 和 vehicle_photos_auth(ALL true) 两条一模一样
 * 合并：删掉 vehicle_photos_auth，只留 auth_full_access */
DROP POLICY IF EXISTS vehicle_photos_auth ON public.vehicle_photos;
