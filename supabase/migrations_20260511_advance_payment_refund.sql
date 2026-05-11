-- 预收款记录表添加退款字段
-- 请在 Supabase Dashboard → SQL Editor 中执行以下语句

ALTER TABLE advance_payment_records
ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_method TEXT;

-- 刷新 PostgREST schema cache（执行后等待 5-10 秒生效）
NOTIFY pgrst, 'reload schema';
