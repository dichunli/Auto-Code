const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://eyyhcdoftwhhpexteuvz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5eWhjZG9mdHdoaHBleHRldXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MzYwNDEsImV4cCI6MjA5MzIxMjA0MX0.tbFfZs1tg2NRX7i0X8qNsB97zdOm84PGSaJMhuwZzkI';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Excel日期序列号转ISO日期字符串 (Excel基准日1899-12-30)
function excelDateToISO(excelDate) {
  if (excelDate === null || excelDate === undefined || excelDate === '') return null;
  const date = new Date((excelDate - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

async function importVehicleModels() {
  const wb = xlsx.readFile('E:/auto code/auto-repair-shop/车型信息.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // 列名映射：英文 -> 中文
  const columnMap = {
    id: 'id',
    factory: '厂商',
    import_flag: '进口标志',
    vehicle_type: '车辆类型',
    epc: 'EPC编码',
    model_year: '年款',
    brand: '品牌',
    brand_icon: '品牌图标',
    brand_alias: '品牌别名',
    series: '车系',
    model: '车型',
    sales_version: '销售版本',
    sales_name: '销售名称',
    cc: '排量',
    engine_no: '发动机型号',
    fuel_type: '燃油类型',
    air_intake: '进气形式',
    array_type: '排列形式',
    valve_num: '气门数',
    roz: '燃油标号',
    fueljet_type: '喷射方式',
    effluent_standard: '排放标准',
    kw: '功率',
    hp: '马力',
    driving_mode: '驱动方式',
    transmission_detail: '变速箱详情',
    gear_num: '档位数',
    transmission_type: '变速箱类型',
    trans_code: '变速箱代号',
    Chassis_code: '底盘代号',
    door_num: '车门数',
    seat_num: '座位数',
    body_type: '车身类型',
    steering_type: '转向类型',
    vehicle_size: '车身尺寸',
    track_front: '前轮距',
    track_rear: '后轮距',
    wheel_base: '轴距',
    full_weight: '整备质量',
    stop_flag: '停产标志',
    frontTyre_size: '前轮胎规格',
    rearTyre_size: '后轮胎规格',
    abs_flag: 'ABS标志',
    date_begin: '开始日期',
    date_end: '结束日期',
    price: '厂商指导价',
    Engine_roz: '发动机燃油标号',
    is_modified_version: '改款标志',
    has_part: '有配件标志',
  };

  // 构建中文列名数组（按headers顺序）
  const chineseHeaders = headers.map((h) => columnMap[h] || h);

  const batchSize = 500;
  const total = dataRows.length;
  let inserted = 0;

  for (let i = 0; i < total; i += batchSize) {
    const batch = dataRows.slice(i, i + batchSize).map((row) => {
      const record = {};
      for (let j = 0; j < headers.length; j++) {
        const enKey = headers[j];
        const cnKey = chineseHeaders[j];
        let value = row[j];

        // 处理undefined -> null
        if (value === undefined) value = null;

        // Excel日期字段转换
        if (enKey === 'date_begin' || enKey === 'date_end') {
          value = excelDateToISO(value);
        }

        record[cnKey] = value;
      }
      return record;
    });

    const { error } = await supabase.from('vehicle_models').insert(batch);
    if (error) {
      console.error(`Batch ${i / batchSize + 1} failed:`, error.message);
      // 打印第一条数据帮助调试
      console.error('First record:', batch[0]);
      process.exit(1);
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted}/${total}`);
  }

  console.log(`Done! Total imported: ${inserted}`);
}

importVehicleModels().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
