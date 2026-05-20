"use server";

import { getToken } from "./auth";

const BASE_URL = "http://api.17vin.com:8080";
const USERNAME = process.env.VIN17_USERNAME || "";

async function vin17Request(path: string, params: Record<string, string>): Promise<any> {
  if (!USERNAME) {
    throw new Error("缺少环境变量 VIN17_USERNAME");
  }

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
    throw new Error(`17VIN 请求失败 [${res.status}]: ${res.statusText}`);
  }

  return res.json();
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

async function vin17PostRequest(params: Record<string, string>): Promise<any> {
  if (!USERNAME) {
    throw new Error("缺少环境变量 VIN17_USERNAME");
  }

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
    throw new Error(`17VIN 请求失败 [${res.status}]: ${res.statusText}`);
  }

  return res.json();
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
