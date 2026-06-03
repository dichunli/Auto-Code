package com.autorepair.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/*
 * ========== 原生层设计说明 ==========
 *
 * 【摄像头权限】Android WebView 的 getUserMedia() 在 HTTP 环境下会被拒绝，
 * 所以所有摄像头功能必须使用 Capacitor 原生插件（@capacitor/camera），
 * 不能依赖 WebView 的 JavaScript 摄像头 API。
 *
 * 【文件选择器】不要覆盖 Bridge 默认的 WebChromeClient，否则会破坏
 * <input type="file"> 的文件选择器功能。如需扩展，应通过插件机制实现。
 *
 * 【JavaScript 接口】暴露了 AndroidApp.openAppSettings() 供前端调用，
 * 用于跳转到应用权限设置页面。
 */
public class MainActivity extends BridgeActivity {

  /* 暴露给前端的 JavaScript 接口：打开应用设置页面 */
  public class AppSettingsInterface {
    @android.webkit.JavascriptInterface
    public void openAppSettings() {
      Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      Uri uri = Uri.fromParts("package", getPackageName(), null);
      intent.setData(uri);
      startActivity(intent);
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    /* 配置 WebView */
    if (bridge != null && bridge.getWebView() != null) {
      WebSettings settings = bridge.getWebView().getSettings();

      /* 显式启用 JavaScript（某些手机默认禁用） */
      settings.setJavaScriptEnabled(true);
      /* 启用 DOM 存储 */
      settings.setDomStorageEnabled(true);
      /* 启用数据库缓存 */
      settings.setDatabaseEnabled(true);
      /* 允许媒体自动播放 */
      settings.setMediaPlaybackRequiresUserGesture(false);
      /* 允许文件访问 */
      settings.setAllowFileAccess(true);

      /* 添加 JavaScript 接口 */
      bridge.getWebView().addJavascriptInterface(new AppSettingsInterface(), "AndroidApp");

      /* 调试用：在 WebView 中打印日志 */
      bridge.getWebView().setWebChromeClient(new android.webkit.WebChromeClient() {
        @Override
        public boolean onConsoleMessage(android.webkit.ConsoleMessage consoleMessage) {
          android.util.Log.d("WebViewConsole", consoleMessage.message() +
            " -- From line " + consoleMessage.lineNumber() +
            " of " + consoleMessage.sourceId());
          return true;
        }
      });
    }
  }
}
