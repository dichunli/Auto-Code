"use server";

import { getToken } from "./auth";
import { createAdminClient } from "@/lib/supabase/admin";

const BASE_URL = "http://api.17vin.com:8080";
const USERNAME = process.env.VIN17_USERNAME || "";

/* 记录17VIN API调用日志 */
async function 记录调用日志(
  接口类型: string,
  请求参数: Record<string, string>,
  响应状态: number,
  是否成功: boolean,
  错误信息?: string
) {
  try {
    const admin = createAdminClient();
    await admin.from("vin17_api_logs").insert({
      接口类型,
      请求参数,
      响应状态,
      是否成功,
      错误信息: 错误信息 || null,
    });
  } catch {
    /* 日志记录失败不影响主流程 */
  }
}

async function vin17Request(path: string, params: Record<string, string>): Promise<unknown> {
  if (!USERNAME) {
    throw new Error("缺少环境变量 VIN17_USERNAME");
  }

  const 接口类型 = params.action || path || "unknown";

  /* token 计算使用原始参数字符串（不 URL 编码） */
  const rawQuery = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const urlParameters = path + "?" + rawQuery;
  const token = getToken(urlParameters);

  /* 实际请求 URL 需要编码 */
  const encodedQuery = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const fullUrl = `${BASE_URL}${path}?${encodedQuery}&user=${encodeURIComponent(USERNAME)}&token=${token}`;

  const res = await fetch(fullUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    await 记录调用日志(接口类型, params, res.status, false, res.statusText);
    throw new Error(`17VIN 请求失败 [${res.status}]: ${res.statusText}`);
  }

  const data = await res.json();
  const 是否成功 = (data as { code?: number }).code === 1;
  await 记录调用日志(接口类型, params, res.status, 是否成功, 是否成功 ? undefined : (data as { msg?: string }).msg);

  return data;
}

/* ==================== 具体接口封装 ==================== */

/* VIN 解码 */
export async function vin17DecodeVin(vin: string) {
  return vin17Request("/", { vin });
}

/* VIN 下一级目录（车型分组） */
export async function vin17GetCata1(vin: string, brandCode: string) {
  return vin17Request(`/${brandCode}`, { action: "cata1", vin });
}

/* VIN 下二级目录 */
export async function vin17GetCata2(vin: string, brandCode: string, cata1Code: string) {
  return vin17Request(`/${brandCode}`, {
    action: "cata2",
    vin,
    cata1_code: cata1Code,
  });
}

/* VIN 下配件列表 */
export async function vin17GetParts(
  vin: string,
  brandCode: string,
  lastCataCode: string,
  lastCataCodeLevel: string
) {
  return vin17Request(`/${brandCode}`, {
    action: "part",
    vin,
    last_cata_code: lastCataCode,
    last_cata_code_level: lastCataCodeLevel,
  });
}

/* 配件号码搜索 */
export async function vin17SearchPartNumber(
  vin: string,
  partNumber: string,
  matchType: "exact" | "fuzzy" = "exact"
) {
  return vin17Request("/", {
    action: "search_part_number",
    vin,
    query_match_type: matchType,
    query_part_number: partNumber,
  });
}

/* ==================== POST 请求辅助函数（用于 OCR 接口） ==================== */

async function vin17PostRequest(params: Record<string, string>): Promise<unknown> {
  if (!USERNAME) {
    throw new Error("缺少环境变量 VIN17_USERNAME");
  }

  const 接口类型 = params.action || "unknown";

  /* token 计算使用原始参数字符串（不 URL 编码） */
  const rawQuery = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const urlParameters = "/?" + rawQuery;
  const token = getToken(urlParameters);

  /* 实际 POST body 需要编码 */
  const bodyParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => bodyParams.append(k, v));
  bodyParams.append("user", USERNAME);
  bodyParams.append("token", token);

  const res = await fetch(`${BASE_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: bodyParams.toString(),
  });

  if (!res.ok) {
    await 记录调用日志(接口类型, params, res.status, false, res.statusText);
    throw new Error(`17VIN 请求失败 [${res.status}]: ${res.statusText}`);
  }

  const data = await res.json();
  const 是否成功 = (data as { code?: number }).code === 1;
  await 记录调用日志(接口类型, params, res.status, 是否成功, 是否成功 ? undefined : (data as { msg?: string }).msg);

  return data;
}

/* OCR 识别 VIN（仅返回 VIN 字符串） */
export async function vin17OcrImage(base64UrlencodeImage: string) {
  return vin17PostRequest({
    action: "vin_ocr",
    base64_urlencode_imagestring: base64UrlencodeImage,
  });
}

/* OCR 识别 VIN 并自动解码 */
export async function vin17OcrAndDecode(base64UrlencodeImage: string) {
  return vin17PostRequest({
    action: "vin_ocr_and_vin_decode",
    base64_urlencode_imagestring: base64UrlencodeImage,
  });
}

/* 通过配件号(OE号/品牌件号)获取适用车型（API 40031） */
export async function vin17GetModelListFromPartNumber(partNumber: string, groupId: string) {
  return vin17Request("/", {
    action: "get_modellist_from_part_number_and_group_id",
    part_number: partNumber,
    group_id: groupId,
  });
}

/* ==================== 账户余额查询（接口1002） ==================== */

export interface Vin17BalanceItem {
  Username: string;
  Count: string;
  Remark: string;
}

export interface Vin17BalanceResult {
  code: number;
  msg?: string;
  data?: Vin17BalanceItem[];
}

/* 查询17VIN账户余额 */
export async function vin17GetBalance(): Promise<Vin17BalanceResult> {
  return vin17Request("/", { action: "myapicount" }) as Promise<Vin17BalanceResult>;
}

/* ==================== VIN查保养件（接口7001） ==================== */

export interface Vin17AftermarketPart {
  partnumber: string;
  partnumber_original: string;
  brand: string;
  manufacturer_brand: string;
  name: string;
  name_en: string;
  category: string;
  remark: string;
  [key: string]: unknown;
}

export interface Vin17AftermarketResult {
  code: number;
  msg?: string;
  data?: {
    aftermarket?: Vin17AftermarketPart[];
  };
}

/* VIN查保养件：直接传VIN+品牌，返回保养件列表 */
export async function vin17SearchAftermarketParts(
  vin: string,
  manufacturerBrand: string,
  category?: string
): Promise<Vin17AftermarketResult> {
  const params: Record<string, string> = {
    action: "aftermarket_vin",
    vin,
    manufacturer_brand: manufacturerBrand,
  };
  if (category) {
    params.category = category;
  }
  return vin17Request("/", params) as Promise<Vin17AftermarketResult>;
}

/* ==================== VIN查三滤（遍历EPC目录） ==================== */

interface Vin17CataItem {
  cata_code: string;
  cata_index: string;
  name_en: string;
  name_zh: string;
  cata_level: number;
  is_last: number;
  is_fit_for_this_vin: number;
}

interface Vin17PartItem {
  illustration_img_address: string;
  cata_code: string;
  callout: string;
  partnumber_original: string;
  partnumber: string;
  engineer_partnumber: string;
  name_en: string;
  name_zh: string;
  std_name_en: string;
  std_name_zh: string;
  qty: string;
  begin_date: string;
  end_date: string;
  replacement: string;
  old_replacement: string;
  Components: unknown;
  remark_en: string;
  remark_zh: string;
  sort: number;
  is_fit_for_this_vin: number;
}

export interface Vin17FilterResult {
  type: "oil" | "air" | "cabin";
  typeName: string;
  oeNumber: string;
  partNumber: string;
  name: string;
  cataCode: string;
  cataName: string;
  remark: string;
}

/* 三级目录 */
export async function vin17GetCata3(vin: string, brandCode: string, cata2Code: string) {
  return vin17Request(`/${brandCode}`, {
    action: "cata3",
    vin,
    cata2_code: cata2Code,
  });
}

/* 四级目录 */
export async function vin17GetCata4(vin: string, brandCode: string, cata3Code: string) {
  return vin17Request(`/${brandCode}`, {
    action: "cata4",
    vin,
    cata3_code: cata3Code,
  });
}

/* VIN查三滤：自动遍历EPC目录查找机油滤/空气滤/空调滤 */
export async function vin17SearchFiltersByVin(vin: string): Promise<Vin17FilterResult[]> {
  /* 1. VIN解码获取品牌码 */
  const decodeResult = (await vin17DecodeVin(vin)) as {
    code: number;
    data?: { epc?: string; brand?: string };
    msg?: string;
  };
  if (decodeResult.code !== 1 || !decodeResult.data?.epc) {
    throw new Error("VIN解码失败: " + (decodeResult.msg || "未知错误"));
  }
  const brandCode = decodeResult.data.epc;

  const results: Vin17FilterResult[] = [];
  const visitedCataCodes = new Set<string>();

  /* 判断目录名是否可能包含三滤 */
  function isFilterCata(nameZh: string, nameEn: string): { type?: "oil" | "air" | "cabin"; score: number } {
    const name = (nameZh + " " + nameEn).toLowerCase();
    /* 机油滤 */
    if ((name.includes("机油") || name.includes("oil")) && (name.includes("滤") || name.includes("filter"))) {
      return { type: "oil", score: 10 };
    }
    if (name.includes("oil filter") || name.includes("ölfilter")) {
      return { type: "oil", score: 10 };
    }
    /* 空气滤 */
    if ((name.includes("空气") || name.includes("air")) && (name.includes("滤") || name.includes("filter"))) {
      return { type: "air", score: 10 };
    }
    if (name.includes("air filter") || name.includes("luftfilter")) {
      return { type: "air", score: 10 };
    }
    /* 空调滤/花粉滤 */
    if ((name.includes("空调") || name.includes("cabin") || name.includes("花粉") || name.includes("pollen") || name.includes("粉尘") || name.includes("dust")) && (name.includes("滤") || name.includes("filter"))) {
      return { type: "cabin", score: 10 };
    }
    if (name.includes("cabin filter") || name.includes("innenraumfilter")) {
      return { type: "cabin", score: 10 };
    }
    /* 模糊匹配：只包含滤/Filter的目录给低分 */
    if (name.includes("滤") || name.includes("filter")) {
      return { score: 3 };
    }
    return { score: 0 };
  }

  /* 判断配件是否是三滤 */
  function matchFilterPart(part: Vin17PartItem): { type: "oil" | "air" | "cabin"; score: number } | null {
    const name = (part.name_zh + " " + part.std_name_zh + " " + part.name_en + " " + part.std_name_en).toLowerCase();
    const hasNumber = !!(part.partnumber_original || part.partnumber);
    if (!hasNumber) return null;

    /* 机油滤 */
    if ((name.includes("机油") || name.includes("oil")) && (name.includes("滤") || name.includes("filter"))) {
      if (name.includes("机油滤清器") || name.includes("滤芯") || name.includes("oil filter")) return { type: "oil", score: 10 };
      return { type: "oil", score: 5 };
    }
    /* 空气滤 */
    if ((name.includes("空气") || name.includes("air")) && (name.includes("滤") || name.includes("filter"))) {
      if (name.includes("空气滤清器") || name.includes("air filter")) return { type: "air", score: 10 };
      return { type: "air", score: 5 };
    }
    /* 空调滤 */
    if ((name.includes("空调") || name.includes("cabin") || name.includes("花粉") || name.includes("pollen") || name.includes("粉尘") || name.includes("气味") || name.includes("odor")) && (name.includes("滤") || name.includes("filter"))) {
      if (name.includes("空调滤清器") || name.includes("cabin filter") || name.includes("花粉") || name.includes("粉尘")) return { type: "cabin", score: 10 };
      return { type: "cabin", score: 5 };
    }
    return null;
  }

  /* 递归搜索目录 */
  async function searchDirectory(cataCode: string, level: number, parentType?: "oil" | "air" | "cabin") {
    if (visitedCataCodes.has(cataCode)) return;
    visitedCataCodes.add(cataCode);

    let cataItems: Vin17CataItem[] = [];

    try {
      if (level === 1) {
        const res = (await vin17GetCata1(vin, brandCode)) as { code: number; data?: { catalist?: Vin17CataItem[] } };
        cataItems = res.data?.catalist || [];
      } else if (level === 2) {
        const res = (await vin17GetCata2(vin, brandCode, cataCode)) as { code: number; data?: { catalist?: Vin17CataItem[] } };
        cataItems = res.data?.catalist || [];
      } else if (level === 3) {
        const res = (await vin17GetCata3(vin, brandCode, cataCode)) as { code: number; data?: { catalist?: Vin17CataItem[] } };
        cataItems = res.data?.catalist || [];
      } else if (level === 4) {
        const res = (await vin17GetCata4(vin, brandCode, cataCode)) as { code: number; data?: { catalist?: Vin17CataItem[] } };
        cataItems = res.data?.catalist || [];
      }
    } catch {
      return;
    }

    for (const item of cataItems) {
      if (!item.is_fit_for_this_vin) continue;

      const cataMatch = isFilterCata(item.name_zh, item.name_en);
      const inferredType = cataMatch.type || parentType;

      if (item.is_last === 1) {
        /* 获取配件列表 */
        try {
          const partRes = (await vin17GetParts(vin, brandCode, item.cata_code, String(item.cata_level))) as {
            code: number;
            data?: { partlist?: Vin17PartItem[] };
          };
          const parts = partRes.data?.partlist || [];
          for (const part of parts) {
            const partMatch = matchFilterPart(part);
            if (partMatch) {
              results.push({
                type: partMatch.type,
                typeName: partMatch.type === "oil" ? "机油滤清器" : partMatch.type === "air" ? "空气滤清器" : "空调滤清器",
                oeNumber: part.partnumber_original || part.partnumber || "",
                partNumber: part.partnumber || part.partnumber_original || "",
                name: part.name_zh || part.std_name_zh || part.name_en || part.std_name_en || "",
                cataCode: item.cata_code,
                cataName: item.name_zh || item.name_en,
                remark: part.remark_zh || part.remark_en || "",
              });
            }
          }
        } catch {
          /* 忽略单个目录查询失败 */
        }
      } else if (level < 4) {
        /* 继续递归下一级 */
        await searchDirectory(item.cata_code, level + 1, inferredType);
      }
    }
  }

  /* 从cata1开始搜索 */
  await searchDirectory("", 1);

  /* 去重：相同OE号只保留一个 */
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.type + "|" + r.oeNumber;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
