# TypeScript 类型规范

- **严禁使用 `any` 类型**。所有数据必须定义具体接口：
  - Supabase 查询返回的数据 → 在文件顶部定义接口（如 `interface 配件分类 { id: string; name: string }`）
  - `useState` 数组状态 → 使用 `useState<配件分类[]>([])` 而非 `useState<any[]>([])`
  - `.map()` / `.filter()` 回调参数 → 使用具体类型而非 `(item: any)`
  - 错误捕获 → 使用 `catch (err: unknown)` + `err instanceof Error` 判断，严禁 `catch (err: any)`
- **禁止 `as any` 类型断言**。如必须断言，使用 `as 具体类型` 或 `as unknown as 目标类型`
- 工具函数中的泛型参数默认使用 `unknown` 而非 `any`（如 `function fn<T = unknown>()`）
