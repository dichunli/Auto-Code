export default function WorkOrderDetailLoading() {
  return (
    <div className="animate-pulse pb-20">
      {/* 顶部标签栏 */}
      <div className="h-9 w-full max-w-md bg-gray-200 rounded mb-4" />

      {/* 基本信息卡（车辆 + 客户） */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 w-40 bg-gray-200 rounded" />
          <div className="h-6 w-24 bg-gray-200 rounded" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      </div>

      <div className="flex gap-6 flex-col lg:flex-row">
        {/* 左侧：需求 + 项目区 */}
        <div className="flex-1 space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="h-6 w-48 bg-gray-200 rounded mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-16 bg-gray-100 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 右侧：侧边栏（待入库/预收款/费用汇总等） */}
        <div className="w-full lg:w-80 space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-32" />
          ))}
        </div>
      </div>

      {/* 底部费用条 */}
      <div className="fixed bottom-0 left-0 right-0 h-12 bg-white border-t border-gray-200" />
    </div>
  );
}
