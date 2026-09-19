/* ============================================================
 * 修复：知识库保存文章报错 permission denied for function
 * extract_knowledge_blocks_text
 *
 * 原因：2026-09-01 函数权限收紧迁移把
 *   extract_knowledge_blocks_text / update_knowledge_article_search_vector
 * 当作"纯内部函数"收掉了 PUBLIC/anon/authenticated 的执行权。
 * 但保存文章时触发器以登录用户身份调用它们（SECURITY INVOKER），
 * 导致 authenticated 角色无权执行，保存文章直接报错。
 *
 * 修复：这两个函数只做纯文本提取，无安全风险，
 * 把 EXECUTE 授回 authenticated（登录用户）。
 * ============================================================ */

GRANT EXECUTE ON FUNCTION extract_knowledge_blocks_text(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_knowledge_article_search_vector() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_l_grant_knowledge_function_execute.sql') ON CONFLICT DO NOTHING;
