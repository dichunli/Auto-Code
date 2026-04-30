# 本地部署指南（内网使用）

本项目使用 **Supabase CLI + Docker Desktop** 实现完全本地化的数据库、认证、文件存储服务。

## 前置要求

- Windows 10/11 或 macOS 或 Linux
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 已安装并运行
- Node.js 18+ 和 npm

## 1. 安装 Supabase CLI

```bash
# 通过 npm 安装
npm install -g supabase

# 验证安装
supabase --version
```

> Windows 用户如果 npm 安装失败，也可直接下载 exe：
> https://github.com/supabase/cli/releases

## 2. 初始化并启动本地 Supabase

在项目根目录执行：

```bash
# 首次初始化（会生成 supabase/config.toml）
supabase init

# 启动本地服务（PostgreSQL + Auth + Storage + PostgREST + Realtime + Studio）
supabase start
```

启动成功后，你会看到类似输出：

```
Started supabase local development setup.

         API URL: http://localhost:54321
          DB URL: postgresql://postgres:postgres@localhost:54322/postgres
      Studio URL: http://localhost:54323
    Inbucket URL: http://localhost:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIs...
```

## 3. 创建数据库表

打开 **Supabase Studio**（http://localhost:54323）：
1. 点击左侧 SQL Editor
2. 新建 Query
3. 将 `supabase/schema.sql` 全部内容粘贴进去
4. 点击 Run

## 4. 配置环境变量

```bash
cp .env.local.example .env.local
```

本地启动时 `.env.local.example` 中的默认值已可用，无需修改。

## 5. 创建首个登录用户

在 Supabase Studio 中：
1. 左侧 Authentication → Users
2. 点击 New user
3. 输入邮箱和密码（如 `admin@example.com` / `123456`）
4. 创建后，在 `profiles` 表中插入对应记录并分配角色：

```sql
INSERT INTO profiles (id, full_name, phone)
SELECT id, '管理员', '13800138000'
FROM auth.users
WHERE email = 'admin@example.com';

INSERT INTO profile_roles (profile_id, role_id)
SELECT p.id, r.id
FROM profiles p, roles r
WHERE p.full_name = '管理员' AND r.name = 'admin';
```

## 6. 启动前端

```bash
npm run dev
```

访问 http://localhost:3000 ，用刚创建的账号登录。

## 常用命令

```bash
# 查看本地服务状态
supabase status

# 停止服务
supabase stop

# 重置数据库（清空数据）
supabase db reset

# 查看实时日志
supabase logs -f

# 备份数据库
supabase db dump -f backup.sql
```

## 网络配置（内网多台电脑访问）

如果希望修理厂其他电脑通过局域网访问：

1. 确保主机防火墙允许 Docker 端口（54321, 3000）
2. 查看本机内网 IP：`ipconfig`（如 `192.168.1.100`）
3. 其他电脑访问：
   - 管理系统：http://192.168.1.100:3000
   - Supabase Studio：http://192.168.1.100:54323

4. 修改 `.env.local` 中的 `NEXT_PUBLIC_SUPABASE_URL` 为内网 IP：
```
NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.100:54321
```

## 迁移到云端（后期）

运行成熟后如需上云：
1. 在 [Supabase](https://supabase.com) 创建云端项目
2. 使用 `supabase db dump` 导出本地数据
3. 在云端 SQL Editor 导入
4. 修改 `.env.local` 为云端 URL 和 Key
5. 重新部署 Next.js 到 Vercel 或自有服务器
