/* 17VIN API 返回类型（根据实际返回逐步完善） */

export interface Vin17Response<T = any> {
  code: number;
  message: string;
  data: T;
}

export interface VinDecodeResult {
  /* 字段根据实际返回填写，此处预留常见字段 */
  vin?: string;
  brand?: string;
  series?: string;
  model?: string;
  year?: string;
  engine?: string;
  [key: string]: any;
}
