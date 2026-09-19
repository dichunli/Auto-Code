/* ============================================================
 * 封死账外扣库存通道 create_purchase_return（2026-09-19，严谨性整改阶段二 · 任务10）
 *
 * 问题：migrations_20260827 创建的老版 create_purchase_return 扣批次+总库存
 *   但【不碰仓位账】——每调一次，仓位账就与总账漂移一次。
 *   前端已无任何调用方（采购退货早就改走 create_inbound_return），
 *   但它仍授权 authenticated，任何登录用户都能直接 rpc 调用，
 *   是一条活的"账外"扣库存通道。
 *
 * 处理：REVOKE 全部客户端执行权（PUBLIC/anon/authenticated）。
 *   函数体保留（不 DROP）——万一某处遗留调用，报错信息能指到函数名，
 *   比"函数不存在"更容易定位；确认无人调用后下阶段再物理删除。
 * 幂等：REVOKE 可重跑，附带 has_function_privilege 验证（DO 块不通过则报错）。
 * ============================================================ */

REVOKE EXECUTE ON FUNCTION public.create_purchase_return(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

/* 权限必须真实生效（历史上踩过"只收 anon 漏 PUBLIC 暗道"的坑），不通过就让迁移失败 */
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.create_purchase_return(uuid,uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_purchase_return(uuid,uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_purchase_return 权限未收干净，迁移中止';
  END IF;
END $$;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_u_revoke_old_purchase_return.sql') ON CONFLICT DO NOTHING;
