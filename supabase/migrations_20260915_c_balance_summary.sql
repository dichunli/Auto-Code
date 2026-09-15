/* 余额汇总只读 RPC（供应商款项+物流款项改造 批次4，2026-09-15）
 *
 * 背景：
 *   供应商/物流公司余额现在都是前端全量拉流水再加总——流水表越大越慢，
 *   财务页想看全口径欠款也没有现成的数（采购应付和物流应付此前不进财务页）。
 *
 * 内容（全是只读函数，不动任何表）:
 *   1. supplier_balances()：按供应商汇总欠款余额（debit+refund−payment−credit，与页面口径一致）
 *   2. logistics_company_balances()：按物流公司汇总未结运费（debit−payment）
 *
 * 口径说明：与 supplier-transactions / logistics 页面现有公式逐字一致，只是把加总搬到数据库。
*/

/* ============================================================
   一、供应商余额汇总
   ============================================================ */
CREATE OR REPLACE FUNCTION public.supplier_balances()
RETURNS TABLE(supplier_id UUID, supplier_name TEXT, balance NUMERIC)
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.name,
    COALESCE(SUM(CASE t.transaction_type
      WHEN 'debit' THEN t.amount
      WHEN 'refund' THEN t.amount
      WHEN 'payment' THEN -t.amount
      WHEN 'credit' THEN -t.amount
      ELSE 0 END), 0)::NUMERIC(12,2) AS balance
  FROM suppliers s
  LEFT JOIN supplier_transactions t ON t.supplier_id = s.id
  GROUP BY s.id, s.name
  ORDER BY balance DESC;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.supplier_balances() FROM anon, PUBLIC;

/* ============================================================
   二、物流公司余额汇总
   ============================================================ */
CREATE OR REPLACE FUNCTION public.logistics_company_balances()
RETURNS TABLE(company_id UUID, company_name TEXT, balance NUMERIC)
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id, c.name,
    COALESCE(SUM(CASE t.transaction_type
      WHEN 'debit' THEN t.amount
      WHEN 'payment' THEN -t.amount
      ELSE 0 END), 0)::NUMERIC(12,2) AS balance
  FROM logistics_companies c
  LEFT JOIN logistics_transactions t ON t.logistics_company_id = c.id
  GROUP BY c.id, c.name
  ORDER BY balance DESC;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.logistics_company_balances() FROM anon, PUBLIC;

/* ============================================================
   三、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_c_balance_summary.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE proname IN ('supplier_balances', 'logistics_company_balances');
   应返回 2 行。
   ============================================================
*/
