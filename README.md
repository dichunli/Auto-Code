# 汽修管家 - 汽车维修厂管理系统

基于 Next.js + Supabase 构建的汽车维修厂一体化管理软件。

## 功能模块

- **仪表盘**：运营数据概览、最近工单
- **工单管理**：接车、诊断、报价、维修、质检、结算、交车全生命周期
- **客户车辆**：车主档案、车辆信息、历史记录
- **配件库存**：库存管理、库存预警、出入库记录

## 技术栈

- **前端**：Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS
- **后端/数据库**：Supabase (PostgreSQL + Auth + Realtime)
- **部署**：Vercel / 自有服务器

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Supabase

1. 在 [Supabase](https://supabase.com) 创建新项目
2. 打开 SQL Editor，执行 `supabase/schema.sql` 文件中的全部 SQL
3. 在 Authentication -> Providers 中启用 Email 认证
4. 创建第一个用户（用于登录）
5. 复制项目 URL 和 Anon Key

### 3. 配置环境变量

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`，填入你的 Supabase 信息：

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000 ，使用在 Supabase 中创建的账号登录。

## 项目结构

```
├── src/
│   ├── app/              # Next.js App Router 页面
│   │   ├── page.tsx      # 仪表盘
│   │   ├── login/        # 登录页
│   │   ├── work-orders/  # 工单管理（列表、新建、详情）
│   │   ├── customers/    # 客户车辆
│   │   └── inventory/    # 配件库存
│   ├── components/       # 共享组件
│   └── lib/
│       ├── supabase/     # Supabase 客户端配置
│       └── utils.ts      # 工具函数
├── supabase/
│   └── schema.sql        # 数据库表结构
└── .env.local.example    # 环境变量模板
```

## 核心数据流

1. **新建工单**：客户 -> 车辆 -> 工单（一次表单完成三者创建）
2. **工单流转**：`已接车 -> 诊断中 -> 已报价 -> 维修中 -> 质检中 -> 已完成 -> 已结算 -> 已交车`
3. **库存扣减**：添加配件项目时自动扣减库存（后续可接入触发器）
4. **状态历史**：每次状态变更自动记录到 `work_order_history`

## 后续可扩展

- [ ] 员工角色权限细化（RLS 按角色过滤）
- [ ] 打印维修单 / 结算单（CSS `@media print`）
- [ ] 工单看板（Kanban 拖拽）
- [ ] 财务报表（日/月营收统计）
- [ ] 短信通知（接车/完工提醒）
- [ ] 供应商管理
