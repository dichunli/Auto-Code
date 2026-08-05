import { 获取询价单公开信息 } from "../actions";
import QuoteForm from "./QuoteForm";

/* 供应商报价页（免登录，凭链接 token 访问）
 * 首屏数据在服务端取：供应商打开链接直接看到内容，不用等加载 */

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const 结果 = await 获取询价单公开信息(token);

  if (!结果.success || !结果.data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">😕</div>
          <div className="text-base font-medium text-gray-900 mb-2">链接打不开</div>
          <div className="text-sm text-gray-500">{结果.error || "链接无效"}</div>
        </div>
      </div>
    );
  }

  return <QuoteForm token={token} 初始数据={结果.data} />;
}
