/* 17VIN API调用日志表 */
CREATE TABLE IF NOT EXISTS vin17_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  接口类型 TEXT NOT NULL,
  请求参数 JSONB DEFAULT '{}',
  响应状态 INTEGER,
  是否成功 BOOLEAN DEFAULT false,
  错误信息 TEXT,
  创建时间 TIMESTAMPTZ DEFAULT now()
);

/* 索引 */
CREATE INDEX IF NOT EXISTS idx_vin17_api_logs_创建时间 ON vin17_api_logs(创建时间 DESC);
CREATE INDEX IF NOT EXISTS idx_vin17_api_logs_接口类型 ON vin17_api_logs(接口类型);

/* RLS 策略 */
ALTER TABLE vin17_api_logs ENABLE ROW LEVEL SECURITY;

/* 所有认证用户可读 */
CREATE POLICY "所有用户可查看17VIN调用日志"
  ON vin17_api_logs FOR SELECT
  TO authenticated
  USING (true);

/* 仅服务端可插入 */
CREATE POLICY "仅服务端可插入17VIN调用日志"
  ON vin17_api_logs FOR INSERT
  TO service_role
  WITH CHECK (true);
