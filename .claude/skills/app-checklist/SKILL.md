---
name: app-checklist
description: APP（Capacitor 安卓）改动后的防手滑检查单——环境、构建、功能验证、是否需要重打包 APK。改了 android/ 目录、Capacitor 插件、扫码/相机/视频上传相关代码后必用。
---

# APP 改动检查单技能

**背景**：APP 是远程服务器模式（APK 只是壳，加载 http://服务器:3000）。已踩过 9+ 个坑：Gradle 缓存、WebView 缓存、扫码插件版本、视频上传反复改前端白费（根因是 APK 缺原生桥接）等。

## 第 0 步：先判断要不要重新打包 APK（最重要！）

| 改动内容 | 需要重打包？ |
|---------|------------|
| 只改了 `src/` 下的前端代码（页面、组件、样式） | ❌ 不需要，部署服务器即可 |
| 改了 `android/` 目录下任何文件（MainActivity.java、插件桥接） | ✅ 必须重打包 |
| 新增/升级 Capacitor 插件（package.json 里 @capacitor/*） | ✅ 必须重打包 |
| 改了 `capacitor.config.ts` | ✅ 必须重打包 |

判断错方向的代价很大（视频上传那次反复改前端 5 次全白费）。**先把判断结论告诉用户再继续**。

## 第 1 步：环境检查（打包前）

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

- [ ] JAVA_HOME 指向 Android Studio 自带 JDK（系统 JDK 版本可能不对）
- [ ] 新插件已 `npm install` 且 `npx cap sync` 能看到插件列表

## 第 2 步：构建（需要打包时）

```bash
npm run build        # 1. 先构建前端
npx cap sync         # 2. 同步到安卓工程
cd android && ./gradlew.bat clean assembleDebug   # 3. 必须 clean！防 Gradle 缓存旧代码
```

- **必须加 `clean`**，否则 APK 可能打包进旧代码
- 构建成功后检查 APK 时间戳是最新的

## 第 3 步：必须告诉用户的信息（用户明确要求过）

```
📦 APK 完整路径：
C:\projects\auto-repair-shop\android\app\build\outputs\apk\debug\app-debug.apk

安装前必须先卸载手机上的旧版本（防缓存冲突）！
```

## 第 4 步：功能验证清单（用户装好后逐项确认）

参照项目根目录 `APP功能检查单.md`，按本次改动的功能勾选：

- [ ] 登录（登录后杀掉后台重开仍保持登录）
- [ ] 本次改动的具体功能
- [ ] 通用：无地址栏、页面切换无白屏

## 已知坑速查（改对应模块前先看）

1. **WebView 不能用 `getUserMedia()`** → 必须用 `@capacitor/camera` 原生插件
2. **不能覆盖 WebChromeClient** → 会破坏文件选择器
3. **不能用 `intent:` URL** → 用原生 JavaScript 接口
4. **WebView 缓存旧 HTML 引用旧 chunk** → 卸载旧 APP 再装
5. **file input 和 getUserMedia 在 APP 里都不可用** → 图片走 Capacitor 相机、视频走原生录像桥接
6. **改前端代码只需部署服务器**，别让用户白装 APK
