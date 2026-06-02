# APP 功能检查单

> 每次修改 APP 相关代码后，必须逐项检查，确认打勾才能交付。

## 一、环境检查（改代码前）

- [ ] 服务器已停止：`pm2 stop auto-repair-shop`
- [ ] `@capacitor/camera` 插件已安装
- [ ] `@capacitor/app` 插件已安装
- [ ] JAVA_HOME 已设置：`export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`

## 二、构建检查

- [ ] `npm run build` 无红色报错
- [ ] `npx cap sync` 成功（看到所有插件列表）
- [ ] `./gradlew clean assembleDebug` 成功
- [ ] APK 时间戳是最新的

## 三、功能验证（安装 APK 后）

### 登录
- [ ] 输入账号密码能正常登录
- [ ] 登录后跳转到手机工作台 `/m`
- [ ] 杀掉 APP 后台再打开，仍处于登录状态

### 车牌识别
- [ ] 点击"拍照识别"弹出系统相机
- [ ] 拍照后能正确识别车牌
- [ ] 从相册选择图片能识别
- [ ] 识别结果能回填到表单

### VIN 识别
- [ ] 点击"拍照识别"弹出系统相机
- [ ] 拍照后能正确识别 VIN
- [ ] 识别后自动查询车型信息

### 扫码添加配件
- [ ] 点击"扫码"能弹出拍照界面
- [ ] 拍照后能识别条码/二维码
- [ ] 手动输入条码也能正常添加

### 通用
- [ ] APP 不显示地址栏和浏览器导航按钮
- [ ] 页面切换流畅，无白屏

## 四、已知坑（已固化到代码注释中）

1. **不能用 WebView `getUserMedia()`** — Android WebView 在 HTTP 环境下拒绝访问摄像头，必须使用 `@capacitor/camera` 原生插件
2. **不能覆盖 WebChromeClient** — 覆盖会破坏 `<input type="file">` 的文件选择器
3. **不能用 `intent:` URL 打开设置** — `Capacitor.Plugins.App.openUrl` 不支持，必须用原生 JavaScript 接口
4. **Gradle 缓存** — 必须用 `./gradlew clean assembleDebug`，否则 APK 可能不是最新的
5. **改前端代码只需部署服务器**，不需要重新打包 APK（除非改了 Android 原生代码）

## 五、问题记录

| 日期 | 功能 | 问题 | 原因 | 解决 |
|------|------|------|------|------|
| 2026/6/2 | 车牌识别 | 无法访问摄像头 | WebView getUserMedia 在 HTTP 下不工作 | 改用 @capacitor/camera |
| 2026/6/2 | 相册 | 点不开 | MainActivity.java 覆盖了 WebChromeClient | 移除覆盖代码 |
| 2026/6/2 | 去设置按钮 | 点了没反应 | @capacitor/app 没安装 + openUrl 不支持 intent | 安装插件 + 改用原生 JS 接口 |
| 2026/6/2 | 扫码 | 不能用 | 原生扫码插件版本不兼容 Capacitor 8 | 改用拍照后识别 |

---

**下次修改 APP 功能时，先读这个检查单，改完逐项验证。**
