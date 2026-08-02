/*
 * 存储桶类型白名单（2026-08-02 安全诊断结果，经用户确认：不限大小，只限类型）
 * 5 个媒体桶只允许上传图片（jpg/png/webp）和视频（mp4），防止上传可执行文件
 * file_size_limit 保持 NULL（不限制大小）
 */
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','video/mp4']
WHERE name IN ('work-order-media','training-media','behavior-media','customer-media','vehicle-media');
