/* 测试 17VIN POST 请求，尝试不同的 token 算法 */
const crypto = require("crypto");

const USERNAME = "15846305858";
const PASSWORD = "yu7g65f4";

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function getToken(urlParameters) {
  return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
}

async function testPost(token) {
  const body = `action=vin_ocr&base64_urlencode_imagestring=test&user=${USERNAME}&token=${token}`;
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
  /* 测试不同的 url_parameters */
  const tests = [
    { name: "空字符串", urlParams: "" },
    { name: "只有/", urlParams: "/" },
    { name: "/?action=vin_ocr", urlParams: "/?action=vin_ocr" },
    { name: "/?action=vin_ocr&base64=test", urlParams: "/?action=vin_ocr&base64_urlencode_imagestring=test" },
    { name: "action=vin_ocr (无/无?)", urlParams: "action=vin_ocr" },
    { name: "action=vin_ocr&base64=test", urlParams: "action=vin_ocr&base64_urlencode_imagestring=test" },
  ];

  for (const t of tests) {
    const token = getToken(t.urlParams);
    console.log(`\n测试: ${t.name}`);
    console.log(`url_parameters: "${t.urlParams}"`);
    console.log(`token: ${token}`);
    const result = await testPost(token);
    console.log(`结果: code=${result.code}, msg=${result.msg || "OK"}`);
    if (result.code === 1) {
      console.log("✓✓✓ 成功! 这个算法是对的!");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

main();
