"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { 批量生成全部文章向量 } from "@/app/knowledge/actions";

export default function EmbeddingsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ 已处理: number; 已跳过: number; error?: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function handleGenerate() {
    if (!confirm("将为所有没有向量的文章生成语义向量，可能需要几秒到几分钟。确定继续？")) return;

    setLoading(true);
    setResult(null);
    setLog(["开始生成..."]);

    const res = await 批量生成全部文章向量();
    setResult({ 已处理: res.已处理, 已跳过: res.已跳过, error: res.error });
    setLog((prev) => [
      ...prev,
      `完成！已处理 ${res.已处理} 篇，跳过 ${res.已跳过} 篇`,
      ...(res.error ? [res.error] : []),
    ]);
    setLoading(false);
  }

  return (
    <div>
      <PageHeader title="文章向量生成" description="为知识库文章批量生成语义搜索向量" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg space-y-6">
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
          <h3 className="text-sm font-medium text-amber-800 mb-1">当前状态</h3>
          <p className="text-sm text-amber-600">
            只有生成了向量的文章才能参与语义搜索。新建或编辑文章时会自动生成，旧文章需要手动批量生成。
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "生成中...（请勿关闭页面）" : "批量生成全部文章向量"}
        </button>

        {result && (
          <div className={`p-4 rounded-lg border ${result.已处理 > 0 ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}>
            <p className="text-sm font-medium">
              已处理 <span className="text-green-600">{result.已处理}</span> 篇，
              跳过 <span className="text-gray-500">{result.已跳过}</span> 篇
            </p>
            {result.error && <p className="text-xs text-gray-500 mt-1">{result.error}</p>}
          </div>
        )}

        {log.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 max-h-60 overflow-y-auto">
            <div className="text-xs text-gray-500 space-y-1">
              {log.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
