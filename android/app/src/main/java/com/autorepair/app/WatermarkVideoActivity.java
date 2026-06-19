package com.autorepair.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.media.MediaMetadataRetriever;
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
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.video.FileOutputOptions;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoCapture;
import androidx.camera.video.VideoRecordEvent;
import androidx.camera.video.Recorder;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生水印录像机
 * 用 CameraX 录制视频，录完后用 FFmpeg 在右下角叠加时间水印
 */
public class WatermarkVideoActivity extends AppCompatActivity {

  public static final String EXTRA_WATERMARK_TEXT = "watermark_text";
  public static final String EXTRA_VIDEO_PATH = "video_path";
  public static final String EXTRA_ERROR = "error";
  public static final int REQUEST_CODE = 6001;
  private static final int REQUEST_CODE_PERMISSIONS = 6002;
  private static final String TAG = "WatermarkVideo";

  private PreviewView previewView;
  private TextView watermarkPreview;
  private Button recordButton;
  private View loadingView;

  private VideoCapture<Recorder> videoCapture;
  private Recording activeRecording;
  private ExecutorService cameraExecutor;
  private Handler timeHandler;
  private Runnable timeUpdater;

  private boolean isRecording = false;
  private File recordingFile;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    FrameLayout root = new FrameLayout(this);
    root.setLayoutParams(new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT));

    previewView = new PreviewView(this);
    previewView.setLayoutParams(new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT));
    previewView.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);
    root.addView(previewView);

    /* 水印预览 */
    watermarkPreview = new TextView(this);
    FrameLayout.LayoutParams watermarkParams = new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.WRAP_CONTENT,
      FrameLayout.LayoutParams.WRAP_CONTENT);
    watermarkParams.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.END;
    watermarkParams.setMargins(24, 0, 24, 180);
    watermarkPreview.setLayoutParams(watermarkParams);
    watermarkPreview.setTextColor(0xFFFFFFFF);
    watermarkPreview.setTextSize(14);
    watermarkPreview.setPadding(16, 8, 16, 8);
    watermarkPreview.setBackgroundColor(0x8C000000);
    root.addView(watermarkPreview);

    /* 录制按钮 */
    recordButton = new Button(this);
    FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.WRAP_CONTENT,
      FrameLayout.LayoutParams.WRAP_CONTENT);
    btnParams.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL;
    btnParams.setMargins(0, 0, 0, 60);
    recordButton.setLayoutParams(btnParams);
    recordButton.setText("开始录制");
    recordButton.setTextSize(16);
    recordButton.setPadding(48, 16, 48, 16);
    recordButton.setOnClickListener(v -> toggleRecording());
    root.addView(recordButton);

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

    timeUpdater = new Runnable() {
      @Override
      public void run() {
        watermarkPreview.setText(getWatermarkText());
        timeHandler.postDelayed(this, 1000);
      }
    };
    timeHandler.post(timeUpdater);

    if (allPermissionsGranted()) {
      startCamera();
    } else {
      ActivityCompat.requestPermissions(this, getRequiredPermissions(), REQUEST_CODE_PERMISSIONS);
    }
  }

  private String getWatermarkText() {
    String custom = getIntent().getStringExtra(EXTRA_WATERMARK_TEXT);
    if (custom != null && !custom.isEmpty()) {
      return custom;
    }
    return new SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.CHINA).format(new Date());
  }

  private String[] getRequiredPermissions() {
    return new String[]{
      Manifest.permission.CAMERA,
      Manifest.permission.RECORD_AUDIO
    };
  }

  private boolean allPermissionsGranted() {
    for (String permission : getRequiredPermissions()) {
      if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
        return false;
      }
    }
    return true;
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

        Recorder recorder = new Recorder.Builder()
          .setExecutor(cameraExecutor)
          .build();
        videoCapture = VideoCapture.withOutput(recorder);

        CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

        cameraProvider.unbindAll();
        cameraProvider.bindToLifecycle(this, cameraSelector, preview, videoCapture);
      } catch (ExecutionException | InterruptedException e) {
        Log.e(TAG, "启动相机失败", e);
        finishWithError("启动相机失败: " + e.getMessage());
      }
    }, ContextCompat.getMainExecutor(this));
  }

  private void toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  private void startRecording() {
    if (videoCapture == null) return;

    File videoDir = new File(getFilesDir(), "videos");
    if (!videoDir.exists()) {
      videoDir.mkdirs();
    }
    recordingFile = new File(videoDir, "record_" + System.currentTimeMillis() + ".mp4");

    FileOutputOptions outputOptions = new FileOutputOptions.Builder(recordingFile).build();

    activeRecording = videoCapture.getOutput().prepareRecording(this, outputOptions)
      .withAudioEnabled()
      .start(ContextCompat.getMainExecutor(this), event -> {
        if (event instanceof VideoRecordEvent.Start) {
          isRecording = true;
          recordButton.setText("停止录制");
        } else if (event instanceof VideoRecordEvent.Finalize) {
          VideoRecordEvent.Finalize finalize = (VideoRecordEvent.Finalize) event;
          if (!finalize.hasError()) {
            addWatermarkToVideo(recordingFile.getAbsolutePath());
          } else {
            finishWithError("录制失败: " + finalize.getError());
          }
        }
      });
  }

  private void stopRecording() {
    if (activeRecording != null) {
      activeRecording.stop();
      activeRecording = null;
      isRecording = false;
      recordButton.setEnabled(false);
      loadingView.setVisibility(View.VISIBLE);
    }
  }

  private void addWatermarkToVideo(String inputPath) {
    cameraExecutor.execute(() -> {
      try {
        /* 获取视频分辨率 */
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        retriever.setDataSource(inputPath);
        String widthStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
        String heightStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
        retriever.release();

        int videoWidth = widthStr != null ? Integer.parseInt(widthStr) : 1280;
        int videoHeight = heightStr != null ? Integer.parseInt(heightStr) : 720;
        int shortEdge = Math.min(videoWidth, videoHeight);

        /* 生成水印图片 */
        int watermarkWidth = Math.max(200, shortEdge / 4);
        int watermarkHeight = Math.max(60, shortEdge / 14);
        Bitmap watermarkBitmap = createWatermarkBitmap(getWatermarkText(), watermarkWidth, watermarkHeight);
        File watermarkFile = new File(getCacheDir(), "video_watermark_" + System.currentTimeMillis() + ".png");
        saveBitmap(watermarkBitmap, watermarkFile);

        /* 输出文件 */
        File outputDir = new File(getFilesDir(), "watermark_videos");
        if (!outputDir.exists()) {
          outputDir.mkdirs();
        }
        File outputFile = new File(outputDir, "watermark_video_" + System.currentTimeMillis() + ".mp4");

        int margin = Math.max(20, shortEdge / 60);
        int x = videoWidth - watermarkWidth - margin;
        int y = videoHeight - watermarkHeight - margin;

        /* FFmpeg 叠加水印 */
        String filter = String.format(Locale.CHINA, "overlay=%d:%d", x, y);
        String[] cmd = {
          "-i", inputPath,
          "-i", watermarkFile.getAbsolutePath(),
          "-filter_complex", filter,
          "-c:a", "copy",
          "-movflags", "+faststart",
          "-y",
          outputFile.getAbsolutePath()
        };

        FFmpegSession session = FFmpegKit.executeWithArguments(cmd);
        if (ReturnCode.isSuccess(session.getReturnCode())) {
          /* 删除原始未加水印的视频 */
          new File(inputPath).delete();
          runOnUiThread(() -> finishWithPath(outputFile.getAbsolutePath()));
        } else {
          String error = session.getOutput() + "\n" + session.getLogsAsString();
          Log.e(TAG, "FFmpeg 加水印失败: " + error);
          runOnUiThread(() -> finishWithError("视频水印处理失败"));
        }
      } catch (Exception e) {
        Log.e(TAG, "处理视频水印失败", e);
        runOnUiThread(() -> finishWithError("处理视频水印失败: " + e.getMessage()));
      }
    });
  }

  private Bitmap createWatermarkBitmap(String text, int width, int height) {
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);

    float fontSize = Math.max(20, height * 0.4f);
    float horizontalPadding = width * 0.08f;
    float verticalPadding = height * 0.15f;
    float cornerRadius = height * 0.15f;

    Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    bgPaint.setColor(0x8C000000);

    Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    textPaint.setColor(0xFFFFFFFF);
    textPaint.setTextSize(fontSize);
    textPaint.setTextAlign(Paint.Align.LEFT);
    textPaint.setFakeBoldText(true);

    /* 圆角背景 */
    RectF rect = new RectF(0, 0, width, height);
    Path path = new Path();
    float r = Math.min(cornerRadius, height / 2f);
    path.moveTo(r, 0);
    path.lineTo(width - r, 0);
    path.quadTo(width, 0, width, r);
    path.lineTo(width, height - r);
    path.quadTo(width, height, width - r, height);
    path.lineTo(r, height);
    path.quadTo(0, height, 0, height - r);
    path.lineTo(0, r);
    path.quadTo(0, 0, r, 0);
    path.close();
    canvas.drawPath(path, bgPaint);

    /* 文字居中 */
    Paint.FontMetrics fm = textPaint.getFontMetrics();
    float textX = horizontalPadding;
    float textY = height / 2f - (fm.ascent + fm.descent) / 2f;
    canvas.drawText(text, textX, textY, textPaint);

    return bitmap;
  }

  private void saveBitmap(Bitmap bitmap, File file) throws Exception {
    try (FileOutputStream fos = new FileOutputStream(file)) {
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos);
    }
  }

  private void finishWithPath(String path) {
    Intent result = new Intent();
    result.putExtra(EXTRA_VIDEO_PATH, path);
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
    if (requestCode == REQUEST_CODE_PERMISSIONS) {
      if (allPermissionsGranted()) {
        startCamera();
      } else {
        Toast.makeText(this, "需要相机和麦克风权限才能录像", Toast.LENGTH_SHORT).show();
        finishWithError("权限被拒绝");
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
