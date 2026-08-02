# API 与数据交互规范

## Server Action 标准模式（核心写操作必须遵守）

涉及金额、库存、客户、工单等核心业务的**写操作必须走 Server Action**，禁止客户端直接 `supabase.from().insert/update/delete()`（避免客户端 session 异常导致 401/RLS 拦截）。统一模式：

1. 页面同级或模块根目录的 `actions.ts`，顶部 `"use server"`
2. 函数开头必须 `验证用户已登录()`（`@/lib/supabase/server`），未登录返回错误
3. 使用 `await createClient()`（`@/lib/supabase/server`）写库
4. **提交人/接待人/操作人等身份字段一律取服务端验证的 `user.id`，不接受客户端传入**
5. 库存数量类更新：必须在服务端读最新值再改，禁止用客户端列表里的旧数量
6. 写完后按需 `revalidatePath()` / `clearWorkOrderDataCache()`
7. 返回 `{ success: boolean; id?: string; error?: string }`，业务失败不抛异常

客户端侧配合：

- 保留必填校验、`alert()`、`loading` 状态和 `router.push/refresh`
- 调用 action 必须包 `try/catch` 兜底网络异常，出错 `alert()` 提示
- 只读查询（搜索联想、下拉加载）仍可走客户端

参考实现：`src/app/customers/actions.ts`、`src/app/work-orders/actions.ts`、`src/app/inventory/actions.ts`、`src/app/parts/actions.ts`

## 统一服务端响应格式

Server Action 和 API Route 返回的结构保持一致：

```typescript
{ success: boolean; data?: T; error?: string }
```

## 错误码约定

- 业务校验失败 → 返回 `{ success: false, error: "具体错误原因" }`，不抛异常
- 系统异常 → 记录日志后返回用户友好提示，不暴露堆栈信息

## 网络请求超时处理

Supabase 查询超过 10 秒需加 loading 提示，避免用户以为页面卡死。

## 乐观更新谨慎使用

涉及金额、库存的更新必须等待服务端确认后再更新 UI，不能用乐观更新。
