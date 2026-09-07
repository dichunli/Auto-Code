#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信 4.x 图片 .dat 解密模块（移植自开源项目 328336690/wechat-decrypt，Apache-2.0）
原项目地址: https://github.com/328336690/wechat-decrypt

支持两种加密格式:
  - 旧格式: 单字节 XOR 加密，key 通过对比文件头与已知图片 magic bytes 自动检测
  - V2 格式 (2025-08+): AES-128-ECB + XOR 混合加密，需要从微信进程内存提取 AES key
    （用同目录的 提取图片钥匙.py 抓一次钥匙，存到 image_key.json）

V2 文件结构:
  [6B signature: 07 08 V2 08 07] [4B aes_size LE] [4B xor_size LE] [1B padding]
  [aligned_aes_size bytes AES-ECB] [raw_data] [xor_size bytes XOR]

映射链:
  message_*.db (local_id) → message_resource.db (packed_info 含 MD5) → .dat 文件 → 解密
"""

import glob
import hashlib
import os
import sqlite3
import struct

# V2 格式完整 magic (6 bytes)
V2_MAGIC = b'\x07\x08\x56\x32'        # 前 4 字节用于快速检测
V2_MAGIC_FULL = b'\x07\x08V2\x08\x07'  # 完整 6 字节签名
V1_MAGIC_FULL = b'\x07\x08V1\x08\x07'  # V1 签名 (固定 key)

# 常见图片格式的 magic bytes
IMAGE_MAGIC = {
    'png': [0x89, 0x50, 0x4E, 0x47],
    'gif': [0x47, 0x49, 0x46, 0x38],
    'tif': [0x49, 0x49, 0x2A, 0x00],
    'webp': [0x52, 0x49, 0x46, 0x46],
    'jpg': [0xFF, 0xD8, 0xFF],
}


def is_v2_format(dat_path):
    """检测是否是微信 V2 加密格式 (2025-08+)"""
    try:
        with open(dat_path, 'rb') as f:
            magic = f.read(4)
        return magic == V2_MAGIC
    except (OSError, IOError):
        return False


def detect_image_format(header_bytes):
    """根据文件头识别图片格式"""
    for fmt, magic in IMAGE_MAGIC.items():
        if list(header_bytes[:len(magic)]) == magic:
            return fmt
    return 'jpg'


def detect_xor_key(dat_path):
    """旧格式：对比文件头和已知图片 magic bytes 自动检测单字节 XOR key"""
    with open(dat_path, 'rb') as f:
        header = f.read(16)
    if len(header) < 4 or header[:4] == V2_MAGIC:
        return None
    for fmt, magic in IMAGE_MAGIC.items():
        key = header[0] ^ magic[0]
        if all(i >= len(header) or (header[i] ^ key) == magic[i] for i in range(1, len(magic))):
            return key
    return None


def v2_decrypt_file(dat_path, out_path=None, aes_key=None, xor_key=0x88):
    """解密 V2 格式 .dat 文件 (AES-ECB + XOR)。返回 (输出路径, 格式) 或 (None, None)"""
    if aes_key is None:
        return None, None

    from Crypto.Cipher import AES
    from Crypto.Util import Padding

    if isinstance(aes_key, str):
        aes_key = aes_key.encode('ascii')[:16]
    if len(aes_key) < 16:
        return None, None

    with open(dat_path, 'rb') as f:
        data = f.read()
    if len(data) < 15:
        return None, None

    sig = data[:6]
    if sig not in (V2_MAGIC_FULL, V1_MAGIC_FULL):
        return None, None

    aes_size, xor_size = struct.unpack_from('<LL', data, 6)

    # V1 用固定 key（md5("0")[:16]）
    if sig == V1_MAGIC_FULL:
        aes_key = b'cfcd208495d565ef'

    # AES 对齐：PKCS7 填充使实际密文 >= aes_size，向上对齐到 16
    aligned_aes_size = aes_size
    aligned_aes_size -= ~(~aligned_aes_size % 16)  # 同原项目的对齐公式

    offset = 15
    if offset + aligned_aes_size > len(data):
        return None, None

    aes_data = data[offset:offset + aligned_aes_size]
    try:
        cipher = AES.new(aes_key[:16], AES.MODE_ECB)
        dec_aes = Padding.unpad(cipher.decrypt(aes_data), AES.block_size)
    except (ValueError, KeyError):
        return None, None
    offset += aligned_aes_size

    raw_end = len(data) - xor_size
    raw_data = data[offset:raw_end] if offset < raw_end else b''
    dec_xor = bytes(b ^ xor_key for b in data[raw_end:])

    decrypted = dec_aes + raw_data + dec_xor
    fmt = detect_image_format(decrypted[:16])
    if decrypted[:4] == b'wxgf':  # HEVC 裸流
        fmt = 'hevc'

    if out_path is None:
        base = os.path.splitext(dat_path)[0]
        for suffix in ('_t', '_h'):
            if base.endswith(suffix):
                base = base[:-len(suffix)]
                break
        out_path = f"{base}.{fmt}"

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(decrypted)
    return out_path, fmt


def xor_decrypt_file(dat_path, out_path=None, key=None):
    """旧格式：单字节 XOR 解密。返回 (输出路径, 格式) 或 (None, None)"""
    if key is None:
        key = detect_xor_key(dat_path)
        if key is None:
            return None, None
    with open(dat_path, 'rb') as f:
        data = f.read()
    decrypted = bytes(b ^ key for b in data)
    fmt = detect_image_format(decrypted[:16])
    if out_path is None:
        out_path = os.path.splitext(dat_path)[0] + f".{fmt}"
    with open(out_path, 'wb') as f:
        f.write(decrypted)
    return out_path, fmt


# ============================================================
# wxgf（微信私有图片格式）解码：调用微信自己的 VoipEngine.dll
# 思路移植自开源项目 HShiDianLu/wx-dat2img（MIT）
# ============================================================

_wxam函数 = None
_wxam加载过 = False


def _加载wxam解码器():
    """从微信 4.x 安装目录加载 VoipEngine.dll 的 wxam_dec_wxam2pic_5 函数"""
    global _wxam函数, _wxam加载过
    if _wxam加载过:
        return _wxam函数
    _wxam加载过 = True
    import ctypes
    候选根们 = [
        os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
        os.environ.get("PROGRAMFILES", r"C:\Program Files"),
    ]
    dll路径 = None
    for 根 in 候选根们:
        微信目录 = os.path.join(根, "Tencent", "Weixin")
        if not os.path.isdir(微信目录):
            continue
        for 子项 in os.listdir(微信目录):
            候选 = os.path.join(微信目录, 子项, "VoipEngine.dll")
            if os.path.exists(候选):
                dll路径 = 候选
                break
        if dll路径:
            break
    if not dll路径:
        return None
    try:
        函数 = ctypes.WinDLL(dll路径).wxam_dec_wxam2pic_5
        函数.argtypes = [
            ctypes.c_int64, ctypes.c_int, ctypes.c_int64,
            ctypes.POINTER(ctypes.c_int), ctypes.c_int64,
        ]
        函数.restype = ctypes.c_int64
        _wxam函数 = 函数
    except Exception:
        _wxam函数 = None
    return _wxam函数


def wxgf转图片(data):
    """把 wxgf 数据解码成普通图片字节（jpg/png）。失败返回 None。"""
    import ctypes

    class WxAMConfig(ctypes.Structure):
        _fields_ = [("mode", ctypes.c_int)]

    函数 = _加载wxam解码器()
    if not 函数 or not data:
        return None
    上限 = 64 * 1024 * 1024
    for 模式 in (1, 2, 0, 3):
        try:
            配置 = WxAMConfig()
            配置.mode = 模式
            输入缓冲 = ctypes.create_string_buffer(data, len(data))
            输出缓冲 = ctypes.create_string_buffer(上限)
            输出大小 = ctypes.c_int(上限)
            返回值 = 函数(
                ctypes.addressof(输入缓冲), len(data),
                ctypes.addressof(输出缓冲), ctypes.byref(输出大小),
                ctypes.addressof(配置),
            )
            if 返回值 != 0 or 输出大小.value <= 0:
                continue
            结果 = 输出缓冲.raw[:输出大小.value]
            # 确认解出来的是常见图片格式
            if 结果[:3] == b'\xff\xd8\xff' or 结果[:4] in (b'\x89PNG', b'GIF8', b'RIFF'):
                return 结果
        except Exception:
            continue
    return None


def extract_md5_from_packed_info(blob):
    """从 message_resource.db 的 packed_info (protobuf 二进制) 里提取文件 MD5"""
    if not blob:
        return None
    if isinstance(blob, str):
        candidate = blob.encode('utf-8', errors='ignore')
    else:
        candidate = bytes(blob)
    # MD5 是 32 位小写十六进制字符串，直接在内嵌文本里搜
    text = candidate.decode('latin-1', errors='ignore')
    import re
    m = re.search(r'[0-9a-f]{32}', text)
    return m.group(0) if m else None


def 取图片MD5(资源库路径, local_id, 会话username=None, 消息时间=None):
    """通过 local_id 查 message_resource.db 获取图片文件 MD5。
    注意两个坑：①列名是 message_local_id ②同群同 local_id 会有多行
    （消息分散在多个 message_N.db 里，local_id 各库重复），必须再按
    message_create_time 与消息时间完全一致（或最接近）来锁定正确那行。"""
    if not 资源库路径 or not os.path.exists(资源库路径):
        return None
    conn = sqlite3.connect(资源库路径)
    try:
        if 会话username and 消息时间:
            row = conn.execute(
                "SELECT packed_info, ABS(message_create_time - ?) AS 差 "
                "FROM MessageResourceInfo r "
                "WHERE r.message_local_id = ? AND r.chat_id = "
                "(SELECT rowid FROM ChatName2Id WHERE user_name = ?) "
                "AND length(r.packed_info) > 0 ORDER BY 差 LIMIT 1",
                (消息时间, local_id, 会话username),
            ).fetchone()
        elif 会话username:
            row = conn.execute(
                "SELECT r.packed_info, 0 FROM MessageResourceInfo r "
                "WHERE r.message_local_id = ? AND r.chat_id = "
                "(SELECT rowid FROM ChatName2Id WHERE user_name = ?) "
                "AND length(r.packed_info) > 0 LIMIT 1",
                (local_id, 会话username),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT packed_info, 0 FROM MessageResourceInfo "
                "WHERE message_local_id = ? AND length(packed_info) > 0 LIMIT 1",
                (local_id,),
            ).fetchone()
        if row and row[0]:
            return extract_md5_from_packed_info(row[0])
    except Exception:
        pass
    finally:
        conn.close()
    return None


def 找dat文件(attach根目录, 会话username, file_md5):
    """在 attach 目录下按 MD5 找 .dat 文件（路径: attach/<md5(username)>/<年-月>/Img/<md5>[_t|_h].dat）"""
    username_hash = hashlib.md5(会话username.encode()).hexdigest()
    search_base = os.path.join(attach根目录, username_hash)
    if not os.path.isdir(search_base):
        return []
    pattern = os.path.join(search_base, "*", "Img", f"{file_md5}*.dat")
    return sorted(glob.glob(pattern))


def 找气泡图(数据根目录, 会话username, file_md5):
    """在气泡缓存里找显示尺寸的图（路径: cache/<年-月>/Message/<md5(username)>/Bubble/<md5>_b.dat）
    微信为了渲染聊天窗口会**自动下载**这种中等尺寸图，不用点开大图就有，清晰度足够看和识别。"""
    username_hash = hashlib.md5(会话username.encode()).hexdigest()
    pattern = os.path.join(数据根目录, "cache", "*", "Message", username_hash, "Bubble", f"{file_md5}_b.dat")
    return sorted(glob.glob(pattern))


def _解密并转jpg(dat路径, 输出路径不含扩展名, aes_key, xor_key):
    """解密一个 dat，wxgf 自动借微信 DLL 转 JPG。返回 (路径, 格式) 或 (None, None)"""
    路径, fmt = _解密单个(dat路径, 输出路径不含扩展名, aes_key, xor_key)
    if not 路径:
        return None, None
    if fmt != 'hevc':
        return 路径, fmt
    try:
        转好的 = wxgf转图片(open(路径, 'rb').read())
    except Exception:
        转好的 = None
    if not 转好的:
        return 路径, fmt
    目标 = 输出路径不含扩展名 + ".jpg"
    with open(目标, 'wb') as f:
        f.write(转好的)
    try:
        os.unlink(路径)
    except OSError:
        pass
    return 目标, "jpg"


def 解密群图片(资源库路径, attach根目录, 会话username, local_id, aes_key, 输出路径不含扩展名, xor_key=0x88, 数据根目录=None, 消息时间=None):
    """完整链路：local_id → MD5 → .dat → 解密。返回 (解密后路径, 格式) 或 (None, 错误说明)
    取图优先级：attach 原图/高清 > 气泡缓存图（自动下载的中等尺寸）> attach 缩略图。"""
    file_md5 = 取图片MD5(资源库路径, local_id, 会话username, 消息时间)
    if not file_md5:
        return None, f"message_resource.db 里找不到 local_id={local_id} 的图片信息"

    dat_files = 找dat文件(attach根目录, 会话username, file_md5)

    # 候选顺序：标准版（无后缀）→ 高清 _h → 缩略图 _t
    def 排序键(p):
        名 = os.path.basename(p)
        if 名.startswith(file_md5 + '_t'):
            return 2
        if 名.startswith(file_md5 + '_h'):
            return 1
        return 0
    候选们 = sorted(dat_files, key=排序键)

    缩略图兜底 = None
    for 候选 in 候选们:
        路径, fmt = _解密并转jpg(候选, 输出路径不含扩展名, aes_key, xor_key)
        if not 路径:
            continue
        if fmt == 'hevc':
            # wxgf 且 DLL 转换失败：缩略图留作兜底
            if 候选.endswith('_t.dat') or '_t' in os.path.basename(候选):
                缩略图兜底 = (路径, fmt)
            continue
        # attach 里解出的图太小（<30KB 基本是缩略图质量），试试气泡缓存有没有更大的
        if os.path.getsize(路径) < 30 * 1024:
            缩略图兜底 = (路径, fmt)
            continue
        return 路径, fmt

    # 气泡缓存：微信渲染聊天窗口时自动下载的中等尺寸图（不用点开大图就有）
    if 数据根目录:
        for 气泡 in 找气泡图(数据根目录, 会话username, file_md5):
            路径, fmt = _解密并转jpg(气泡, 输出路径不含扩展名, aes_key, xor_key)
            if 路径 and fmt != 'hevc' and os.path.getsize(路径) >= 30 * 1024:
                return 路径, fmt
            if 路径 and not 缩略图兜底:
                缩略图兜底 = (路径, fmt)

    if 缩略图兜底:
        return 缩略图兜底
    return None, "找不到可解密的图片文件（原图和气泡缓存都没有）"


def _解密单个(dat_path, 输出路径不含扩展名, aes_key, xor_key=0x88):
    """解密单个 dat 到指定文件名。返回 (路径, 格式) 或 (None, None)"""
    if is_v2_format(dat_path):
        if not aes_key:
            return None, None
        return _v2解密到指定名(dat_path, 输出路径不含扩展名, aes_key, xor_key)
    结果路径, fmt = xor_decrypt_file(dat_path, 输出路径不含扩展名 + ".jpg")
    return (结果路径, fmt) if 结果路径 else (None, None)


def _v2解密到指定名(dat_path, 输出路径不含扩展名, aes_key, xor_key=0x88):
    """V2 解密并输出到指定文件名（自动补扩展名）"""
    # 先解到临时默认名，再移动，避免猜错扩展名
    临时路径, fmt = v2_decrypt_file(dat_path, None, aes_key, xor_key)
    if not 临时路径:
        return None, "V2 解密失败（钥匙不对或文件损坏）"
    目标 = f"{输出路径不含扩展名}.{fmt}"
    import shutil
    if os.path.exists(目标):
        os.unlink(目标)
    shutil.move(临时路径, 目标)  # shutil.move 支持跨盘，os.replace 不行
    return 目标, fmt
