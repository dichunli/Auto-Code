-- 车型库表重建（根据车型信息.xlsx导入）
DROP TABLE IF EXISTS vehicle_models CASCADE;

CREATE TABLE vehicle_models (
  id INTEGER PRIMARY KEY,
  厂商 TEXT,
  进口标志 TEXT,
  车辆类型 TEXT,
  EPC编码 TEXT,
  年款 INTEGER,
  品牌 TEXT,
  品牌图标 TEXT,
  品牌别名 TEXT,
  车系 TEXT,
  车型 TEXT,
  销售版本 TEXT,
  销售名称 TEXT,
  排量 TEXT,
  发动机型号 TEXT,
  燃油类型 TEXT,
  进气形式 TEXT,
  排列形式 TEXT,
  气门数 INTEGER,
  燃油标号 TEXT,
  喷射方式 TEXT,
  排放标准 TEXT,
  功率 INTEGER,
  马力 INTEGER,
  驱动方式 TEXT,
  变速箱详情 TEXT,
  档位数 INTEGER,
  变速箱类型 TEXT,
  变速箱代号 TEXT,
  底盘代号 TEXT,
  车门数 TEXT,
  座位数 INTEGER,
  车身类型 TEXT,
  转向类型 TEXT,
  车身尺寸 TEXT,
  前轮距 INTEGER,
  后轮距 INTEGER,
  轴距 INTEGER,
  整备质量 INTEGER,
  停产标志 TEXT,
  前轮胎规格 TEXT,
  后轮胎规格 TEXT,
  ABS标志 TEXT,
  开始日期 DATE,
  结束日期 DATE,
  厂商指导价 INTEGER,
  发动机燃油标号 TEXT,
  改款标志 INTEGER,
  有配件标志 INTEGER
);

CREATE INDEX idx_vehicle_models_品牌 ON vehicle_models(品牌);
CREATE INDEX idx_vehicle_models_车系 ON vehicle_models(车系);
CREATE INDEX idx_vehicle_models_车型 ON vehicle_models(车型);
CREATE INDEX idx_vehicle_models_年款 ON vehicle_models(年款);
CREATE INDEX idx_vehicle_models_厂商 ON vehicle_models(厂商);
