/* 数据库安全卫生补充: 收回函数 PUBLIC 执行权
   创建日期: 2026-09-01
   背景: migrations_20260831_function_revoke_anon.sql 只收回了 anon/authenticated
         的显式授权, 但这些函数还留着 PUBLIC 执行权(建函数时的默认授权)。
         PostgreSQL 规则: 授权给 PUBLIC 等于授权给所有角色, 单独收回 anon
         不起作用, 匿名用户实际仍可执行(has_function_privilege 已验证)。
         本迁移把 PUBLIC 一并收回, 真正关掉入口。
   效果:
     一、业务 RPC 函数: 收回 PUBLIC + anon, 保留 authenticated/service_role/postgres
        (页面经 Server Action 带登录态调用, 不受影响)
     二、触发器/内部函数: 收回 PUBLIC + anon + authenticated,
        保留 postgres/service_role(触发器以表所有者身份运行, 不受影响)
   pg_trgm 扩展自带函数不在本迁移范围内(动扩展会坏索引)。
   重载函数按签名逐个收回(oidvectortypes 自动展开, 防重载漏收)。
   幂等可重复执行(REVOKE 重复执行无副作用)。
*/

/* 一、业务 RPC: 收回 PUBLIC + anon */
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
  END LOOP;
END $$;

/* 二、触发器/内部生成函数: 收回 PUBLIC + anon + authenticated */
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
  END LOOP;
END $$;

/* 验证(执行完本脚本后可跑):
   SELECT proname, oidvectortypes(proargtypes) AS args,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS 匿名可执行,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS 登录可执行
   FROM pg_proc p
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('create_work_order','settle_work_order','generate_order_no',
                     'fn_waybill_freight_payable','recharge_member');
   期望: 匿名全部 false; 业务RPC登录 true; 触发器/内部函数登录 false。
*/

/* 登记台账(台账表还没建过则跳过, 不报错) */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260901_function_revoke_public.sql', '函数PUBLIC执行权收回: 上一版只收anon显式授权但PUBLIC还开着, 本版连PUBLIC一起收')
    ON CONFLICT (file_name) DO NOTHING;
  END IF;
END $$;
