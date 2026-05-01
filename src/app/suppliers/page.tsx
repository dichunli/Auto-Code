import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function SuppliersPage() {
  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*, parts(count)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="供应商管理"
        description="管理配件采购供应商"
        action={{ href: "/suppliers/new", label: "新增供应商" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">联系人</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">地址</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件数</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliers?.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{s.name}</td>
                  <td className="px-6 py-4 text-gray-600">{s.contact || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{s.phone || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{s.address || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{s.parts?.[0]?.count || 0}</td>
                  <td className="px-6 py-4 text-gray-500">{s.notes || "-"}</td>
                </tr>
              ))}
              {(!suppliers || suppliers.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无供应商数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
