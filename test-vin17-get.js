/* 测试 17VIN GET 请求是否正常工作 */
const USERNAME = "15846305858";
const PASSWORD = "yu7g65f4";

async function test() {
  const crypto = await import("crypto");
  function md5(s) {
    return crypto.createHash("md5").update(s).digest("hex");
  }
  function getToken(urlParameters) {
    return md5(md5(USERNAME) + md5(PASSWORD) + urlParameters);
  }

  /* 测试 GET 请求: vin17DecodeVin */
  const vin = "LSVAG2180E2104477"; /* 一个测试 VIN */
  const urlParameters = "/?vin=" + vin;
  const token = getToken(urlParameters);

  console.log("GET 请求测试:");
  console.log("urlParameters:", urlParameters);
  console.log("token:", token);

  const fullUrl = `http://api.17vin.com:8080/?vin=${encodeURIComponent(vin)}&user=${encodeURIComponent(USERNAME)}&token=${token}`;
  console.log("fullUrl:", fullUrl);

  try {
    const res = await fetch(fullUrl, { headers: { Accept: "application/json" } });
    const data = await res.json();
    console.log("响应:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.log("请求失败:", err.message);
  }
}

test();
