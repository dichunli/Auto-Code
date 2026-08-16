/* 采购相关表 RLS 收紧（2026-08-16 批次3 安全收口）【v3 全量幂等版——每条策略先 DROP 再 CREATE，可重复执行】
 *
 * 背景（采购流程梳理 2026-08 问题清单 高危4）：
 *   采购写操作已事务化（12 个 SECURITY DEFINER RPC 带 has_role 角色门禁），
 *   但表级 RLS 多数还是 2026-05 的 auth_full_access（登录即全权读写）——
 *   无采购角色的员工可用 PostgREST 直连绕过 RPC 门禁改采购单、删供应商。
 *
 * 本迁移：下列表"读保持登录全员可读，写收紧到 admin/boss/warehouse"
 * （与实际采购操作者角色一致，用户 2026-08-16 拍板确认）。
 *
 * 收紧范围：
 *   suppliers + 5 张关联表 / purchase_orders / purchase_order_items /
 *   custom_purchase_staging：SELECT 全员，INSERT/UPDATE/DELETE 三角色
 *   supplier_return_records：SELECT 全员、INSERT 全员（工单页"退货给供应商"
 *   接待/技师也会发起），UPDATE/DELETE 三角色
 *
 * 明确不动的表（及原因）：
 *   work_order_item_parts / work_order_item_part_media —— 跨采购/工单两业务，
 *     技师接待日常写量是采购侧 3 倍以上，一刀切会瘫痪工单业务，下轮按场景拆 RPC
 *   logistics_waybills / logistics_companies —— 物流页操作者角色未确认，下轮再收
 *   inbound_orders 等 4 张 —— 写已名存实全锁（jwt app_metadata.role 无写入机制），
 *     全部走 RPC，无语义变化
 *
 * 写法要点（避坑）：
 *   · 统一 (select public.has_role('admin','boss','warehouse'))——
 *     禁止照抄 inbound 4 表的 auth.jwt()->'app_metadata'->>'role' 模式
 *     （系统无 custom_access_token hook，该字段永远为 NULL，照抄会把写全锁死）
 *   · has_role 外包一层 select，让 PostgreSQL 按 initplan 只算一次（对齐 0813 性能迁移）
 *
 * 回滚预案（出问题在 SQL Editor 执行以下即可恢复原状）：
 *   -- 以 suppliers 为例，其余表同理：
 *   -- DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
 *   -- DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
 *   -- DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
 *   -- DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
 *   -- CREATE POLICY auth_full_access ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
*/

/* ============================================================
   一、suppliers + 5 张关联表
   （CREATE POLICY 不支持 OR REPLACE，先 DROP IF EXISTS 新名策略，
     保证本脚本可重复执行——上次执行中断后直接重跑即可）
   ============================================================ */
DROP POLICY IF EXISTS auth_full_access ON public.suppliers;
DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK ((select public.has_role('admin','boss','warehouse')));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated
  USING ((select public.has_role('admin','boss','warehouse')))
  WITH CHECK ((select public.has_role('admin','boss','warehouse')));
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE TO authenticated
  USING ((select public.has_role('admin','boss','warehouse')));

/* 5 张关联表：现有四条策略(hardening 迁移,条件 true)，DROP 后重建为三角色写 */
DO $$
DECLARE
  t TEXT;
  关联表 TEXT[] := ARRAY[
    'supplier_contacts',
    'supplier_part_categories',
    'supplier_part_names',
    'supplier_part_brands',
    'supplier_vehicle_models'
  ];
BEGIN
  FOREACH t IN ARRAY 关联表 LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated
                      WITH CHECK ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
    EXECUTE format('CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated
                      USING ((select public.has_role(''admin'',''boss'',''warehouse'')))
                      WITH CHECK ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated
                      USING ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
  END LOOP;
END $$;

/* ============================================================
   二、purchase_orders / purchase_order_items / custom_purchase_staging
   （同样先 DROP 新名策略再 CREATE，保证可重复执行）
   ============================================================ */
DO $$
DECLARE
  t TEXT;
  采购表 TEXT[] := ARRAY['purchase_orders', 'purchase_order_items', 'custom_purchase_staging'];
BEGIN
  FOREACH t IN ARRAY 采购表 LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_full_access ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated
                      WITH CHECK ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
    EXECUTE format('CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated
                      USING ((select public.has_role(''admin'',''boss'',''warehouse'')))
                      WITH CHECK ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated
                      USING ((select public.has_role(''admin'',''boss'',''warehouse'')))', t, t);
  END LOOP;
END $$;

/* ============================================================
   三、supplier_return_records：INSERT 保持全员（接待/技师可发起退货），
   UPDATE/DELETE 收紧三角色（审批/记账类操作）
   ============================================================ */
DROP POLICY IF EXISTS auth_full_access ON public.supplier_return_records;
DROP POLICY IF EXISTS supplier_return_records_select ON public.supplier_return_records;
DROP POLICY IF EXISTS supplier_return_records_insert ON public.supplier_return_records;
DROP POLICY IF EXISTS supplier_return_records_update ON public.supplier_return_records;
DROP POLICY IF EXISTS supplier_return_records_delete ON public.supplier_return_records;
CREATE POLICY supplier_return_records_select ON public.supplier_return_records
  FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_return_records_insert ON public.supplier_return_records
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY supplier_return_records_update ON public.supplier_return_records
  FOR UPDATE TO authenticated
  USING ((select public.has_role('admin','boss','warehouse')))
  WITH CHECK ((select public.has_role('admin','boss','warehouse')));
CREATE POLICY supplier_return_records_delete ON public.supplier_return_records
  FOR DELETE TO authenticated
  USING ((select public.has_role('admin','boss','warehouse')));

/* ============================================================
   验证方法(执行完本脚本后跑)：应看到每表 4 条新策略
   SELECT tablename, policyname, cmd FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('suppliers','supplier_contacts','supplier_part_categories',
                       'supplier_part_names','supplier_part_brands','supplier_vehicle_models',
                       'purchase_orders','purchase_order_items','custom_purchase_staging',
                       'supplier_return_records')
   ORDER BY tablename, cmd;
   -- 共 40 行；supplier_return_records 的 INSERT 策略 qual 应为 true，其余写策略含 has_role
   ============================================================
*/
