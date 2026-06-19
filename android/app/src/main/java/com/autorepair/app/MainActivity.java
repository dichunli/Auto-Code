package com.autorepair.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

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

  private static final int REQUEST_CODE_VIDEO_CAPTURE = 4001;
  private static final int REQUEST_CODE_CAMERA_PERMISSION = 4002;
  private static final int REQUEST_CODE_VIDEO_PICK = 4003;

  /* HTML5 video 全屏播放相关 */
  private View videoFullScreenView;
  private WebChromeClient.CustomViewCallback videoFullScreenCallback;

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

  /* 暴露给前端的 JavaScript 接口：启动原生条码扫描 */
  public class BarcodeScannerBridge {
    @android.webkit.JavascriptInterface
    public void startScan(String formatsJson) {
      Intent intent = new Intent(MainActivity.this, BarcodeScanActivity.class);
      intent.putExtra(BarcodeScanActivity.EXTRA_FORMATS, formatsJson);
      startActivityForResult(intent, BarcodeScanActivity.REQUEST_CODE_SCAN);
    }
  }

  /* 暴露给前端的 JavaScript 接口：启动原生车牌识别 */
  public class LicensePlateRecognizerBridge {
    @android.webkit.JavascriptInterface
    public void startRecognize() {
      Intent intent = new Intent(MainActivity.this, LicensePlateScanActivity.class);
      startActivityForResult(intent, LicensePlateScanActivity.REQUEST_CODE);
    }
  }

  /* 暴露给前端的 JavaScript 接口：启动 VIN 拍照 */
  public class VinCaptureBridge {
    @android.webkit.JavascriptInterface
    public void startCapture() {
      Intent intent = new Intent(MainActivity.this, VinCaptureActivity.class);
      startActivityForResult(intent, VinCaptureActivity.REQUEST_CODE);
    }
  }

  /* 暴露给前端的 JavaScript 接口：启动原生录像 */
  public class VideoCaptureBridge {
    @android.webkit.JavascriptInterface
    public void startCapture() {
      /* JavascriptInterface 方法不一定在 UI 线程，
         startActivityForResult 和 WebView 操作都必须在 UI 线程执行 */
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          try {
            /* 先检查并申请相机运行时权限（Android 6.0+ 需要） */
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
              ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.CAMERA}, REQUEST_CODE_CAMERA_PERMISSION);
              return;
            }

            Intent intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
            /* 先检查是否有应用能处理这个 Intent（防止某些手机没有系统相机） */
            if (intent.resolveActivity(getPackageManager()) == null) {
              injectVideoCaptureEvent(null, "当前设备没有可用的录像应用");
              return;
            }
            /* 限制录制时长 60 秒 */
            intent.putExtra(MediaStore.EXTRA_DURATION_LIMIT, 60);
            /* 限制视频质量（0=低质量，1=高质量） */
            intent.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);
            startActivityForResult(intent, REQUEST_CODE_VIDEO_CAPTURE);
          } catch (Exception e) {
            android.util.Log.e("MainActivity", "启动原生录像失败", e);
            injectVideoCaptureEvent(null, "启动录像失败: " + e.getMessage());
          }
        }
      });
    }
  }

  /* 暴露给前端的 JavaScript 接口：启动原生视频选择 */
  public class VideoPickerBridge {
    @android.webkit.JavascriptInterface
    public void startPick() {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          try {
            /*
             * 用 ACTION_GET_CONTENT 选视频：相册、文件管理器等都会响应它，
             * 兼容性比 ACTION_OPEN_DOCUMENT 好（小米/MIUI 等机型上后者常常
             * resolveActivity 返回 null，误报「没有可用应用」）。
             * 不再用 resolveActivity 预检查（Android 11+ 包可见性限制下不可靠），
             * 改为直接用 createChooser 启动，失败由 catch 兜底。
             */
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("video/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            Intent chooser = Intent.createChooser(intent, "选择视频");
            startActivityForResult(chooser, REQUEST_CODE_VIDEO_PICK);
          } catch (android.content.ActivityNotFoundException e) {
            injectVideoPickerEvent(null, "当前设备没有可用的视频选择应用");
          } catch (Exception e) {
            android.util.Log.e("MainActivity", "启动原生视频选择失败", e);
            injectVideoPickerEvent(null, "启动视频选择失败: " + e.getMessage());
          }
        }
      });
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
      bridge.getWebView().addJavascriptInterface(new BarcodeScannerBridge(), "AndroidBarcodeScanner");
      bridge.getWebView().addJavascriptInterface(new LicensePlateRecognizerBridge(), "AndroidLicensePlateRecognizer");
      bridge.getWebView().addJavascriptInterface(new VinCaptureBridge(), "AndroidVinCapture");
      bridge.getWebView().addJavascriptInterface(new VideoCaptureBridge(), "AndroidVideoCapture");
      bridge.getWebView().addJavascriptInterface(new VideoPickerBridge(), "AndroidVideoPicker");

      /* 调试用：在 WebView 中打印日志，并支持 HTML5 video 全屏播放 */
      bridge.getWebView().setWebChromeClient(new android.webkit.WebChromeClient() {
        @Override
        public boolean onConsoleMessage(android.webkit.ConsoleMessage consoleMessage) {
          android.util.Log.d("WebViewConsole", consoleMessage.message() +
            " -- From line " + consoleMessage.lineNumber() +
            " of " + consoleMessage.sourceId());
          return true;
        }

        @Override
        public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
          /* 已经有全屏视图时，先隐藏旧的 */
          if (videoFullScreenView != null) {
            onHideCustomView();
            return;
          }

          videoFullScreenView = view;
          videoFullScreenCallback = callback;

          /* 把全屏视图加到窗口根布局，隐藏 WebView */
          ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
          decorView.addView(videoFullScreenView, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));
          bridge.getWebView().setVisibility(View.GONE);

          /* 隐藏状态栏和导航栏，进入沉浸式全屏 */
          getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        @Override
        public void onHideCustomView() {
          if (videoFullScreenView == null) return;

          /* 恢复 WebView，移除全屏视图 */
          ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
          decorView.removeView(videoFullScreenView);
          bridge.getWebView().setVisibility(View.VISIBLE);

          videoFullScreenCallback.onCustomViewHidden();
          videoFullScreenView = null;
          videoFullScreenCallback = null;

          /* 恢复系统 UI */
          getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
      });
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    if (bridge == null || bridge.getWebView() == null) return;

    if (requestCode == BarcodeScanActivity.REQUEST_CODE_SCAN) {
      if (resultCode == RESULT_OK && data != null) {
        String barcode = data.getStringExtra(BarcodeScanActivity.EXTRA_BARCODE);
        injectBarcodeEvent(barcode);
      } else {
        /* 用户取消或扫描失败 */
        injectBarcodeEvent(null);
      }
    }

    if (requestCode == LicensePlateScanActivity.REQUEST_CODE) {
      if (resultCode == RESULT_OK && data != null) {
        String plate = data.getStringExtra(LicensePlateScanActivity.EXTRA_PLATE);
        injectLicensePlateEvent(plate, null);
      } else {
        String error = data != null ? data.getStringExtra(LicensePlateScanActivity.EXTRA_ERROR) : "cancelled";
        injectLicensePlateEvent(null, error);
      }
    }

    if (requestCode == VinCaptureActivity.REQUEST_CODE) {
      if (resultCode == RESULT_OK && data != null) {
        String base64Image = data.getStringExtra(VinCaptureActivity.EXTRA_IMAGE_BASE64);
        injectVinCaptureEvent(base64Image, null);
      } else {
        String error = data != null ? data.getStringExtra(VinCaptureActivity.EXTRA_ERROR) : "cancelled";
        injectVinCaptureEvent(null, error);
      }
    }

    if (requestCode == REQUEST_CODE_VIDEO_CAPTURE) {
      if (resultCode == RESULT_OK && data != null) {
        Uri videoUri = data.getData();
        if (videoUri != null) {
          String filePath = copyVideoToAppDir(videoUri);
          if (filePath != null) {
            injectVideoCaptureEvent(filePath, null);
          } else {
            injectVideoCaptureEvent(null, "复制视频文件失败");
          }
        } else {
          injectVideoCaptureEvent(null, "未能获取视频");
        }
      } else {
        injectVideoCaptureEvent(null, "cancelled");
      }
    }
    if (requestCode == REQUEST_CODE_VIDEO_PICK) {
      if (resultCode == RESULT_OK && data != null) {
        Uri videoUri = data.getData();
        if (videoUri != null) {
          String filePath = copyVideoToAppDir(videoUri);
          if (filePath != null) {
            injectVideoPickerEvent(filePath, null);
          } else {
            injectVideoPickerEvent(null, "复制视频文件失败");
          }
        } else {
          injectVideoPickerEvent(null, "未能获取视频");
        }
      } else {
        injectVideoPickerEvent(null, "cancelled");
      }
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);

    if (requestCode == REQUEST_CODE_CAMERA_PERMISSION) {
      if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
        /* 用户授权后，重新调用录像 */
        new VideoCaptureBridge().startCapture();
      } else {
        injectVideoCaptureEvent(null, "需要相机权限才能录像，请在设置中开启权限");
      }
    }
  }

  /* 将系统返回的视频 URI 复制到应用私有目录，返回绝对路径 */
  private String copyVideoToAppDir(Uri videoUri) {
    InputStream inputStream = null;
    FileOutputStream outputStream = null;
    try {
      inputStream = getContentResolver().openInputStream(videoUri);
      if (inputStream == null) return null;

      File videoDir = new File(getFilesDir(), "videos");
      if (!videoDir.exists()) {
        videoDir.mkdirs();
      }

      /* 根据原始 URI 的 MIME 类型确定正确扩展名，避免把 .3gp 强制重命名为 .mp4 */
      String ext = ".mp4";
      String mimeType = getContentResolver().getType(videoUri);
      if (mimeType != null) {
        String extFromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
        if (extFromMime != null && !extFromMime.isEmpty()) {
          ext = "." + extFromMime;
        }
      }
      /* 兜底：从原始文件名再猜一次扩展名 */
      if (".mp4".equals(ext)) {
        String displayName = getDisplayNameFromUri(videoUri);
        if (displayName != null) {
          int dotIndex = displayName.lastIndexOf(".");
          if (dotIndex > 0) {
            ext = displayName.substring(dotIndex);
          }
        }
      }

      String fileName = "video_" + System.currentTimeMillis() + ext;
      File outputFile = new File(videoDir, fileName);

      outputStream = new FileOutputStream(outputFile);
      byte[] buffer = new byte[8192];
      int bytesRead;
      while ((bytesRead = inputStream.read(buffer)) != -1) {
        outputStream.write(buffer, 0, bytesRead);
      }

      return outputFile.getAbsolutePath();
    } catch (Exception e) {
      android.util.Log.e("MainActivity", "复制视频文件失败", e);
      return null;
    } finally {
      try {
        if (outputStream != null) outputStream.close();
      } catch (Exception ignored) {}
      try {
        if (inputStream != null) inputStream.close();
      } catch (Exception ignored) {}
    }
  }

  /* 从 content URI 获取原始文件名 */
  private String getDisplayNameFromUri(Uri uri) {
    String result = null;
    if ("content".equals(uri.getScheme())) {
      Cursor cursor = null;
      try {
        cursor = getContentResolver().query(uri, null, null, null, null);
        if (cursor != null && cursor.moveToFirst()) {
          int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
          if (idx >= 0) {
            result = cursor.getString(idx);
          }
        }
      } catch (Exception e) {
        android.util.Log.e("MainActivity", "读取 URI 显示名称失败", e);
      } finally {
        if (cursor != null) cursor.close();
      }
    }
    if (result == null) {
      result = uri.getLastPathSegment();
    }
    return result;
  }

  /* 将视频选择结果通过自定义事件派发给前端 */
  private void injectVideoPickerEvent(String filePath, String error) {
    try {
      JSONObject detail = new JSONObject();
      if (filePath != null) {
        detail.put("filePath", filePath);
      } else if ("cancelled".equals(error)) {
        detail.put("cancelled", true);
      } else {
        detail.put("error", error != null ? error : "选择失败");
      }

      String js = "window.dispatchEvent(new CustomEvent('nativeVideoPickerResult', { detail: " + detail.toString() + " }));";
      bridge.getWebView().evaluateJavascript(js, null);
    } catch (JSONException e) {
      android.util.Log.e("MainActivity", "视频选择结果序列化失败", e);
    }
  }

  /* 将录像结果通过自定义事件派发给前端 */
  private void injectVideoCaptureEvent(String filePath, String error) {
    try {
      JSONObject detail = new JSONObject();
      if (filePath != null) {
        detail.put("filePath", filePath);
      } else if ("cancelled".equals(error)) {
        detail.put("cancelled", true);
      } else {
        detail.put("error", error != null ? error : "录像失败");
      }

      String js = "window.dispatchEvent(new CustomEvent('nativeVideoCaptureResult', { detail: " + detail.toString() + " }));";
      bridge.getWebView().evaluateJavascript(js, null);
    } catch (JSONException e) {
      android.util.Log.e("MainActivity", "录像结果序列化失败", e);
    }
  }

  /* 将扫码结果通过自定义事件派发给前端 */
  private void injectBarcodeEvent(String barcode) {
    try {
      JSONObject detail = new JSONObject();
      if (barcode != null) {
        detail.put("barcode", barcode);
      } else {
        detail.put("cancelled", true);
      }

      String js = "window.dispatchEvent(new CustomEvent('nativeBarcodeResult', { detail: " + detail.toString() + " }));";
      bridge.getWebView().evaluateJavascript(js, null);
    } catch (JSONException e) {
      android.util.Log.e("MainActivity", "条码结果序列化失败", e);
    }
  }

  /* 将车牌识别结果通过自定义事件派发给前端 */
  private void injectLicensePlateEvent(String plate, String error) {
    try {
      JSONObject detail = new JSONObject();
      if (plate != null) {
        detail.put("plate", plate);
      } else if ("cancelled".equals(error)) {
        detail.put("cancelled", true);
      } else {
        detail.put("error", error != null ? error : "识别失败");
      }

      String js = "window.dispatchEvent(new CustomEvent('nativeLicensePlateResult', { detail: " + detail.toString() + " }));";
      bridge.getWebView().evaluateJavascript(js, null);
    } catch (JSONException e) {
      android.util.Log.e("MainActivity", "车牌结果序列化失败", e);
    }
  }

  /* 将 VIN 拍照结果通过自定义事件派发给前端 */
  private void injectVinCaptureEvent(String base64Image, String error) {
    try {
      JSONObject detail = new JSONObject();
      if (base64Image != null) {
        detail.put("image", base64Image);
      } else if ("cancelled".equals(error)) {
        detail.put("cancelled", true);
      } else {
        detail.put("error", error != null ? error : "拍照失败");
      }

      String js = "window.dispatchEvent(new CustomEvent('nativeVinCaptureResult', { detail: " + detail.toString() + " }));";
      bridge.getWebView().evaluateJavascript(js, null);
    } catch (JSONException e) {
      android.util.Log.e("MainActivity", "VIN拍照结果序列化失败", e);
    }
  }
}
