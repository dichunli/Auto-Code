---
name: create-pr
description: 规范提交并创建 Pull Request——建功能分支、中文提交信息、推送、开 PR。gh CLI token 失效时自动切换 git 凭据 + REST API 方案。用户说"提交"、"开 PR"、"推送"时使用。
---

# 提交 PR 技能

仓库：`dichunli/Auto-Code`。**禁止直接推 main。**

## 执行步骤

### 第 1 步：确认提交内容符合规范

```bash
git status --short
git diff --stat
```

- **一个提交只做一件事**：如果改动包含多个不相关的功能点，拆成多个提交或问用户怎么处理
- 不要把 `.bak` 备份文件、`settings.local.json`、临时测试文件提交进去

### 第 2 步：质量门禁（提交前必过）

```bash
npm run lint
npm run build
```

- lint 有 error 或 build 失败 → 修复后再提交，禁止带病提交

### 第 3 步：建分支 + 提交

- 分支命名：`feat/功能描述` 或 `fix/问题描述`（英文短横线）
- 提交信息中文，格式 `类型: 描述`，类型用 `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`
- 提交信息末尾不加任何 AI 署名（用户项目惯例，看历史 commit 格式）

### 第 4 步：推送 + 开 PR（gh 优先，失败自动绕行）

先尝试 gh：
```bash
git push -u origin <分支名>
gh pr create --title "标题" --body "描述"
```

**如果 gh 报 HTTP 400 或 token 失效**（已知坑：Windows 钥匙串里 token 会失效，但 git push 正常），自动切换 REST API 方案：

```bash
# 取 git 凭据里的 token
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | grep '^password=' | cut -d= -f2)

# 中文 body 必须写临时 JSON 文件再 -d @file 传（命令行直接拼中文会报 Problems parsing JSON）
cat > /tmp/pr-body.json << 'EOF'
{"title":"标题","body":"描述","head":"分支名","base":"main"}
EOF

curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/dichunli/Auto-Code/pulls -d @/tmp/pr-body.json
```

如果 REST API 也失败 → 告诉用户手动跑 `gh auth login` 重新登录（交互式，需要用户自己操作，可提示用 `! gh auth login` 在会话内执行）。

### 第 5 步：汇报

- PR 链接
- 提醒用户："PR 已建好，等你确认后我再合并"（**禁止未经用户同意自行合并 PR**）

## 红线

- 禁止直接推 main
- 禁止 lint/build 未通过就提交
- 禁止未经用户同意合并 PR
- 禁止把多个不相关改动塞进一个提交
