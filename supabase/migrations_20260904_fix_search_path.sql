/* 3 个函数补 search_path 固定（体检 WARN 小尾巴）
   创建日期: 2026-09-04
   背景: Supabase 安全顾问提示 search_knowledge_articles /
         extract_knowledge_blocks_text / update_knowledge_article_search_vector
         三个函数没设 search_path，理论上存在 search_path 劫持风险。
   改法: ALTER FUNCTION 补 SET search_path = public，不动函数体，幂等可重复执行。
*/

/* search_knowledge_articles 有两个重载（签名不同），逐个改 */
ALTER FUNCTION public.search_knowledge_articles(text[]) SET search_path = public;
ALTER FUNCTION public.search_knowledge_articles(text[], uuid, integer, integer) SET search_path = public;
ALTER FUNCTION public.extract_knowledge_blocks_text(jsonb) SET search_path = public;
ALTER FUNCTION public.update_knowledge_article_search_vector() SET search_path = public;

/* 登记台账（台账表还没建过则跳过，不报错） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260904_fix_search_path.sql', '3个知识库函数补search_path固定')
    ON CONFLICT (file_name) DO NOTHING;
  END IF;
END $$;
