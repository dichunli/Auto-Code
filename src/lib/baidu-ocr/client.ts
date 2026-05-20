"use server";

const BAIDU_API_KEY = process.env.BAIDU_API_KEY || "";
const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY || "";

interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface LicensePlateResponse {
  log_id: number;
  words_result?: {
    number: string;
    color: string;
  };
  words_result_num?: number;
  error_code?: number;
  error_msg?: string;
}

/* 获取百度AI access_token */
async function getAccessToken(): Promise<string> {
  if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
    throw new Error("缺少环境变量 BAIDU_API_KEY 或 BAIDU_SECRET_KEY");
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(BAIDU_API_KEY)}&client_secret=${encodeURIComponent(BAIDU_SECRET_KEY)}`;

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`获取百度AI token失败 [${res.status}]`);
  }

  const data: AccessTokenResponse = await res.json();
  if (data.error) {
    throw new Error(`获取token失败: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

/* 车牌识别 */
export async function recognizeLicensePlate(base64Image: string): Promise<string> {
  const accessToken = await getAccessToken();

  /* 去掉 data:image/xxx;base64, 前缀 */
  const base64Body = base64Image.split(",")[1] || base64Image;

  const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/license_plate?access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `image=${encodeURIComponent(base64Body)}`,
  });

  if (!res.ok) {
    throw new Error(`车牌识别请求失败 [${res.status}]`);
  }

  const data: LicensePlateResponse = await res.json();
  if (data.error_code) {
    throw new Error(`车牌识别失败: ${data.error_msg || String(data.error_code)}`);
  }

  if (!data.words_result?.number) {
    throw new Error("未能识别出车牌号码");
  }

  return data.words_result.number;
}
