/* 临时测试脚本：验证 17VIN POST 请求的 token 计算 */
const crypto = require("crypto");

const USERNAME = "15846305858";
const PASSWORD = "yu7g65f4";

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function getToken(urlParameters) {
  return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
}

console.log("USERNAME:", USERNAME);
console.log("MD5(USERNAME):", md5(USERNAME));
console.log("MD5(PASSWORD):", md5(PASSWORD));
console.log("");

/* 新算法：POST 请求用 / */
const newToken = getToken("/");
console.log("新算法 token (url_parameters='/'):", newToken);

/* 旧算法：POST 请求用 body 参数 */
const oldTokenParams = "action=vin_ocr&base64_urlencode_imagestring=xxx";
const oldToken = getToken(oldTokenParams);
console.log("旧算法 token (url_parameters='" + oldTokenParams + "'):", oldToken);

/* 截图中 17VIN 返回的 token */
console.log("");
console.log("截图中 17VIN 返回的 token:", "448e78dc49d777ba3d83e2f453dca6fa");
console.log("截图中 17VIN 说 url_parameters = '/'");
console.log("");
console.log("如果新算法正确，新算法的 token 应该等于截图中的 token");
console.log("匹配?", newToken === "448e78dc49d777ba3d83e2f453dca6fa" ? "✓ 匹配!" : "✗ 不匹配");
console.log("旧算法匹配?", oldToken === "448e78dc49d777ba3d83e2f453dca6fa" ? "✓ 匹配!" : "✗ 不匹配");
