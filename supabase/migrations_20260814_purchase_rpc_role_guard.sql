/*
 * 采购/供应商写函数加角色门禁（2026-08-14 体检整改）
 *
 * 背景：10 个 SECURITY DEFINER 函数（采购入库/收货/退货/供应商保存等）可被任何登录用户
 * 通过 /rest/v1/rpc/ 直接调用（Supabase 安全顾问 WARN）。函数内原本只有"已登录"兜底，
 * 没有角色校验。
 *
 * 用户拍板（2026-08-14）：采购操作仅 管理员(admin)/老板(boss)/仓管(warehouse) 可执行，
 * 接待/技师/会计调用时返回"无权限"。
 *
 * 实现方式：不重写函数体，由本脚本从库里读出当前函数定义、在"未登录"检查后插入门禁、
 * 再 EXECUTE 回去。自带两道保险：
 *   1. 锚点没命中（函数结构变了）→ 报错，整个事务回滚，不会改一半
 *   2. 已含门禁的函数自动跳过（可重复执行不产生重复门禁）
 *
 * 验证方法（执行完本脚本后跑）：
 *   SELECT proname FROM pg_proc
 *   WHERE pronamespace='public'::regnamespace
 *     AND proname IN ('complete_purchase_inbound','create_purchase_orders','create_purchase_return_orders',
 *                     'delete_purchase_item','receive_purchase_item','receive_purchase_item_partial',
 *                     'revoke_pending_storage','revoke_purchase_receipt','revoke_supplier_returns','save_supplier_full')
 *     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
 *   应返回 10 行。
 */

DO $$
DECLARE
  函数名 TEXT;
  定义 TEXT;
  函数列表 TEXT[] := ARRAY[
    'complete_purchase_inbound',
    'create_purchase_orders',
    'create_purchase_return_orders',
    'delete_purchase_item',
    'receive_purchase_item',
    'receive_purchase_item_partial',
    'revoke_pending_storage',
    'revoke_purchase_receipt',
    'revoke_supplier_returns',
    'save_supplier_full'
  ];
  锚点 TEXT := E'未登录或登录已过期'');\r\n  END IF;\r\n';
  门禁 TEXT := E'未登录或登录已过期'');\r\n  END IF;\r\n\r\n  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */\r\n  IF NOT public.has_role(''admin'', ''boss'', ''warehouse'') THEN\r\n    RETURN jsonb_build_object(''success'', false, ''error'', ''无权限:仅管理员、老板、仓管可操作采购'');\r\n  END IF;\r\n';
  已改数量 INTEGER := 0;
  跳过数量 INTEGER := 0;
BEGIN
  FOREACH 函数名 IN ARRAY 函数列表 LOOP
    SELECT pg_get_functiondef(p.oid) INTO 定义
    FROM pg_proc p
    WHERE p.proname = 函数名 AND p.pronamespace = 'public'::regnamespace;

    IF 定义 IS NULL THEN
      RAISE EXCEPTION '函数 % 不存在，终止（全部回滚）', 函数名;
    END IF;

    IF 定义 LIKE '%权限门禁%' THEN
      跳过数量 := 跳过数量 + 1;
      CONTINUE;
    END IF;

    定义 := replace(定义, 锚点, 门禁);
    IF 定义 NOT LIKE '%权限门禁%' THEN
      RAISE EXCEPTION '函数 % 锚点未命中，终止（全部回滚）', 函数名;
    END IF;

    EXECUTE 定义;
    已改数量 := 已改数量 + 1;
  END LOOP;

  RAISE NOTICE '完成：% 个函数已加门禁，% 个已存在门禁被跳过', 已改数量, 跳过数量;
END $$;
