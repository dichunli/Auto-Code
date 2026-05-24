package com.autorepair.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 使用 Chrome Custom Tabs 打开网页，绕过系统 WebView
        // 这样可以直接调用手机上 Edge/Chrome 浏览器的内核，JavaScript 完全兼容
        CustomTabsIntent intent = new CustomTabsIntent.Builder()
            .setShowTitle(false)
            .setToolbarColor(Color.parseColor("#2563eb"))
            .build();

        // 优先使用 Edge 浏览器
        intent.intent.setPackage("com.microsoft.emmx");

        try {
            intent.launchUrl(this, Uri.parse("http://192.168.1.75:3000"));
        } catch (Exception e) {
            // Edge 未安装，使用默认浏览器
            intent.intent.setPackage(null);
            intent.launchUrl(this, Uri.parse("http://192.168.1.75:3000"));
        }
    }
}
