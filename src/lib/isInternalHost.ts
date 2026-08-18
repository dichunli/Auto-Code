/* 判断当前页面地址是否为内网/本机地址（2026-08-19 批次5A）
 * 用途：复制供应商询价链接时检测——内网地址（localhost/192.168.x/10.x/172.16-31.x）
 * 拼出的链接供应商手机打不开，需要提示改用公网域名打开系统再复制。 */
export function 是内网地址(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("10.")) return true;
  /* 172.16.0.0 ~ 172.31.255.255 */
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
