import { 查询调用记录, type 调用记录 } from "./actions";
import Vin17BillingContent from "./Vin17BillingContent";

/* 17VIN 账户管理 — Server Component
 * 首屏调用记录（第 1 页）在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 余额是外部 17VIN 接口，仍在客户端查询 */

export default async function Vin17BillingPage() {
  const result = await 查询调用记录(1, 20);

  const 首屏: {
    记录列表: 调用记录[];
    记录总数: number;
    错误: string | null;
  } = {
    记录列表: result.success && result.data ? result.data : [],
    记录总数: result.success ? result.total || 0 : 0,
    错误: result.success ? null : result.error || "查询失败",
  };

  return <Vin17BillingContent 首屏={首屏} />;
}
