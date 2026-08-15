/*
 * 自定义采购暂存表（2026-08-15 需求）
 * 用途：安全库存补货 / 自定义采购 两个弹窗不再直接生成采购单，
 * 先添加到这里，在「待采购」页统一勾选发起采购（无工单的采购配件）。
 * 发起采购成功后删除对应暂存行。
 */

CREATE TABLE IF NOT EXISTS public.custom_purchase_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid REFERENCES public.parts(id),
  part_number text,
  name text NOT NULL,
  brand text,
  specification text,
  document_name text,
  unit text,
  unit_cost numeric(12,2),
  quantity integer NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  supplier_name text,
  /* 来源：safety_stock=安全库存补货，custom=自定义采购 */
  source text NOT NULL DEFAULT 'custom',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_purchase_staging_supplier ON public.custom_purchase_staging(supplier_id);
CREATE INDEX IF NOT EXISTS idx_custom_purchase_staging_part ON public.custom_purchase_staging(part_id);

ALTER TABLE public.custom_purchase_staging ENABLE ROW LEVEL SECURITY;

/* 与 purchase_orders 保持一致：登录员工全量读写 */
CREATE POLICY auth_full_access ON public.custom_purchase_staging
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
