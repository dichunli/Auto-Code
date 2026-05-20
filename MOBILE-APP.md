# 汽修管家 - Android APP 构建指南

本项目使用 Capacitor 将 H5 网页打包成 Android APP。

## 环境要求

1. **Node.js**（已有，用于运行 Next.js 服务）
2. **Android Studio**（需要安装）
   - 下载地址：https://developer.android.google.cn/studio
   - 安装时勾选：**Android SDK**、**Android SDK Platform**、**Android Virtual Device**
3. **JDK 17**（Android Studio 自带，或自行安装）

## 文件说明

- `capacitor.config.ts` — Capacitor 配置文件（服务器地址在这里修改）
- `android/` — Android 工程目录（用 Android Studio 打开这个目录）

## 配置服务器地址

APP 启动后会加载你的 H5 页面。默认配置加载局域网地址：

```ts
// capacitor.config.ts
server: {
  url: "http://192.168.1.75:3000",
  cleartext: true,
},
```

**修改方法**：
1. 打开 `capacitor.config.ts`
2. 修改 `server.url` 为你的实际地址：
   - 局域网测试：`http://192.168.1.75:3000`
   - 公网部署：`https://你的域名.com`
3. 保存后运行 `npx cap sync` 同步到 Android 工程

## 构建 APK（安装包）

### 步骤 1：确保 Next.js 服务在运行

```bash
npm run start
```

### 步骤 2：同步配置

```bash
npx cap sync
```

### 步骤 3：用 Android Studio 打开工程

1. 打开 **Android Studio**
2. 选择 **Open** → 找到本项目下的 `android` 文件夹 → 点击 **OK**
3. 等待 Gradle 同步完成（首次打开会自动下载依赖，需要几分钟）

### 步骤 4：构建 APK

**方式 A：直接安装到手机调试**
1. 用数据线连接 Android 手机
2. 手机开启 **开发者模式** 和 **USB 调试**
3. Android Studio 顶部工具栏选择你的手机设备
4. 点击绿色三角形按钮 **Run**（或按 Shift + F10）
5. APP 会自动安装到手机并打开

**方式 B：生成 APK 文件分发**
1. Android Studio 顶部菜单：**Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. 构建完成后右下角会提示 **"Build Analyzer detected..."**，点击 **locate** 或直接找到：
   `android/app/build/outputs/apk/debug/app-debug.apk`
3. 把这个 `app-debug.apk` 发给员工安装即可

### 步骤 5：正式发布（可选）

如需上传到应用商店，需要生成签名版 APK：
1. **Build** → **Generate Signed Bundle / APK...**
2. 选择 **APK**
3. 创建或选择密钥库（KeyStore）
4. 选择 **release** 版本构建

## APP 功能说明

- 打开 APP 后自动加载你的 H5 页面
- 按手机返回键时，优先返回网页上一页；如果已经在首页，则退出 APP
- 支持相机拍照（车牌识别、VIN 识别）
- 支持 HTTP 混合内容（17VIN API 等）

## 常见问题

### Q1：APP 打开后显示空白或无法连接？
- 确保 Next.js 服务已启动：`npm run start`
- 确保手机和电脑在同一 WiFi 下（如果用局域网地址）
- 检查 `capacitor.config.ts` 中的 `server.url` 是否正确

### Q2：拍照识别功能在 APP 里不能用？
- APP 第一次使用相机会弹出权限申请，请点击**允许**
- 如果拒绝过，需要去手机设置里手动开启相机权限

### Q3：如何更新 APP 内容？
- **H5 页面更新**：修改网页代码后重新部署，APP 不需要重新打包（因为加载的是远程 URL）
- **APP 原生功能更新**：需要重新构建 APK 并分发安装

### Q4：能否同时支持 iPhone？
- iOS 版本需要 Mac 电脑 + Xcode 才能构建
- 如有需要，可以运行 `npx cap add ios` 生成 iOS 工程
- 但现阶段 Android 版本足够覆盖大部分员工
