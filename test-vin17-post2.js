/* 测试 17VIN POST 请求，带特殊字符的 base64 */
const crypto = require("crypto");

const USERNAME = "15846305858";
const PASSWORD = "yu7g65f4";

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function getToken(urlParameters) {
  return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
}

async function testPost(body) {
  try {
    const res = await fetch("http://api.17vin.com:8080/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  /* 模拟真实的 base64（包含 + / =） */
  const base64Original = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const base64Urlencode = encodeURIComponent(base64Original);

  console.log("原始 base64:", base64Original.substring(0, 30) + "...");
  console.log("URL编码后:", base64Urlencode.substring(0, 50) + "...");
  console.log("包含 +:", base64Original.includes("+"));
  console.log("包含 /:", base64Original.includes("/"));
  console.log("包含 =:", base64Original.includes("="));
  console.log("");

  /* 测试1: token 用 URL 编码后的值计算 */
  const token1 = getToken(`action=vin_ocr&base64_urlencode_imagestring=${base64Urlencode}`);
  const body1 = `action=vin_ocr&base64_urlencode_imagestring=${base64Urlencode}&user=${USERNAME}&token=${token1}`;
  console.log("测试1: token用URL编码后的值计算");
  console.log("token:", token1);
  const result1 = await testPost(body1);
  console.log("结果:", result1.code, result1.msg ? result1.msg.substring(0, 50) : "OK");
  console.log("");

  /* 测试2: token 用原始值（未编码）计算 */
  const token2 = getToken(`action=vin_ocr&base64_urlencode_imagestring=${base64Original}`);
  const body2 = `action=vin_ocr&base64_urlencode_imagestring=${base64Urlencode}&user=${USERNAME}&token=${token2}`;
  console.log("测试2: token用原始值（未编码）计算");
  console.log("token:", token2);
  const result2 = await testPost(body2);
  console.log("结果:", result2.code, result2.msg ? result2.msg.substring(0, 50) : "OK");
  console.log("");

  /* 测试3: token 用原始值计算，body也用原始值 */
  const token3 = getToken(`action=vin_ocr&base64_urlencode_imagestring=${base64Original}`);
  const body3 = `action=vin_ocr&base64_urlencode_imagestring=${base64Original}&user=${USERNAME}&token=${token3}`;
  console.log("测试3: token和body都用原始值");
  console.log("token:", token3);
  const result3 = await testPost(body3);
  console.log("结果:", result3.code, result3.msg ? result3.msg.substring(0, 50) : "OK");
}

main();
