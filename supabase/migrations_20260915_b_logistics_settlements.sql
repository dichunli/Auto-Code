/* 物流结算单（供应商款项+物流款项改造 批次3，2026-09-15）
 *
 * 背景：
 *   运费现结现付靠逐张运单点"结清运费"（settle_waybill_freight），
 *   物流公司月结的场景下要一张张点，没有对账凭证，也无法回答"这笔钱结了哪几单"。
 *
 * 设计（定稿口径）：
 *   1. logistics_settlements 结算单：一次结一家物流公司的一批运单（JS-日期-序号），
 *      带支付方式/覆盖期间，就是月底发给物流公司的对账凭证
 *   2. logistics_settlement_items 结算明细：快照每张某单的运费（防后续改运费对不上）
 *   3. 结算事务：逐运单写 logistics_transactions(payment, settlement_id, payment_method)
 *      + 运单打 freight_settled 标——与现有单笔结清口径完全一致（余额=debit−payment 不变）
 *   4. 作废：结算单打 voided 留痕 + 删对应 payment 流水 + 运单解除结清标
 *      （与"撤销入库删流水"同一风格；明细保留作历史）
 *
 * 幂等三防：建表建索引 IF NOT EXISTS；触发器/函数 CREATE OR REPLACE；
 *           策略 DROP 再 CREATE；台账 ON CONFLICT DO NOTHING。
*/

/* ============================================================
   一、物流结算单表
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.logistics_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_no TEXT UNIQUE,                 /* JS-YYYYMMDD-NNN，触发器生成 */
  logistics_company_id UUID NOT NULL REFERENCES public.logistics_companies(id),
  waybill_count INTEGER NOT NULL CHECK (waybill_count > 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  payment_method TEXT,                       /* 支付方式（复用 payment_methods 字典） */
  period_start DATE,                         /* 结算覆盖区间（按运单签收日，对账用） */
  period_end DATE,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'voided')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES public.profiles(id),
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_logistics_settlements_company ON public.logistics_settlements(logistics_company_id);
CREATE INDEX IF NOT EXISTS idx_logistics_settlements_created ON public.logistics_settlements(created_at);
CREATE INDEX IF NOT EXISTS idx_logistics_settlements_status ON public.logistics_settlements(status);

/* ============================================================
   二、结算明细表（一张运单可多次进不同结算单的历史，但同一时间只能
      在一张"有效"结算单里——由 RPC 校验+公司级串行锁保证，不落唯一约束）
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.logistics_settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES public.logistics_settlements(id) ON DELETE CASCADE,
  waybill_id UUID NOT NULL REFERENCES public.logistics_waybills(id),
  freight_amount NUMERIC(12,2) NOT NULL CHECK (freight_amount >= 0),  /* 结算时运费快照 */
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lsi_settlement ON public.logistics_settlement_items(settlement_id);
CREATE INDEX IF NOT EXISTS idx_lsi_waybill ON public.logistics_settlement_items(waybill_id);

/* ============================================================
   三、物流往来账加结算单关联 + 支付方式
   ============================================================ */
ALTER TABLE public.logistics_transactions ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES public.logistics_settlements(id);
ALTER TABLE public.logistics_transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
CREATE INDEX IF NOT EXISTS idx_logistics_tx_settlement ON public.logistics_transactions(settlement_id);

/* ============================================================
   四、RLS：登录可读；写一律走 RPC（SECURITY DEFINER），不开客户端直写
   ============================================================ */
ALTER TABLE public.logistics_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_settlement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logistics_settlements_select ON public.logistics_settlements;
CREATE POLICY logistics_settlements_select ON public.logistics_settlements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lsi_select ON public.logistics_settlement_items;
CREATE POLICY lsi_select ON public.logistics_settlement_items
  FOR SELECT TO authenticated USING (true);

/* ============================================================
   五、结算单号序列触发器：JS-YYYYMMDD-NNN（与采购单 CG- 同款模式）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.generate_logistics_settlement_no()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(suffix::INTEGER), 0) + 1 INTO seq_num
  FROM (
    SELECT REGEXP_REPLACE(settlement_no, '^JS-' || today || '-', '') AS suffix
    FROM logistics_settlements
    WHERE settlement_no LIKE 'JS-' || today || '-%'
  ) t
  WHERE suffix ~ '^\d+$';
  NEW.settlement_no := 'JS-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_logistics_settlement_no ON public.logistics_settlements;
CREATE TRIGGER set_logistics_settlement_no BEFORE INSERT ON public.logistics_settlements
  FOR EACH ROW WHEN (NEW.settlement_no IS NULL) EXECUTE FUNCTION public.generate_logistics_settlement_no();

/* ============================================================
   六、创建结算单（事务）
   参数:
     p_company_id      物流公司 id（必填）
     p_waybill_ids     本次结算的运单 id 数组（至少一张）
     p_payment_method  支付方式（可空）
     p_note            备注（可空）
   校验（全部在锁内）:
     运单存在 / 属于该公司 / 运费>0 / 未结清 / 不在其他有效结算单里
   事务内容:
     建结算单(期间取运单签收日最小最大) → 明细(运费快照)
     → 逐运单写 payment 流水 + 打 freight_settled 标
   返回: { success, settlement_id, settlement_no, total_amount, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_logistics_settlement(
  p_company_id UUID,
  p_waybill_ids UUID[],
  p_payment_method TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement_id UUID;
  v_settlement_no TEXT;
  v_wb RECORD;
  v_total NUMERIC(12,2) := 0;
  v_count INTEGER := 0;
  v_min_date DATE;
  v_max_date DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:物流款项写操作仅 管理员/老板/仓管 可执行（与结清运费口径一致） */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择物流公司');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM logistics_companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '物流公司不存在');
  END IF;
  IF p_waybill_ids IS NULL OR array_length(p_waybill_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请至少选择一张运单');
  END IF;

  /* 同一物流公司的结算串行化：防两个窗口同时结算同一批运单 */
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::TEXT));

  /* ── 建结算单前先逐张校验并算总额（锁住运单行） ── */
  FOR v_wb IN
    SELECT w.* FROM logistics_waybills w
    WHERE w.id = ANY(p_waybill_ids)
    ORDER BY w.received_at NULLS LAST, w.created_at
    FOR UPDATE OF w
  LOOP
    IF v_wb.logistics_company_id IS DISTINCT FROM p_company_id THEN
      RETURN jsonb_build_object('success', false, 'error',
        '运单 ' || COALESCE(v_wb.tracking_no, '') || ' 不属于该物流公司');
    END IF;
    /* 必须已签收：应付运费（debit）是签收时触发器记的，未签收就结会结出负余额 */
    IF v_wb.status <> 'received' THEN
      RETURN jsonb_build_object('success', false, 'error',
        '运单 ' || COALESCE(v_wb.tracking_no, '') || ' 还未签收，不能结算运费');
    END IF;
    IF COALESCE(v_wb.freight_amount, 0) <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error',
        '运单 ' || COALESCE(v_wb.tracking_no, '') || ' 没有运费金额，不能结算');
    END IF;
    IF v_wb.freight_settled THEN
      RETURN jsonb_build_object('success', false, 'error',
        '运单 ' || COALESCE(v_wb.tracking_no, '') || ' 运费已结清，请刷新后重试');
    END IF;
    IF EXISTS (
      SELECT 1 FROM logistics_settlement_items i
      JOIN logistics_settlements s ON s.id = i.settlement_id
      WHERE i.waybill_id = v_wb.id AND s.status = 'confirmed'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '运单 ' || COALESCE(v_wb.tracking_no, '') || ' 已在其他有效结算单里');
    END IF;

    v_total := v_total + v_wb.freight_amount;
    v_count := v_count + 1;
    /* 结算覆盖区间 = 这批运单签收日的最小/最大（未签收的运单不影响区间） */
    IF v_wb.received_at IS NOT NULL THEN
      v_min_date := LEAST(COALESCE(v_min_date, v_wb.received_at::DATE), v_wb.received_at::DATE);
      v_max_date := GREATEST(COALESCE(v_max_date, v_wb.received_at::DATE), v_wb.received_at::DATE);
    END IF;
  END LOOP;

  IF v_count <> array_length(p_waybill_ids, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', '部分运单不存在，请刷新后重试');
  END IF;

  /* ── 建结算单（单号触发器生成） ── */
  INSERT INTO logistics_settlements (
    logistics_company_id, waybill_count, total_amount,
    payment_method, period_start, period_end, note, created_by
  ) VALUES (
    p_company_id, v_count, v_total,
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    v_min_date, v_max_date,
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    auth.uid()
  )
  RETURNING id, settlement_no INTO v_settlement_id, v_settlement_no;

  /* ── 明细 + 逐运单写流水 + 打结清标 ── */
  FOR v_wb IN SELECT * FROM logistics_waybills WHERE id = ANY(p_waybill_ids) LOOP
    INSERT INTO logistics_settlement_items (settlement_id, waybill_id, freight_amount)
    VALUES (v_settlement_id, v_wb.id, v_wb.freight_amount);

    INSERT INTO logistics_transactions (
      logistics_company_id, transaction_type, amount, description,
      reference_id, reference_type, settlement_id, payment_method, created_by
    ) VALUES (
      p_company_id, 'payment', v_wb.freight_amount,
      '运费结算(运单 ' || COALESCE(v_wb.tracking_no, '') || '，结算单 ' || v_settlement_no || ')',
      v_wb.id, 'logistics_waybill', v_settlement_id,
      NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
      auth.uid()
    );

    UPDATE logistics_waybills
    SET freight_settled = true, freight_settled_at = NOW()
    WHERE id = v_wb.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'settlement_id', v_settlement_id,
    'settlement_no', v_settlement_no,
    'total_amount', v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_logistics_settlement(uuid, uuid[], text, text) FROM anon, PUBLIC;

/* ============================================================
   七、作废结算单（事务）：打 voided 标 + 删付款流水 + 运单解除结清标
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_logistics_settlement(p_settlement_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_settlement FROM logistics_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '结算单不存在');
  END IF;
  IF v_settlement.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该结算单已作废，请勿重复操作');
  END IF;

  /* 与该公司的结算操作同一把锁 */
  PERFORM pg_advisory_xact_lock(hashtext(v_settlement.logistics_company_id::TEXT));

  UPDATE logistics_settlements
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_settlement_id;

  /* 删本次结算写的 payment 流水（按 settlement_id 精确定位） */
  DELETE FROM logistics_transactions
  WHERE settlement_id = p_settlement_id AND transaction_type = 'payment';

  /* 运单解除结清标（明细保留作历史） */
  UPDATE logistics_waybills
  SET freight_settled = false, freight_settled_at = NULL
  WHERE id IN (SELECT waybill_id FROM logistics_settlement_items WHERE settlement_id = p_settlement_id);

  RETURN jsonb_build_object('success', true, 'settlement_no', v_settlement.settlement_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_logistics_settlement(uuid) FROM anon, PUBLIC;

/* ============================================================
   八、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_b_logistics_settlements.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('logistics_settlements', 'logistics_settlement_items');
      应返回 2 行。
   2. 新列:
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'logistics_transactions'
        AND column_name IN ('settlement_id', 'payment_method');
      应返回 2 行。
   3. 两个函数带门禁:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_logistics_settlement', 'void_logistics_settlement')
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 2 行。
   4. 单号触发器:
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.logistics_settlements'::regclass
        AND tgname = 'set_logistics_settlement_no';
      应返回 1 行。
   ============================================================
*/
