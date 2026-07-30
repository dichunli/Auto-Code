# API 与数据交互规范

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
