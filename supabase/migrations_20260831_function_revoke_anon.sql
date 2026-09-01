/* 数据库安全卫生：函数执行权限收紧
   创建日期: 2026-08-31
   背景: 待办清单第20项。public 下一批函数默认 anon 可执行（Supabase 建函数默认
         PUBLIC 授权），匿名用户虽会被函数内 auth.uid() 检查拦住，但入口不该开着。
   本迁移:
     一、业务 RPC 函数（页面经 Server Action 带登录态调用）→ 收回 anon 执行权
     二、触发器/内部生成函数（不该被外部直接调用）→ 收回 anon + authenticated
     pg_trgm 扩展自带函数（gtrgm_/similarity 等）不动（动扩展会坏索引）。
   重载函数按签名逐个收回（oidvectortypes 自动展开，防重载漏收）。
   幂等可重复执行（REVOKE 重复执行无副作用）。
*/

/* 一、业务 RPC：收回 anon */
DO $$
DECLARE
  r RECORD;
  业务函数 TEXT[] := ARRAY[
    'add_construction_log',
    'check_promotion_eligibility',
    'create_material_return_order',
    'create_picking_order',
    'create_purchase_return',
    'create_work_order',
    'merge_customers',
    'recharge_member',
    'refund_advance_payment',
    'register_advance_payment',
    'search_knowledge_articles',
    'search_knowledge_semantic',
    'search_knowledge_semantic_v4',
    'settle_work_order',
    'submit_item_qc',
    'transition_work_order'
  ];
BEGIN
  FOR r IN
    SELECT proname, oidvectortypes(proargtypes) AS args
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = ANY(业务函数)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;

/* 二、触发器/内部生成函数：收回 anon + authenticated */
DO $$
DECLARE
  r RECORD;
  内部函数 TEXT[] := ARRAY[
    'fn_order_ready_to_close',
    'fn_waybill_freight_payable',
    'auto_fill_part_info',
    'auto_fill_service_item_name',
    'auto_link_part_to_vehicle',
    'generate_inbound_no',
    'generate_material_return_no',
    'generate_order_no',
    'generate_picking_no',
    'generate_purchase_order_no',
    'generate_return_order_no',
    'log_work_order_status_change',
    'score_on_completion',
    'score_on_quality_fail',
    'update_customer_star_level',
    'update_knowledge_article_search_vector',
    'update_updated_at_column',
    'extract_knowledge_blocks_text',
    'save_service_item_prices',
    'save_service_item_special_prices'
  ];
BEGIN
  FOR r IN
    SELECT proname, oidvectortypes(proargtypes) AS args
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = ANY(内部函数)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, authenticated', r.proname, r.args);
  END LOOP;
END $$;

/* 验证（执行完本脚本后可跑）:
   SELECT proname, proacl FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proacl::text LIKE '%anon=X%' AND proname NOT LIKE 'gtrgm%'
     AND proname NOT LIKE '%similarity%' AND proname NOT LIKE '%trgm%';
   应只剩 pg_trgm 扩展函数（gin_extract_*/set_limit/show_limit 等）。
*/

/* 登记台账（台账表还没建过则跳过，不报错） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260831_function_revoke_anon.sql', '函数执行权限收紧: 业务RPC收anon, 触发器/内部函数收anon+authenticated')
    ON CONFLICT (file_name) DO NOTHING;
  END IF;
END $$;
