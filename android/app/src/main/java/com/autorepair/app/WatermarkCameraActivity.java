package com.autorepair.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.media.Image;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Size;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生水印相机
 * 拍照时直接在画面右下角合成时间水印，返回带水印的 JPEG Base64
 */
public class WatermarkCameraActivity extends AppCompatActivity {

  public static final String EXTRA_WATERMARK_TEXT = "watermark_text";
  public static final String EXTRA_IMAGE_BASE64 = "image_base64";
  public static final String EXTRA_ERROR = "error";
  public static final int REQUEST_CODE = 5001;
  private static final int REQUEST_CODE_CAMERA_PERMISSION = 5002;
  private static final String TAG = "WatermarkCamera";

  private PreviewView previewView;
  private TextView watermarkPreview;
  private Button captureButton;
  private View loadingView;

  private ImageCapture imageCapture;
  private ExecutorService cameraExecutor;
  private Handler timeHandler;
  private Runnable timeUpdater;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    FrameLayout root = new FrameLayout(this);
    root.setLayoutParams(new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT));

    /* 相机预览 */
    previewView = new PreviewView(this);
    previewView.setLayoutParams(new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT));
    previewView.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);
    root.addView(previewView);

    /* 右上角/右下角水印预览（让用户看到最终效果位置） */
    watermarkPreview = new TextView(this);
    FrameLayout.LayoutParams watermarkParams = new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.WRAP_CONTENT,
      FrameLayout.LayoutParams.WRAP_CONTENT);
    watermarkParams.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.END;
    watermarkParams.setMargins(24, 0, 24, 140);
    watermarkPreview.setLayoutParams(watermarkParams);
    watermarkPreview.setTextColor(0xFFFFFFFF);
    watermarkPreview.setTextSize(14);
    watermarkPreview.setPadding(16, 8, 16, 8);
    watermarkPreview.setBackgroundResource(android.R.drawable.dialog_holo_light_frame);
    watermarkPreview.setBackgroundColor(0x8C000000);
    root.addView(watermarkPreview);

    /* 拍照按钮 */
    captureButton = new Button(this);
    FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.WRAP_CONTENT,
      FrameLayout.LayoutParams.WRAP_CONTENT);
    btnParams.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL;
    btnParams.setMargins(0, 0, 0, 40);
    captureButton.setLayoutParams(btnParams);
    captureButton.setText("拍照");
    captureButton.setTextSize(16);
    captureButton.setPadding(48, 16, 48, 16);
    captureButton.setOnClickListener(v -> takePhoto());
    root.addView(captureButton);

    /* 加载遮罩 */
    loadingView = new View(this);
    loadingView.setLayoutParams(new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT));
    loadingView.setBackgroundColor(0xCC000000);
    loadingView.setVisibility(View.GONE);
    root.addView(loadingView);

    setContentView(root);

    cameraExecutor = Executors.newSingleThreadExecutor();
    timeHandler = new Handler(Looper.getMainLooper());

    /* 动态更新时间预览 */
    timeUpdater = new Runnable() {
      @Override
      public void run() {
        watermarkPreview.setText(getWatermarkText());
        timeHandler.postDelayed(this, 1000);
      }
    };
    timeHandler.post(timeUpdater);

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      startCamera();
    } else {
      ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQUEST_CODE_CAMERA_PERMISSION);
    }
  }

  private String getWatermarkText() {
    String custom = getIntent().getStringExtra(EXTRA_WATERMARK_TEXT);
    if (custom != null && !custom.isEmpty()) {
      return custom;
    }
    return new SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.CHINA).format(new Date());
  }

  private void startCamera() {
    ListenableFuture<ProcessCameraProvider> cameraProviderFuture = ProcessCameraProvider.getInstance(this);
    cameraProviderFuture.addListener(() -> {
      try {
        ProcessCameraProvider cameraProvider = cameraProviderFuture.get();

        Preview preview = new Preview.Builder()
          .setTargetResolution(new Size(1280, 720))
          .build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        imageCapture = new ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setTargetResolution(new Size(1280, 720))
          .build();

        CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

        cameraProvider.unbindAll();
        cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture);
      } catch (Exception e) {
        Log.e(TAG, "启动相机失败", e);
        finishWithError("启动相机失败: " + e.getMessage());
      }
    }, ContextCompat.getMainExecutor(this));
  }

  private void takePhoto() {
    if (imageCapture == null) return;

    captureButton.setEnabled(false);
    loadingView.setVisibility(View.VISIBLE);

    imageCapture.takePicture(ContextCompat.getMainExecutor(this), new ImageCapture.OnImageCapturedCallback() {
      @Override
      public void onCaptureSuccess(@NonNull ImageProxy imageProxy) {
        cameraExecutor.execute(() -> {
          try {
            Bitmap bitmap = imageProxyToBitmap(imageProxy);
            if (bitmap == null) {
              runOnUiThread(() -> finishWithError("图片转换失败"));
              return;
            }
            Bitmap watermarked = addWatermark(bitmap, getWatermarkText());
            String base64 = bitmapToBase64(watermarked);
            if (base64 == null) {
              runOnUiThread(() -> finishWithError("保存图片失败"));
              return;
            }
            runOnUiThread(() -> finishWithBase64(base64));
          } catch (Exception e) {
            Log.e(TAG, "处理水印失败", e);
            runOnUiThread(() -> finishWithError("处理水印失败: " + e.getMessage()));
          } finally {
            imageProxy.close();
          }
        });
      }

      @Override
      public void onError(@NonNull ImageCaptureException exception) {
        Log.e(TAG, "拍照失败", exception);
        finishWithError("拍照失败: " + exception.getMessage());
      }
    });
  }

  private Bitmap imageProxyToBitmap(ImageProxy imageProxy) {
    Image image = imageProxy.getImage();
    if (image == null) return null;

    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
    byte[] bytes = new byte[buffer.remaining()];
    buffer.get(bytes);

    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    if (bitmap == null) return null;

    /* 根据旋转角度转正 */
    int rotation = imageProxy.getImageInfo().getRotationDegrees();
    if (rotation != 0) {
      android.graphics.Matrix matrix = new android.graphics.Matrix();
      matrix.postRotate(rotation);
      Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
      bitmap.recycle();
      bitmap = rotated;
    }
    return bitmap;
  }

  private Bitmap addWatermark(Bitmap source, String text) {
    Bitmap result = source.copy(Bitmap.Config.ARGB_8888, true);
    Canvas canvas = new Canvas(result);

    int width = result.getWidth();
    int height = result.getHeight();
    int shortEdge = Math.min(width, height);

    float fontSize = Math.max(28, shortEdge / 25f);
    float horizontalPadding = Math.max(24, shortEdge / 50f);
    float verticalPadding = Math.max(16, shortEdge / 70f);
    float cornerRadius = Math.max(12, fontSize / 3f);

    Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    textPaint.setColor(0xFFFFFFFF);
    textPaint.setTextSize(fontSize);
    textPaint.setTextAlign(Paint.Align.LEFT);
    textPaint.setFakeBoldText(true);

    Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    bgPaint.setColor(0x8C000000);

    /* 测量文字尺寸 */
    Paint.FontMetrics fm = textPaint.getFontMetrics();
    float textWidth = textPaint.measureText(text);
    float textHeight = fm.descent - fm.ascent;
    float watermarkWidth = textWidth + horizontalPadding * 2;
    float watermarkHeight = textHeight + verticalPadding * 2;

    /* 右下角位置 */
    float left = width - watermarkWidth - horizontalPadding;
    float top = height - watermarkHeight - horizontalPadding;

    /* 绘制圆角背景 */
    RectF rect = new RectF(left, top, left + watermarkWidth, top + watermarkHeight);
    Path path = new Path();
    float r = Math.min(cornerRadius, watermarkHeight / 2f);
    path.moveTo(left + r, top);
    path.lineTo(left + watermarkWidth - r, top);
    path.quadTo(left + watermarkWidth, top, left + watermarkWidth, top + r);
    path.lineTo(left + watermarkWidth, top + watermarkHeight - r);
    path.quadTo(left + watermarkWidth, top + watermarkHeight, left + watermarkWidth - r, top + watermarkHeight);
    path.lineTo(left + r, top + watermarkHeight);
    path.quadTo(left, top + watermarkHeight, left, top + watermarkHeight - r);
    path.lineTo(left, top + r);
    path.quadTo(left, top, left + r, top);
    path.close();
    canvas.drawPath(path, bgPaint);

    /* 绘制文字（垂直居中） */
    float textX = left + horizontalPadding;
    float textY = top + watermarkHeight / 2f - (fm.ascent + fm.descent) / 2f;
    canvas.drawText(text, textX, textY, textPaint);

    return result;
  }

  private String bitmapToBase64(Bitmap bitmap) {
    try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
      bitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos);
      byte[] bytes = baos.toByteArray();
      return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
    } catch (Exception e) {
      Log.e(TAG, "图片转 base64 失败", e);
      return null;
    }
  }

  private void finishWithBase64(String base64) {
    Intent result = new Intent();
    result.putExtra(EXTRA_IMAGE_BASE64, base64);
    setResult(RESULT_OK, result);
    finish();
  }

  private void finishWithError(String error) {
    Intent result = new Intent();
    result.putExtra(EXTRA_ERROR, error);
    setResult(RESULT_CANCELED, result);
    finish();
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == REQUEST_CODE_CAMERA_PERMISSION) {
      if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
        startCamera();
      } else {
        Toast.makeText(this, "需要相机权限才能拍照", Toast.LENGTH_SHORT).show();
        finishWithError("需要相机权限");
      }
    }
  }

  @Override
  protected void onDestroy() {
    super.onDestroy();
    if (timeHandler != null && timeUpdater != null) {
      timeHandler.removeCallbacks(timeUpdater);
    }
    if (cameraExecutor != null) {
      cameraExecutor.shutdown();
    }
  }
}
