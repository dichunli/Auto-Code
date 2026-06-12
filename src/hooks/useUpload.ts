"use client";

import { useState, useRef, useCallback } from "react";
import { compressImage } from "@/lib/imageCompress";

/* ======================== 类型定义 ======================== */

export interface 上传选项 {
  /* 媒体类型 */
  mediaType?: "image" | "video" | "auto";
  /* 图片压缩目标大小（KB），默认 300 */
  compressMaxKB?: number;
  /* 视频最大时长（秒），默认 60 */
  maxDurationSeconds?: number;
  /* 文件大小上限（MB），默认 100 */
  maxFileSizeMB?: number;
  /* 上传超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /* 可选子文件夹（如 "training"） */
  folder?: string;
  /* 上传进度回调（0-100） */
  onProgress?: (percent: number) => void;
  /* 上传完成回调 */
  onSuccess?: (paths: string[]) => void;
}

export interface 上传结果 {
  urls: string[];
  errors: { file: string; error: string }[];
}

export interface UseUploadReturn {
  上传: (files: FileList | File[]) => Promise<上传结果>;
  上传中: boolean;
  进度: number;
  总进度: string;
  错误: string;
  取消: () => void;
  删除文件: (path: string) => Promise<boolean>;
}

/* 校验函数返回值 */
interface 校验结果 {
  valid: boolean;
  error?: string;
}

/* ======================== Hook 实现 ======================== */

export function useUpload(选项: 上传选项 = {}): UseUploadReturn {
  const {
    mediaType = "auto",
    compressMaxKB = 300,
    maxDurationSeconds = 60,
    maxFileSizeMB = 100,
    timeoutMs = 30000,
    folder,
    onProgress,
    onSuccess,
  } = 选项;

  const [上传中, set上传中] = useState(false);
  const [进度, set进度] = useState(0);
  const [总进度, set总进度] = useState("");
  const [错误, set错误] = useState("");

  const 取消控制器 = useRef<AbortController | null>(null);

  /* 取消当前上传 */
  const 取消 = useCallback(() => {
    if (取消控制器.current) {
      取消控制器.current.abort();
      取消控制器.current = null;
    }
  }, []);

  /* 判断文件是否为图片 */
  function 是否为图片(file: File): boolean {
    return file.type.startsWith("image/");
  }

  /* 判断文件是否为视频 */
  function 是否为视频(file: File): boolean {
    return file.type.startsWith("video/");
  }

  /* 校验单个文件 */
  async function 校验文件(file: File): Promise<校验结果> {
    const 类型 = mediaType;

    /* 根据 mediaType 校验类型 */
    if (类型 === "image" && !是否为图片(file)) {
      return { valid: false, error: `${file.name} 不是图片文件` };
    }
    if (类型 === "video" && !是否为视频(file)) {
      return { valid: false, error: `${file.name} 不是视频文件` };
    }

    /* 文件大小校验 */
    if (file.size / 1024 / 1024 > maxFileSizeMB) {
      return {
        valid: false,
        error: `${file.name} 超过 ${maxFileSizeMB}MB 限制`,
      };
    }

    /* 视频时长校验 */
    if (
      (类型 === "video" || (类型 === "auto" && 是否为视频(file))) &&
      maxDurationSeconds > 0
    ) {
      const duration = await 获取视频时长(file);
      if (duration !== null && duration > maxDurationSeconds) {
        return {
          valid: false,
          error: `${file.name} 时长 ${Math.round(duration)} 秒，超过 ${maxDurationSeconds} 秒限制`,
        };
      }
    }

    return { valid: true };
  }

  /* 获取视频时长 */
  function 获取视频时长(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";

      const timeout = setTimeout(() => {
        URL.revokeObjectURL(video.src);
        resolve(null); /* 超时不报错，继续上传 */
      }, 5000);

      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };

      video.onerror = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(video.src);
        resolve(null);
      };

      video.src = URL.createObjectURL(file);
    });
  }

  /* 处理图片：压缩 */
  async function 处理图片(file: File): Promise<Blob> {
    try {
      return await compressImage(file, compressMaxKB);
    } catch {
      /* 压缩失败用原文件 */
      return file;
    }
  }

  /* 上传单个文件（fetch 方式，用于图片） */
  async function 上传图片(file: File | Blob, fileName: string): Promise<string> {
    const controller = new AbortController();
    取消控制器.current = controller;

    const formData = new FormData();
    formData.append("file", file, fileName);
    if (folder) formData.append("folder", folder);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "上传失败");
    }

    return result.path as string;
  }

  /* 上传单个文件（XHR 方式，用于视频，支持进度回调） */
  function 上传视频(file: File | Blob, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      取消控制器.current = {
        abort: () => {
          xhr.abort();
        },
      } as AbortController;

      xhr.open("POST", "/api/upload");
      xhr.timeout = timeoutMs;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(result.path as string);
          } else {
            reject(new Error(result.error || "上传失败"));
          }
        } catch {
          reject(new Error("服务器返回格式异常"));
        }
      };

      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.ontimeout = () => reject(new Error("上传超时"));

      const formData = new FormData();
      formData.append("file", file, fileName);
      if (folder) formData.append("folder", folder);

      xhr.send(formData);
    });
  }

  /* 主上传函数：串行上传所有文件 */
  const 上传 = useCallback(
    async (files: FileList | File[]): Promise<上传结果> => {
      const fileArray = Array.from(files);
      const urls: string[] = [];
      const errors: { file: string; error: string }[] = [];

      set上传中(true);
      set错误("");
      set进度(0);

      /* 先校验所有文件 */
      const 有效文件: File[] = [];
      for (const file of fileArray) {
        const result = await 校验文件(file);
        if (result.valid) {
          有效文件.push(file);
        } else {
          errors.push({ file: file.name, error: result.error! });
        }
      }

      if (有效文件.length === 0) {
        set上传中(false);
        return { urls, errors };
      }

      const total = 有效文件.length;

      /* 串行上传 */
      for (let i = 0; i < total; i++) {
        const file = 有效文件[i];
        set总进度(`${i + 1} / ${total}`);

        try {
          let uploadFile: File | Blob = file;
          const isVideo = 是否为视频(file);

          /* 图片需要先压缩 */
          if (!isVideo && 是否为图片(file)) {
            uploadFile = await 处理图片(file);
          }

          /* 视频用 XHR（有进度），图片用 fetch */
          let path: string;
          if (isVideo) {
            path = await 上传视频(uploadFile, file.name);
          } else {
            path = await 上传图片(uploadFile, file.name);
          }

          urls.push(path);
          set进度(Math.round(((i + 1) / total) * 100));

          /* 每上传一个就回调 onSuccess（兼容需要即时更新的场景） */
          if (onSuccess) {
            onSuccess([...urls]);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "上传失败";
          errors.push({ file: file.name, error: message });

          /* 如果是用户取消，停止后续上传 */
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            break;
          }
        }
      }

      取消控制器.current = null;
      set上传中(false);
      set进度(total > 0 && urls.length === total ? 100 : 进度);

      return { urls, errors };
    },
    [
      mediaType,
      compressMaxKB,
      maxDurationSeconds,
      maxFileSizeMB,
      timeoutMs,
      folder,
      onProgress,
      onSuccess,
    ]
  );

  /* 删除服务端文件 */
  const 删除文件 = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/delete-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        const result = await res.json();
        return result.success === true;
      } catch {
        return false;
      }
    },
    []
  );

  return {
    上传,
    上传中,
    进度,
    总进度,
    错误,
    取消,
    删除文件,
  };
}
