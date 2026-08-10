/* ═══ 写操作自动标记本机操作 ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化）
 *
 * 所有经过本客户端的写库操作（insert/update/upsert/delete/rpc）在调用时自动
 * 标记本机操作()。工单详情页的实时同步以此区分"自己改的"和"别人改的"：
 * 自己改的不再误弹"点击刷新"提示条，别人改的照常提示。
 * 只加副作用（打标记），不修改任何查询行为、参数和返回结果。 */
import { 标记本机操作 } from "@/lib/localEditSignal";

function 标记化查询构造器(builder: Record<string, unknown>): Record<string, unknown> {
  for (const 方法名 of ["insert", "update", "upsert", "delete"] as const) {
    const 原方法 = builder[方法名];
    if (typeof 原方法 === "function") {
      builder[方法名] = (...args: unknown[]) => {
        标记本机操作();
        return (原方法 as (...a: unknown[]) => unknown).apply(builder, args);
      };
    }
  }
  return builder;
}

/** 包装 supabase 客户端：from() 返回的写方法、rpc() 调用时自动标记本机操作。
 *  泛型无约束透传（T 进 T 出），保证真实 SupabaseClient 包装后类型不丢属性；
 *  方法不存在时（如测试 mock 的简化客户端）跳过包装，不报错。 */
export function 包装写操作标记<T extends object>(client: T): T {
  /* 结构化视图：from/rpc 能力逐个 typeof 判断，真实客户端与测试 mock 都兼容 */
  const c = client as { from?: (relation: string) => unknown; rpc?: (...args: unknown[]) => unknown };
  if (typeof c.from === "function") {
    const 原始from = c.from.bind(client);
    c.from = ((relation: string) =>
      标记化查询构造器(原始from(relation) as Record<string, unknown>)
    ) as typeof c.from;
  }

  if (typeof c.rpc === "function") {
    const 原始rpc = c.rpc.bind(client);
    c.rpc = ((...args: unknown[]) => {
      标记本机操作();
      return 原始rpc(...args);
    }) as typeof c.rpc;
  }

  return client;
}
