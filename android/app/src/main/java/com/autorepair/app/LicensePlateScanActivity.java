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
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
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
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 原生车牌识别 Activity
 *
 * 使用 CameraX 拍照 + ML Kit Text Recognition 中文离线版识别文字，
 * 再用正则表达式匹配中国车牌格式。不依赖网络，完全离线运行。
 */
public class LicensePlateScanActivity extends AppCompatActivity {

    public static final String EXTRA_PLATE = "plate";
    public static final String EXTRA_ERROR = "error";
    public static final int REQUEST_CODE = 9002;

    private static final String TAG = "LicensePlateScan";
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1002;

    /* 中国车牌正则：支持普通车牌、新能源、军警、港澳等 */
    private static final Pattern PLATE_PATTERN = Pattern.compile(
        "[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼]"
        + "[A-Z]"
        + "[A-HJ-NP-Z0-9]{4,5}"
        + "[A-HJ-NP-Z0-9挂学警港澳]?"
    );

    private PreviewView previewView;
    private FrameLayout cameraContainer;
    private FrameLayout resultContainer;
    private ImageView resultImage;
    private ProgressBar recognizingProgress;
    private TextView resultText;
    private TextView errorText;
    private Button retakeButton;
    private Button confirmButton;
    private ImageButton closeButton;
    private ImageButton shutterButton;

    private ExecutorService cameraExecutor;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;
    private TextRecognizer textRecognizer;

    private boolean isFinished = false;
    private String recognizedPlate = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_license_plate_scan);

        previewView = findViewById(R.id.previewView);
        cameraContainer = findViewById(R.id.cameraContainer);
        resultContainer = findViewById(R.id.resultContainer);
        resultImage = findViewById(R.id.resultImage);
        recognizingProgress = findViewById(R.id.recognizingProgress);
        resultText = findViewById(R.id.resultText);
        errorText = findViewById(R.id.errorText);
        retakeButton = findViewById(R.id.retakeButton);
        confirmButton = findViewById(R.id.confirmButton);
        closeButton = findViewById(R.id.closeButton);
        shutterButton = findViewById(R.id.shutterButton);

        previewView.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);

        cameraExecutor = Executors.newSingleThreadExecutor();
        textRecognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());

        closeButton.setOnClickListener(v -> finishCancel());
        shutterButton.setOnClickListener(v -> takePhoto());
        retakeButton.setOnClickListener(v -> showCamera());
        confirmButton.setOnClickListener(v -> finishSuccess(recognizedPlate));

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
                Toast.makeText(this, "需要相机权限才能识别车牌", Toast.LENGTH_LONG).show();
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
                        Toast.makeText(LicensePlateScanActivity.this, "拍照失败", Toast.LENGTH_SHORT).show();
                        shutterButton.setEnabled(true);
                        shutterButton.setImageResource(R.drawable.ic_shutter);
                    });
                    return;
                }

                runOnUiThread(() -> showResult(bitmap));
                recognizePlate(bitmap);
            }

            @Override
            public void onError(@NonNull ImageCaptureException exception) {
                Log.e(TAG, "拍照失败", exception);
                runOnUiThread(() -> {
                    Toast.makeText(LicensePlateScanActivity.this, "拍照失败: " + exception.getMessage(), Toast.LENGTH_SHORT).show();
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
     * 使用 ML Kit 识别车牌
     */
    private void recognizePlate(Bitmap bitmap) {
        InputImage inputImage = InputImage.fromBitmap(bitmap, 0);

        textRecognizer.process(inputImage)
            .addOnSuccessListener(visionText -> {
                String plate = extractPlateNumber(visionText);
                runOnUiThread(() -> {
                    recognizingProgress.setVisibility(View.GONE);
                    if (plate != null) {
                        recognizedPlate = plate;
                        resultText.setText(plate);
                        resultText.setVisibility(View.VISIBLE);
                        errorText.setVisibility(View.GONE);
                        confirmButton.setVisibility(View.VISIBLE);
                    } else {
                        recognizedPlate = null;
                        resultText.setVisibility(View.GONE);
                        errorText.setText("未识别到车牌，请重试或手动输入");
                        errorText.setVisibility(View.VISIBLE);
                        confirmButton.setVisibility(View.GONE);
                    }
                });
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "文字识别失败", e);
                runOnUiThread(() -> {
                    recognizingProgress.setVisibility(View.GONE);
                    resultText.setVisibility(View.GONE);
                    errorText.setText("识别失败: " + e.getMessage());
                    errorText.setVisibility(View.VISIBLE);
                    confirmButton.setVisibility(View.GONE);
                });
            });
    }

    /**
     * 从 ML Kit 识别结果中提取车牌号
     */
    private String extractPlateNumber(Text visionText) {
        String bestMatch = null;
        int bestLength = 0;

        for (Text.TextBlock block : visionText.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String text = line.getText().trim().replaceAll("\\s+", "");
                Matcher matcher = PLATE_PATTERN.matcher(text);
                while (matcher.find()) {
                    String candidate = matcher.group();
                    /* 优先选择长度7~8位的，长度接近标准车牌的更好 */
                    int score = candidate.length();
                    if (score > bestLength) {
                        bestLength = score;
                        bestMatch = candidate;
                    }
                }
            }
        }

        return bestMatch;
    }

    private void showResult(Bitmap bitmap) {
        cameraContainer.setVisibility(View.GONE);
        resultContainer.setVisibility(View.VISIBLE);
        resultImage.setImageBitmap(bitmap);
        recognizingProgress.setVisibility(View.VISIBLE);
        resultText.setVisibility(View.GONE);
        errorText.setVisibility(View.GONE);
        confirmButton.setVisibility(View.GONE);
    }

    private void showCamera() {
        cameraContainer.setVisibility(View.VISIBLE);
        resultContainer.setVisibility(View.GONE);
        shutterButton.setEnabled(true);
        shutterButton.setImageResource(R.drawable.ic_shutter);
        recognizedPlate = null;
    }

    private void finishSuccess(String plate) {
        if (isFinished) return;
        isFinished = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_PLATE, plate);
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
        if (textRecognizer != null) {
            textRecognizer.close();
            textRecognizer = null;
        }
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
            cameraExecutor = null;
        }
    }
}
