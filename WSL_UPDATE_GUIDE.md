# WSL2 更新指南（解决 Docker Desktop 启动失败）

## 问题现象

Docker Desktop 启动时提示：
> "WSL needs updating. Your version of Windows Subsystem for Linux (WSL) is too old."

## 检查结果

- WSL 已安装，但内核版本为 `5.10.16`（较旧）
- 未安装任何 Linux 发行版
- `wsl --version` 不支持（说明是旧版内置 WSL）

---

## 更新步骤

### 步骤一：以管理员身份打开 PowerShell

1. 按 `Win + S` 搜索 **PowerShell**
2. 右键点击 **Windows PowerShell** → **"以管理员身份运行"**
3. 在弹出的 UAC 窗口中点击 **"是"**

### 步骤二：执行 WSL 更新

在管理员 PowerShell 中粘贴执行：

```powershell
wsl --update
```

**预期结果：**
- 正常：显示下载进度，最后提示 `The operation completed successfully`
- 异常：如果提示 `wsl: --update` 不是有效参数，说明当前是旧版内置 WSL，跳转到**备用方案**

### 步骤三：重启电脑

WSL 内核更新后**必须重启**才能生效。

### 步骤四：验证更新结果

重启后，再次以管理员身份打开 PowerShell，执行：

```powershell
wsl --version
```

**成功标志：** 显示类似以下内容：

```
WSL version: 2.1.5.0
Kernel version: 5.15.150.1-2
WSLg version: 1.0.60
MSRDC version: 1.2.5105
Direct3D version: 1.611.1-81528511
DXCore version: 10.0.25131.1002-220531-1700.rs-onecore-base2-hyp
Windows version: 10.0.22621.xxxx
```

---

## 备用方案：离线安装 WSL2 内核

如果 `wsl --update` 命令无效或网络下载失败，使用离线安装包：

### 方法一：通过 MSI 安装包

1. 下载 WSL2 内核更新包：
   - 地址：https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi
   - 或直接在浏览器访问该地址下载

2. 双击运行下载的 `wsl_update_x64.msi`
3. 按向导完成安装
4. **重启电脑**

### 方法二：通过 Microsoft Store 安装

1. 打开 Microsoft Store
2. 搜索 **"Windows Subsystem for Linux"**
3. 点击安装（或更新）
4. **重启电脑**

### 方法三：通过 Winget 安装

在管理员 PowerShell 中执行：

```powershell
winget install --id Microsoft.WindowsSubsystemForLinux -e
```

安装完成后**重启电脑**。

---

## 验证 Docker Desktop

WSL 更新并重启后：

1. 启动 **Docker Desktop**
2. 等待左下角显示绿色 **"Engine running"**
3. 如果仍提示 WSL 问题，打开 Docker Desktop 设置 → Resources → WSL Integration，确保已启用

---

## 执行数据库迁移

Docker Desktop 正常运行后，在项目根目录执行：

```bash
node scripts/migrate-p0.js
```

或双击运行：

```
start-supabase-and-migrate-p0.bat
```

---

## 常见问题

### Q1: `wsl --update` 提示没有网络连接
**解决：** 使用备用方案的 MSI 离线安装包，手动下载后安装。

### Q2: 重启后 Docker 仍提示 WSL 错误
**解决：**
1. 确认 `wsl --version` 能正常输出版本号
2. 打开 Docker Desktop → Settings → Troubleshoot → Clean / Purge data
3. 或重置 Docker Desktop：Settings → Troubleshoot → Reset to factory defaults

### Q3: 需要安装 Linux 发行版吗？
**答：** Docker Desktop 自带 WSL2 backend，**不需要**额外安装 Ubuntu 等 Linux 发行版。只需要 WSL2 内核本身即可。

---

## 快速命令清单

```powershell
# 1. 检查 WSL 版本
wsl --version

# 2. 检查 WSL 状态
wsl --status

# 3. 更新 WSL
wsl --update

# 4. 查看已安装的发行版
wsl -l -v

# 5. 通过 Winget 安装/更新 WSL
winget install --id Microsoft.WindowsSubsystemForLinux -e
```

---

完成 WSL 更新并重启后，即可继续执行 `scripts/migrate-p0.js` 完成数据库迁移。
