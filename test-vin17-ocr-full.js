/* 完整模拟 vin17PostRequest 逻辑测试 */
const crypto = require("crypto");

const USERNAME = process.env.VIN17_USERNAME || "15846305858";
const PASSWORD = process.env.VIN17_PASSWORD || "";

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function getToken(urlParameters) {
  return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
}

async function vin17PostRequest(params) {
  const rawQuery = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const urlParameters = "/?" + rawQuery;
  const token = getToken(urlParameters);

  console.log("urlParameters:", urlParameters);
  console.log("token:", token);

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.append(k, v);
  }
  body.append("user", USERNAME);
  body.append("token", token);

  console.log("POST body:", body.toString().slice(0, 200) + "...");

  const res = await fetch("http://api.17vin.com:8080/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  console.log("响应状态:", res.status);
  const text = await res.text();
  console.log("响应内容:", text.slice(0, 500));
  try {
    return JSON.parse(text);
  } catch {
    return { error: "非JSON响应", text: text.slice(0, 200) };
  }
}

async function main() {
  if (!PASSWORD) {
    console.log("错误: 缺少环境变量 VIN17_PASSWORD");
    return;
  }
  console.log("USERNAME:", USERNAME);
  console.log("MD5(USERNAME):", md5(USERNAME));
  console.log("MD5(PASSWORD):", md5(PASSWORD));
  console.log("");

  /* 模拟 VinCameraModal 传入的 base64（假数据） */
  const fakeBase64Body = "/9j/4AAQSkZJRgABAQAAAQ==";
  const base64Urlencode = encodeURIComponent(fakeBase64Body);
  console.log("原始base64:", fakeBase64Body);
  console.log("encodeURIComponent后:", base64Urlencode);
  console.log("");

  const result = await vin17PostRequest({
    action: "vin_ocr",
    base64_urlencode_imagestring: base64Urlencode,
  });
  console.log("\n最终结果:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
