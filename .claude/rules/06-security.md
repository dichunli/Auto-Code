# 安全开发规范

## 前端安全

- **禁止直接拼接用户输入到 URL 或 HTML**：防止 XSS 攻击。使用框架的转义机制（如 React 默认转义 JSX 内容），不要手动操作 `innerHTML`
- **敏感操作必须二次确认**：金额修改、批量删除、数据导出等操作必须弹出 `confirm()` 或专用确认弹窗，不能一触即发
- **权限校验双保险**：前端根据角色隐藏按钮/菜单，但后端 API 也必须做权限校验（RLS + 服务端校验），不能依赖前端隐藏

## 数据安全

- **禁止在客户端暴露敏感密钥**：Supabase service_role key、第三方 API 密钥等只能用在服务端（Server Action / API Route）
- **文件上传类型白名单**：图片（jpg/jpeg/png/webp/gif）、视频（mp4/webm/mov/3gp）、办公文档（doc/docx/xls/xlsx/ppt/pptx/pdf，供应商报价/资料用），禁止上传可执行文件
- **SQL 注入防护**：手写 SQL 时使用参数化查询（`$1, $2` 占位符），严禁字符串拼接 SQL
