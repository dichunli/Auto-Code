import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { PayrollClient, type 工资记录 } from "./PayrollClient";

export default async function PayrollPage() {
  const supabase = await createClient();

  const { data: records } = await supabase
    .from("payroll_records")
    .select("*, profiles(full_name, mechanic_levels(name))")
    .order("period_start", { ascending: false })
    .limit(200);

  const 列表 = (records ?? []) as unknown as 工资记录[];
  const totalBase = 列表.reduce((sum, r) => sum + (r.base_salary || 0), 0);
  const totalCommission = 列表.reduce((sum, r) => sum + (r.commission_total || 0), 0);
  const totalAmount = 列表.reduce((sum, r) => sum + (r.total_amount || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="工资提成" description="生成工资单：底薪按考勤自动折算，提成人工核对填写" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">基本工资合计</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalBase)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">提成合计</div>
          <div className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(totalCommission)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">实发合计</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalAmount)}</div>
        </div>
      </div>

      <PayrollClient 记录们={列表} />
    </div>
  );
}
