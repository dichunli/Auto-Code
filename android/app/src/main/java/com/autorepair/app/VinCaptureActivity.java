package com.autorepair.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.media.Image;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.widget.ImageButton;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * VIN 拍照 Activity
 *
 * 使用 CameraX 预览 + 拍照，支持手电筒控制。
 * 拍完照后压缩并转为 base64，通过 JSBridge 传回前端，
 * 由前端调用 17VIN OCR 接口完成识别。
 */
public class VinCaptureActivity extends AppCompatActivity {

    public static final String EXTRA_IMAGE_BASE64 = "image_base64";
    public static final String EXTRA_ERROR = "error";
    public static final int REQUEST_CODE = 9003;

    private static final String TAG = "VinCapture";
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1003;
    /* base64 大小上限：200KB 原始数据 ≈ 266KB base64 */
    private static final int MAX_IMAGE_SIZE_BYTES = 200 * 1024;

    private PreviewView previewView;
    private ImageButton closeButton;
    private ImageButton shutterButton;
    private ImageButton torchButton;

    private ExecutorService cameraExecutor;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;

    private boolean isTorchEnabled = false;
    private boolean isFinished = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_vin_capture);

        previewView = findViewById(R.id.previewView);
        closeButton = findViewById(R.id.closeButton);
        shutterButton = findViewById(R.id.shutterButton);
        torchButton = findViewById(R.id.torchButton);

        previewView.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);

        cameraExecutor = Executors.newSingleThreadExecutor();

        closeButton.setOnClickListener(v -> finishCancel());
        shutterButton.setOnClickListener(v -> takePhoto());
        torchButton.setOnClickListener(v -> toggleTorch());

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startCamera();
            } else {
                Toast.makeText(this, "需要相机权限才能拍照", Toast.LENGTH_LONG).show();
                finishCancel();
            }
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindCamera();
            } catch (Exception e) {
                Log.e(TAG, "相机启动失败", e);
                Toast.makeText(this, "相机启动失败", Toast.LENGTH_LONG).show();
                finishCancel();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCamera() {
        if (cameraProvider == null) return;
        cameraProvider.unbindAll();

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        imageCapture = new ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build();

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture);
    }

    private void toggleTorch() {
        if (camera == null) return;
        isTorchEnabled = !isTorchEnabled;
        camera.getCameraControl().enableTorch(isTorchEnabled);
        torchButton.setImageResource(isTorchEnabled ? R.drawable.ic_flashlight_on : R.drawable.ic_flashlight_off);
    }

    private void takePhoto() {
        if (imageCapture == null || isFinished) return;

        shutterButton.setEnabled(false);
        shutterButton.setImageResource(R.drawable.ic_shutter_active);

        imageCapture.takePicture(cameraExecutor, new ImageCapture.OnImageCapturedCallback() {
            @Override
            @OptIn(markerClass = ExperimentalGetImage.class)
            public void onCaptureSuccess(@NonNull ImageProxy imageProxy) {
                Bitmap bitmap = imageProxyToBitmap(imageProxy);
                imageProxy.close();

                if (bitmap == null) {
                    runOnUiThread(() -> {
                        Toast.makeText(VinCaptureActivity.this, "拍照失败", Toast.LENGTH_SHORT).show();
                        shutterButton.setEnabled(true);
                        shutterButton.setImageResource(R.drawable.ic_shutter);
                    });
                    return;
                }

                /* 压缩并转 base64 */
                String base64 = compressAndEncode(bitmap);
                if (base64 == null || base64.isEmpty()) {
                    runOnUiThread(() -> {
                        Toast.makeText(VinCaptureActivity.this, "图片处理失败", Toast.LENGTH_SHORT).show();
                        shutterButton.setEnabled(true);
                        shutterButton.setImageResource(R.drawable.ic_shutter);
                    });
                    return;
                }

                finishSuccess(base64);
            }

            @Override
            public void onError(@NonNull ImageCaptureException exception) {
                Log.e(TAG, "拍照失败", exception);
                runOnUiThread(() -> {
                    Toast.makeText(VinCaptureActivity.this, "拍照失败: " + exception.getMessage(), Toast.LENGTH_SHORT).show();
                    shutterButton.setEnabled(true);
                    shutterButton.setImageResource(R.drawable.ic_shutter);
                });
            }
        });
    }

    /**
     * 将 ImageProxy 转为 Bitmap
     */
    @OptIn(markerClass = ExperimentalGetImage.class)
    private Bitmap imageProxyToBitmap(ImageProxy imageProxy) {
        Image image = imageProxy.getImage();
        if (image == null) return null;

        int width = imageProxy.getWidth();
        int height = imageProxy.getHeight();

        if (image.getFormat() == ImageFormat.JPEG) {
            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.capacity()];
            buffer.get(bytes);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        }

        /* YUV_420_888 转 JPEG 再转 Bitmap */
        ByteBuffer yBuffer = image.getPlanes()[0].getBuffer();
        ByteBuffer uBuffer = image.getPlanes()[1].getBuffer();
        ByteBuffer vBuffer = image.getPlanes()[2].getBuffer();

        int ySize = yBuffer.remaining();
        int uSize = uBuffer.remaining();
        int vSize = vBuffer.remaining();

        byte[] nv21 = new byte[ySize + uSize + vSize];
        yBuffer.get(nv21, 0, ySize);
        vBuffer.get(nv21, ySize, vSize);
        uBuffer.get(nv21, ySize + vSize, uSize);

        YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        yuvImage.compressToJpeg(new Rect(0, 0, width, height), 90, out);
        byte[] jpegBytes = out.toByteArray();
        return BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.length);
    }

    /**
     * 压缩图片并转为 base64，控制大小在 200KB 以内
     */
    private String compressAndEncode(Bitmap original) {
        /* 第一步：缩放，最大边不超过 640（VIN码不需要高分辨率） */
        int maxDimension = Math.max(original.getWidth(), original.getHeight());
        Bitmap scaled = original;
        if (maxDimension > 640) {
            float scale = 640f / maxDimension;
            int newWidth = Math.round(original.getWidth() * scale);
            int newHeight = Math.round(original.getHeight() * scale);
            scaled = Bitmap.createScaledBitmap(original, newWidth, newHeight, true);
        }

        /* 第二步：JPEG 压缩，质量从 60 逐步降低直到大小符合要求 */
        int quality = 60;
        byte[] jpegBytes;
        while (quality >= 40) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, baos);
            jpegBytes = baos.toByteArray();
            if (jpegBytes.length <= MAX_IMAGE_SIZE_BYTES) {
                return Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
            }
            quality -= 10;
        }

        /* 最后尝试 30% 质量 */
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        scaled.compress(Bitmap.CompressFormat.JPEG, 30, baos);
        jpegBytes = baos.toByteArray();
        return Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
    }

    private void finishSuccess(String base64Image) {
        if (isFinished) return;
        isFinished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_IMAGE_BASE64, base64Image);
        setResult(RESULT_OK, data);
        finish();
    }

    private void finishCancel() {
        if (isFinished) return;
        isFinished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_ERROR, "cancelled");
        setResult(RESULT_CANCELED, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        isFinished = true;
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
            cameraProvider = null;
        }
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
            cameraExecutor = null;
        }
    }
}
