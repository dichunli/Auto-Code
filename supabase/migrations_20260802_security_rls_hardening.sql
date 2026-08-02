/*
 * 安全加固：收紧 RLS 策略（2026-08-02 安全诊断结果）
 * 1. 所有 TO public 策略改为 TO authenticated（排除匿名访问）
 * 2. roles / profile_roles 权限表收紧为：登录可读、仅管理员可写
 * 3. system_settings 管理策略改为真正校验 admin 角色
 * 4. 补齐 4 张"开了 RLS 但没策略"的表
 * 5. 补 training-media / behavior-media 存储桶的上传/删除策略
 */

/* 通用管理员判断函数：SECURITY DEFINER 绕过 RLS 避免递归，固定 search_path 防劫持 */
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr
    JOIN roles r ON pr.role_id = r.id
    WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
  )
$$;

/* ========== 一、四策略模式表：public → authenticated ========== */

DROP POLICY IF EXISTS employee_groups_select ON employee_groups;
DROP POLICY IF EXISTS employee_groups_insert ON employee_groups;
DROP POLICY IF EXISTS employee_groups_update ON employee_groups;
DROP POLICY IF EXISTS employee_groups_delete ON employee_groups;
CREATE POLICY employee_groups_select ON employee_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY employee_groups_insert ON employee_groups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY employee_groups_update ON employee_groups FOR UPDATE TO authenticated USING (true);
CREATE POLICY employee_groups_delete ON employee_groups FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS mechanic_levels_select ON mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_insert ON mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_update ON mechanic_levels;
DROP POLICY IF EXISTS mechanic_levels_delete ON mechanic_levels;
CREATE POLICY mechanic_levels_select ON mechanic_levels FOR SELECT TO authenticated USING (true);
CREATE POLICY mechanic_levels_insert ON mechanic_levels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY mechanic_levels_update ON mechanic_levels FOR UPDATE TO authenticated USING (true);
CREATE POLICY mechanic_levels_delete ON mechanic_levels FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "允许所有用户查看" ON other_payment_methods;
DROP POLICY IF EXISTS "允许所有用户插入" ON other_payment_methods;
DROP POLICY IF EXISTS "允许所有用户更新" ON other_payment_methods;
DROP POLICY IF EXISTS "允许所有用户删除" ON other_payment_methods;
CREATE POLICY "登录用户可查看" ON other_payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "登录用户可插入" ON other_payment_methods FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "登录用户可更新" ON other_payment_methods FOR UPDATE TO authenticated USING (true);
CREATE POLICY "登录用户可删除" ON other_payment_methods FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "允许所有用户查看" ON other_transaction_categories;
DROP POLICY IF EXISTS "允许所有用户插入" ON other_transaction_categories;
DROP POLICY IF EXISTS "允许所有用户更新" ON other_transaction_categories;
DROP POLICY IF EXISTS "允许所有用户删除" ON other_transaction_categories;
CREATE POLICY "登录用户可查看" ON other_transaction_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "登录用户可插入" ON other_transaction_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "登录用户可更新" ON other_transaction_categories FOR UPDATE TO authenticated USING (true);
CREATE POLICY "登录用户可删除" ON other_transaction_categories FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "允许所有用户查看" ON other_transactions;
DROP POLICY IF EXISTS "允许所有用户插入" ON other_transactions;
DROP POLICY IF EXISTS "允许所有用户更新" ON other_transactions;
DROP POLICY IF EXISTS "允许所有用户删除" ON other_transactions;
CREATE POLICY "登录用户可查看" ON other_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "登录用户可插入" ON other_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "登录用户可更新" ON other_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "登录用户可删除" ON other_transactions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON outsource_order_items;
DROP POLICY IF EXISTS "Allow all insert" ON outsource_order_items;
DROP POLICY IF EXISTS "Allow all update" ON outsource_order_items;
DROP POLICY IF EXISTS "Allow all delete" ON outsource_order_items;
CREATE POLICY outsource_order_items_select ON outsource_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY outsource_order_items_insert ON outsource_order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY outsource_order_items_update ON outsource_order_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY outsource_order_items_delete ON outsource_order_items FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON outsource_orders;
DROP POLICY IF EXISTS "Allow all insert" ON outsource_orders;
DROP POLICY IF EXISTS "Allow all update" ON outsource_orders;
DROP POLICY IF EXISTS "Allow all delete" ON outsource_orders;
CREATE POLICY outsource_orders_select ON outsource_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY outsource_orders_insert ON outsource_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY outsource_orders_update ON outsource_orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY outsource_orders_delete ON outsource_orders FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_contacts;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_contacts;
DROP POLICY IF EXISTS "Allow all update" ON supplier_contacts;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_contacts;
CREATE POLICY supplier_contacts_select ON supplier_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_contacts_insert ON supplier_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_contacts_update ON supplier_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_contacts_delete ON supplier_contacts FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_brands;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_brands;
DROP POLICY IF EXISTS "Allow all update" ON supplier_part_brands;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_brands;
CREATE POLICY supplier_part_brands_select ON supplier_part_brands FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_part_brands_insert ON supplier_part_brands FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_part_brands_update ON supplier_part_brands FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_part_brands_delete ON supplier_part_brands FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_categories;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_categories;
DROP POLICY IF EXISTS "Allow all update" ON supplier_part_categories;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_categories;
CREATE POLICY supplier_part_categories_select ON supplier_part_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_part_categories_insert ON supplier_part_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_part_categories_update ON supplier_part_categories FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_part_categories_delete ON supplier_part_categories FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_names;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_names;
DROP POLICY IF EXISTS "Allow all update" ON supplier_part_names;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_names;
CREATE POLICY supplier_part_names_select ON supplier_part_names FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_part_names_insert ON supplier_part_names FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_part_names_update ON supplier_part_names FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_part_names_delete ON supplier_part_names FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_transactions;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_transactions;
DROP POLICY IF EXISTS "Allow all update" ON supplier_transactions;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_transactions;
CREATE POLICY supplier_transactions_select ON supplier_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_transactions_insert ON supplier_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_transactions_update ON supplier_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_transactions_delete ON supplier_transactions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_vehicle_models;
DROP POLICY IF EXISTS "Allow all insert" ON supplier_vehicle_models;
DROP POLICY IF EXISTS "Allow all update" ON supplier_vehicle_models;
DROP POLICY IF EXISTS "Allow all delete" ON supplier_vehicle_models;
CREATE POLICY supplier_vehicle_models_select ON supplier_vehicle_models FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_vehicle_models_insert ON supplier_vehicle_models FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_vehicle_models_update ON supplier_vehicle_models FOR UPDATE TO authenticated USING (true);
CREATE POLICY supplier_vehicle_models_delete ON supplier_vehicle_models FOR DELETE TO authenticated USING (true);

/* ========== 二、单条 ALL 策略表：public → authenticated ========== */

DROP POLICY IF EXISTS "Allow all" ON advance_payment_records;
CREATE POLICY advance_payment_records_auth ON advance_payment_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_part_special_prices ON part_special_prices;
CREATE POLICY part_special_prices_auth ON part_special_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_part_stock_locations ON part_stock_locations;
CREATE POLICY part_stock_locations_auth ON part_stock_locations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_part_vehicle_prices ON part_vehicle_prices;
CREATE POLICY part_vehicle_prices_auth ON part_vehicle_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_payment_methods ON payment_methods;
CREATE POLICY payment_methods_auth ON payment_methods FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_warehouses ON warehouses;
CREATE POLICY warehouses_auth ON warehouses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_warehouse_locations ON warehouse_locations;
CREATE POLICY warehouse_locations_auth ON warehouse_locations FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* ========== 三、操作日志：匿名可读可写 → 仅登录用户 ========== */

DROP POLICY IF EXISTS "Allow all insert" ON operation_logs;
DROP POLICY IF EXISTS "Allow all read" ON operation_logs;
CREATE POLICY operation_logs_insert ON operation_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY operation_logs_select ON operation_logs FOR SELECT TO authenticated USING (true);

/* ========== 四、同义词表：SELECT 收紧到登录用户，管理策略保持 admin 校验 ========== */

DROP POLICY IF EXISTS "所有人可查看同义词" ON synonym_mapping;
CREATE POLICY "登录用户可查看同义词" ON synonym_mapping FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin 可管理同义词" ON synonym_mapping;
CREATE POLICY "admin 可管理同义词" ON synonym_mapping FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

/* ========== 五、系统设置：管理策略改为真正校验 admin ========== */

DROP POLICY IF EXISTS system_settings_select_all ON system_settings;
CREATE POLICY system_settings_select_all ON system_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS system_settings_admin_manage ON system_settings;
CREATE POLICY system_settings_admin_manage ON system_settings FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

/* ========== 六、权限表 roles / profile_roles：登录可读、仅 admin 可写 ========== */

DROP POLICY IF EXISTS auth_full_access ON roles;
DROP POLICY IF EXISTS roles_select ON roles;
DROP POLICY IF EXISTS roles_insert ON roles;
DROP POLICY IF EXISTS roles_update ON roles;
DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_select ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_insert ON roles FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY roles_update ON roles FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY roles_delete ON roles FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS auth_full_access ON profile_roles;
DROP POLICY IF EXISTS profile_roles_select ON profile_roles;
DROP POLICY IF EXISTS profile_roles_insert ON profile_roles;
DROP POLICY IF EXISTS profile_roles_update ON profile_roles;
DROP POLICY IF EXISTS profile_roles_delete ON profile_roles;
CREATE POLICY profile_roles_select ON profile_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY profile_roles_insert ON profile_roles FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY profile_roles_update ON profile_roles FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY profile_roles_delete ON profile_roles FOR DELETE TO authenticated USING (public.is_admin());

/* ========== 七、补齐 4 张开了 RLS 但没有策略的表 ========== */

CREATE POLICY search_dictionary_select ON search_dictionary FOR SELECT TO authenticated USING (true);

CREATE POLICY behavior_check_records_auth ON behavior_check_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY customer_photos_auth ON customer_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY parts_specifications_auth ON parts_specifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* ========== 八、补 training-media / behavior-media 存储策略（对齐其它桶） ========== */

CREATE POLICY training_media_auth_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'training-media');
CREATE POLICY training_media_auth_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'training-media');

CREATE POLICY behavior_media_auth_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'behavior-media');
CREATE POLICY behavior_media_auth_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'behavior-media');
