package com.autorepair.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 扫码取景框自定义 View
 *
 * 绘制内容：
 * 1. 全屏半透明黑色遮罩
 * 2. 中央透明扫描框区域
 * 3. 扫描框四角绿色边框
 * 4. 扫描线上下移动动画
 */
public class ScanOverlayView extends View {

    /* 扫描框尺寸（dp） — 正方形，兼顾一维码和二维码 */
    private static final float SCAN_BOX_WIDTH_DP = 260f;
    private static final float SCAN_BOX_HEIGHT_DP = 260f;
    private static final float CORNER_LENGTH_DP = 24f;
    private static final float CORNER_STROKE_DP = 3f;
    private static final float SCAN_LINE_HEIGHT_DP = 2f;

    /* 绘制工具 */
    private final Paint maskPaint;
    private final Paint cornerPaint;
    private final Paint scanLinePaint;
    private final Paint clearPaint;

    /* 扫描框位置 */
    private final RectF scanBoxRect = new RectF();
    private float scanLineY = 0f;
    private ValueAnimator scanAnimator;

    public ScanOverlayView(Context context) {
        this(context, null);
    }

    public ScanOverlayView(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public ScanOverlayView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);

        /* 关闭硬件加速，支持 PorterDuff CLEAR 模式挖空扫描框 */
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);

        maskPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        maskPaint.setColor(Color.parseColor("#B3000000"));

        cornerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        cornerPaint.setColor(Color.parseColor("#4ADE80"));
        cornerPaint.setStyle(Paint.Style.STROKE);
        cornerPaint.setStrokeWidth(dpToPx(CORNER_STROKE_DP));
        cornerPaint.setStrokeCap(Paint.Cap.ROUND);

        scanLinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        scanLinePaint.setColor(Color.parseColor("#4ADE80"));
        scanLinePaint.setStyle(Paint.Style.FILL);

        clearPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        clearPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        super.onSizeChanged(w, h, oldW, oldH);

        float boxWidth = dpToPx(SCAN_BOX_WIDTH_DP);
        float boxHeight = dpToPx(SCAN_BOX_HEIGHT_DP);
        float left = (w - boxWidth) / 2f;
        float top = (h - boxHeight) / 2f; // 屏幕正中
        float right = left + boxWidth;
        float bottom = top + boxHeight;

        scanBoxRect.set(left, top, right, bottom);

        startScanLineAnimation();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        int width = getWidth();
        int height = getHeight();
        if (width == 0 || height == 0) return;

        /* 1. 先画全屏半透明遮罩 */
        canvas.drawRect(0, 0, width, height, maskPaint);

        /* 2. 在中间挖出一个透明矩形扫描框 */
        canvas.drawRoundRect(scanBoxRect, dpToPx(8f), dpToPx(8f), clearPaint);

        /* 3. 绘制四角边框 */
        drawCorners(canvas);

        /* 4. 绘制扫描线 */
        drawScanLine(canvas);
    }

    private void drawCorners(Canvas canvas) {
        float length = dpToPx(CORNER_LENGTH_DP);
        float stroke = dpToPx(CORNER_STROKE_DP);
        float offset = stroke / 2f;

        float left = scanBoxRect.left + offset;
        float top = scanBoxRect.top + offset;
        float right = scanBoxRect.right - offset;
        float bottom = scanBoxRect.bottom - offset;

        Path path = new Path();

        /* 左上角 */
        path.moveTo(left + length, top);
        path.lineTo(left, top);
        path.lineTo(left, top + length);

        /* 右上角 */
        path.moveTo(right - length, top);
        path.lineTo(right, top);
        path.lineTo(right, top + length);

        /* 左下角 */
        path.moveTo(left + length, bottom);
        path.lineTo(left, bottom);
        path.lineTo(left, bottom - length);

        /* 右下角 */
        path.moveTo(right - length, bottom);
        path.lineTo(right, bottom);
        path.lineTo(right, bottom - length);

        canvas.drawPath(path, cornerPaint);
    }

    private void drawScanLine(Canvas canvas) {
        if (scanLineY <= scanBoxRect.top || scanLineY >= scanBoxRect.bottom) return;

        float lineHeight = dpToPx(SCAN_LINE_HEIGHT_DP);
        float left = scanBoxRect.left + dpToPx(4f);
        float right = scanBoxRect.right - dpToPx(4f);

        canvas.drawRect(left, scanLineY - lineHeight / 2f, right, scanLineY + lineHeight / 2f, scanLinePaint);
    }

    private void startScanLineAnimation() {
        if (scanAnimator != null) {
            scanAnimator.cancel();
        }

        scanAnimator = ValueAnimator.ofFloat(scanBoxRect.top, scanBoxRect.bottom);
        scanAnimator.setDuration(2000);
        scanAnimator.setInterpolator(new LinearInterpolator());
        scanAnimator.setRepeatCount(ValueAnimator.INFINITE);
        scanAnimator.setRepeatMode(ValueAnimator.RESTART);
        scanAnimator.addUpdateListener(animation -> {
            scanLineY = (float) animation.getAnimatedValue();
            invalidate();
        });
        scanAnimator.start();
    }

    private float dpToPx(float dp) {
        return dp * getContext().getResources().getDisplayMetrics().density;
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (scanAnimator != null) {
            scanAnimator.cancel();
            scanAnimator = null;
        }
    }
}
