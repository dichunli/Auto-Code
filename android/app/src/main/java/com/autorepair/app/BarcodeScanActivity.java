package com.autorepair.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.Image;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.ImageButton;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import org.json.JSONArray;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生条码扫描 Activity
 *
 * 使用 CameraX 预览 + ML Kit Barcode Scanning 离线版识别。
 * 不依赖 Google Play 服务，适用于国内各类 Android 机型。
 */
public class BarcodeScanActivity extends AppCompatActivity {

    public static final String EXTRA_FORMATS = "formats";
    public static final String EXTRA_BARCODE = "barcode";
    public static final int REQUEST_CODE_SCAN = 9001;

    private static final String TAG = "BarcodeScan";
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;
    private static final int VOTE_THRESHOLD = 2;

    private PreviewView previewView;
    private ImageButton torchButton;
    private ImageButton switchCameraButton;
    private ImageButton closeButton;

    private ExecutorService cameraExecutor;
    private BarcodeScanner barcodeScanner;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

    private int[] barcodeFormats;
    private boolean isTorchEnabled = false;
    private boolean isProcessing = false;
    private boolean isFinished = false;
    private final Map<String, Integer> voteMap = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_barcode_scan);

        previewView = findViewById(R.id.previewView);
        torchButton = findViewById(R.id.torchButton);
        switchCameraButton = findViewById(R.id.switchCameraButton);
        closeButton = findViewById(R.id.closeButton);

        previewView.setImplementationMode(PreviewView.ImplementationMode.PERFORMANCE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);

        String formatsJson = getIntent().getStringExtra(EXTRA_FORMATS);
        barcodeFormats = parseFormats(formatsJson);

        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(barcodeFormats[0], barcodeFormats)
            .build();
        barcodeScanner = BarcodeScanning.getClient(options);
        cameraExecutor = Executors.newSingleThreadExecutor();

        closeButton.setOnClickListener(v -> finishCancel());
        torchButton.setOnClickListener(v -> toggleTorch());
        switchCameraButton.setOnClickListener(v -> switchCamera());

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
                Toast.makeText(this, "需要相机权限才能扫码", Toast.LENGTH_LONG).show();
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
                Toast.makeText(this, "相机启动失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
                finishCancel();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCamera() {
        if (cameraProvider == null) return;

        cameraProvider.unbindAll();

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        ImageAnalysis imageAnalysis = new ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();

        imageAnalysis.setAnalyzer(cameraExecutor, this::analyzeImage);

        try {
            camera = cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageAnalysis);
            updateTorchButton();
        } catch (Exception e) {
            Log.e(TAG, "绑定相机失败", e);
            Toast.makeText(this, "相机绑定失败", Toast.LENGTH_LONG).show();
            finishCancel();
        }
    }

    @OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void analyzeImage(@NonNull ImageProxy imageProxy) {
        if (isFinished || isProcessing) {
            imageProxy.close();
            return;
        }

        Image image = imageProxy.getImage();
        if (image == null) {
            imageProxy.close();
            return;
        }

        isProcessing = true;
        InputImage inputImage = InputImage.fromMediaImage(image, imageProxy.getImageInfo().getRotationDegrees());

        barcodeScanner.process(inputImage)
            .addOnSuccessListener(this::handleBarcodes)
            .addOnFailureListener(e -> {
                Log.w(TAG, "条码识别失败", e);
                isProcessing = false;
            })
            .addOnCompleteListener(task -> {
                imageProxy.close();
            });
    }

    private void handleBarcodes(List<Barcode> barcodes) {
        if (isFinished) {
            isProcessing = false;
            return;
        }

        for (Barcode barcode : barcodes) {
            String value = barcode.getRawValue();
            if (value == null || value.isEmpty()) continue;

            int votes = voteMap.getOrDefault(value, 0) + 1;
            voteMap.put(value, votes);

            if (votes >= VOTE_THRESHOLD) {
                finishSuccess(value);
                return;
            }
        }

        isProcessing = false;
    }

    private void toggleTorch() {
        if (camera == null) return;
        isTorchEnabled = !isTorchEnabled;
        camera.getCameraControl().enableTorch(isTorchEnabled);
        updateTorchButton();
    }

    private void updateTorchButton() {
        if (isTorchEnabled) {
            torchButton.setImageResource(R.drawable.ic_flashlight_on);
        } else {
            torchButton.setImageResource(R.drawable.ic_flashlight_off);
        }
    }

    private void switchCamera() {
        if (cameraProvider == null) return;

        int lensFacing = (cameraSelector == CameraSelector.DEFAULT_BACK_CAMERA)
            ? CameraSelector.LENS_FACING_FRONT
            : CameraSelector.LENS_FACING_BACK;

        cameraSelector = new CameraSelector.Builder().requireLensFacing(lensFacing).build();
        bindCamera();
    }

    private void finishSuccess(String barcode) {
        if (isFinished) return;
        isFinished = true;

        Intent data = new Intent();
        data.putExtra(EXTRA_BARCODE, barcode);
        setResult(RESULT_OK, data);
        finish();
    }

    private void finishCancel() {
        if (isFinished) return;
        isFinished = true;
        setResult(RESULT_CANCELED);
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
        if (barcodeScanner != null) {
            barcodeScanner.close();
            barcodeScanner = null;
        }
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
            cameraExecutor = null;
        }
    }

    private int[] parseFormats(String formatsJson) {
        List<Integer> formats = new ArrayList<>();
        formats.add(Barcode.FORMAT_ALL_FORMATS);

        if (formatsJson == null || formatsJson.isEmpty()) {
            return new int[]{Barcode.FORMAT_ALL_FORMATS};
        }

        try {
            JSONArray array = new JSONArray(formatsJson);
            formats.clear();
            for (int i = 0; i < array.length(); i++) {
                String name = array.optString(i);
                int format = mapFormatName(name);
                if (format != -1) {
                    formats.add(format);
                }
            }
        } catch (JSONException e) {
            Log.w(TAG, "条码格式解析失败，使用全部格式", e);
        }

        if (formats.isEmpty()) {
            formats.add(Barcode.FORMAT_ALL_FORMATS);
        }

        int[] result = new int[formats.size()];
        for (int i = 0; i < formats.size(); i++) {
            result[i] = formats.get(i);
        }
        return result;
    }

    private int mapFormatName(String name) {
        switch (name) {
            case "Code128": return Barcode.FORMAT_CODE_128;
            case "Code39": return Barcode.FORMAT_CODE_39;
            case "Ean13": return Barcode.FORMAT_EAN_13;
            case "Ean8": return Barcode.FORMAT_EAN_8;
            case "UpcA": return Barcode.FORMAT_UPC_A;
            case "UpcE": return Barcode.FORMAT_UPC_E;
            case "Itf": return Barcode.FORMAT_ITF;
            case "Codabar": return Barcode.FORMAT_CODABAR;
            case "QrCode": return Barcode.FORMAT_QR_CODE;
            default: return -1;
        }
    }
}
