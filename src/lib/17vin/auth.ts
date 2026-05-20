import crypto from "crypto";

const USERNAME = process.env.VIN17_USERNAME || "";
const PASSWORD = process.env.VIN17_PASSWORD || "";

function md5(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}

export function getToken(urlParameters: string): string {
  if (!USERNAME || !PASSWORD) {
    throw new Error("缺少 17VIN 账号配置，请检查环境变量 VIN17_USERNAME 和 VIN17_PASSWORD");
  }
  return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
}
