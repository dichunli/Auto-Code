/* ============================================================
   车型库字段名封装
   防止手滑写英文字段名，vehicle_models 表字段全是中文
   ============================================================ */

export const 车型库字段 = {
  id: "id",
  厂商: "厂商",
  品牌: "品牌",
  品牌图标: "品牌图标",
  品牌别名: "品牌别名",
  车系: "车系",
  车型: "车型",
  销售版本: "销售版本",
  年款: "年款",
  排量: "排量",
  发动机型号: "发动机型号",
  燃油类型: "燃油类型",
  进气形式: "进气形式",
  变速箱类型: "变速箱类型",
  变速箱代号: "变速箱代号",
  底盘代号: "底盘代号",
  驱动方式: "驱动方式",
  车身类型: "车身类型",
  排放标准: "排放标准",
} as const;

/* 根据需要的字段名数组构建 Supabase select 字符串 */
export function 构建车型库查询字段(需要的字段: string[]): string {
  return 需要的字段.join(", ");
}

/* 完整字段列表（用于详情展示） */
export const 车型库完整字段 = Object.values(车型库字段).join(", ");

/* 核心匹配字段（用于17VIN车型匹配，字段最少，查询最快） */
export const 车型库匹配字段 = "id, 品牌, 车系, 车型, 年款, 发动机型号";

/* 新建/编辑配件页面展示用字段 */
export const 车型库展示字段 = "id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准";

/* vehicle_models 行类型（字段全是中文）。
 * supabase-js 的类型解析器不认中文列名，select 中文列时返回类型会变成
 * ParserError，所以各查询处需要把结果断言成这个接口（纯类型操作）。 */
export interface 车型库行 {
  id: number;
  厂商?: string | null;
  品牌?: string | null;
  品牌图标?: string | null;
  品牌别名?: string | null;
  车系?: string | null;
  车型?: string | null;
  销售版本?: string | null;
  年款?: number | null;
  排量?: string | null;
  发动机型号?: string | null;
  燃油类型?: string | null;
  进气形式?: string | null;
  变速箱类型?: string | null;
  变速箱代号?: string | null;
  底盘代号?: string | null;
  /* 后期补充的同义列（与 底盘代号/变速箱代号 并存于 vehicle_models 表） */
  底盘型号?: string | null;
  变速箱型号?: string | null;
  驱动方式?: string | null;
  车身类型?: string | null;
  排放标准?: string | null;
}

/* 补充：VehicleModelSelector 用到的轮胎规格字段（同属 vehicle_models 表） */
export interface 车型库行含轮胎 extends 车型库行 {
  前轮胎规格?: string | null;
  后轮胎规格?: string | null;
}
