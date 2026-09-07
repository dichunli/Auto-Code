#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信群配件需求采集小工具（新引擎，支持微信 4.x）

与旧引擎（poller.py，基于 PyWxDump，只支持微信 3.9.x）的区别：
  数据源换成 wechat-cli（读新版微信本地数据库）+ wximg.py（V2 图片解密）。
  归堆规则、看板样式、百度 OCR 车牌识别完全不变。

用法：
  python poller2.py            正式运行（持续轮询）
  python poller2.py --test     诊断模式（只跑一次，打印读到了什么）

前置条件：
  1. 电脑上登录着微信 4.x（账号要在目标群里）
  2. 跑过 wechat-cli init（提取过数据库密钥，存在 ~/.wechat-cli/）
  3. 需要看照片的话，先跑 提取图片钥匙.py 抓一次图片 AES 钥匙（存 image_key.json）
"""

import configparser
import html
import json
import os
import re
import sqlite3
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# 控制台按 UTF-8 输出，避免中文/符号打印报错（失败也不影响运行）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import wximg  # 同目录的微信4.x图片解密模块

# ============================================================
# 常量
# ============================================================

# 归堆时间窗口：同一个人相邻消息间隔不超过该秒数，归为同一个"需求包"
归堆窗口秒 = 5 * 60

# 看板里最多保留多少天的消息（防止文件越攒越大）
保留天数 = 30

# 中国大陆车牌号正则（普通蓝牌/黄牌/新能源绿牌）
车牌正则 = re.compile(
    r"[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领]"
    r"[A-HJ-NP-Z]"
    r"[A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]"
)

# 微信消息类型（local_type 低 32 位）
消息类型_文本 = 1
消息类型_图片 = 3
消息类型_语音 = 34
消息类型_视频 = 43
消息类型_表情 = 47
消息类型_应用 = 49   # 引用、链接、文件、转账等
消息类型_系统 = 10000

脚本目录 = Path(__file__).parent
图片钥匙文件 = 脚本目录 / "image_key.json"


# ============================================================
# 配置读取
# ============================================================

def 读取配置():
    """读取同目录下的 config.ini，返回配置字典。缺配置时给出通俗提示并退出。"""
    配置路径 = 脚本目录 / "config.ini"
    if not 配置路径.exists():
        print(f"【错误】找不到配置文件：{配置路径}")
        print("请确认 config.ini 和 poller2.py 放在同一个文件夹里。")
        sys.exit(1)

    解析器 = configparser.ConfigParser()
    解析器.read(配置路径, encoding="utf-8")

    群名原文 = 解析器.get("wechat", "groups", fallback="").strip()
    if not 群名原文:
        print("【错误】config.ini 里的 groups 没填。")
        print("请打开 config.ini，把目标群的群名填在 groups = 后面，保存后重新运行。")
        sys.exit(1)

    # OCR 密钥：config.ini 没填时，自动读项目 .env.local 里的 BAIDU_API_KEY/SECRET_KEY
    # （主系统的车牌识别就在用这套密钥，避免重复配置）
    ocr密钥 = 解析器.get("ocr", "baidu_api_key", fallback="").strip()
    ocr密文 = 解析器.get("ocr", "baidu_secret_key", fallback="").strip()
    if not ocr密钥 or not ocr密文:
        env文件 = 脚本目录.parent.parent / ".env.local"
        if env文件.exists():
            for 行 in env文件.read_text(encoding="utf-8").splitlines():
                if 行.startswith("BAIDU_API_KEY=") and not ocr密钥:
                    ocr密钥 = 行.split("=", 1)[1].strip()
                elif 行.startswith("BAIDU_SECRET_KEY=") and not ocr密文:
                    ocr密文 = 行.split("=", 1)[1].strip()

    return {
        "目标群列表": [g.strip() for g in 群名原文.split(",") if g.strip()],
        "轮询间隔": max(5, 解析器.getint("wechat", "interval", fallback=30)),
        "输出目录": Path(解析器.get("paths", "output", fallback="./输出")).resolve(),
        "工作目录": Path(解析器.get("paths", "workdir", fallback="./_工作区")).resolve(),
        "OCR启用": 解析器.getboolean("ocr", "enabled", fallback=False),
        "OCR密钥": ocr密钥,
        "OCR密文": ocr密文,
    }


def 读图片钥匙():
    """读取 image_key.json 里的图片钥匙（AES + XOR）。没有则返回 ("", None)"""
    if not 图片钥匙文件.exists():
        return "", None
    try:
        数据 = json.loads(图片钥匙文件.read_text(encoding="utf-8"))
        return 数据.get("image_aes_key", ""), 数据.get("image_xor_key")
    except Exception:
        return "", None


# ============================================================
# 数据源：wechat-cli 上下文
# ============================================================

def 建上下文():
    """构建 wechat-cli 的 AppContext（读 ~/.wechat-cli/ 下 init 时保存的密钥配置）"""
    try:
        from wechat_cli.core.context import AppContext
    except ImportError:
        print("【错误】没有安装 wechat-cli。")
        print('请先运行：pip install "git+https://github.com/maomao3334/wechat-cli-plus.git"')
        return None
    try:
        return AppContext()
    except Exception as 异常:
        print(f"【错误】读取微信密钥配置失败：{异常}")
        print("请先运行 wechat-cli init 提取密钥（详见 README）。")
        return None


def 本号wxid(app):
    """从微信数据目录名推出当前登录账号的 wxid（目录名形如 wxid_xxxx_98a4）"""
    try:
        目录名 = Path(app.db_dir).parent.name  # wxid_00m9r2j7hsyg22_98a4
        主段 = 目录名.rsplit("_", 1)[0]
        return 主段 if 主段.startswith("wxid_") else ""
    except Exception:
        return ""


def 定位目标群(app, 群名列表):
    """把配置的群名解析成群 username 和消息表清单。返回 (群上下文列表, 没找到的群名列表)"""
    from wechat_cli.core.messages import resolve_chat_context
    上下文们 = []
    没找到 = []
    for 名 in 群名列表:
        try:
            ctx = resolve_chat_context(名, app.msg_db_keys, app.cache, app.decrypted_dir)
        except Exception:
            ctx = None
        if ctx and ctx.get("message_tables"):
            上下文们.append(ctx)
        else:
            没找到.append(名)
    return 上下文们, 没找到


def 加载昵称表(app, 强制刷新=False):
    """读 微信 username -> 显示名 对照表（含群名）。失败返回空字典。"""
    try:
        import wechat_cli.core.contacts as 联系人模块
        if 强制刷新:
            联系人模块._contact_names = None  # 清掉模块级缓存，强制重读
        return 联系人模块.get_contact_names(app.cache, app.decrypted_dir) or {}
    except Exception as 异常:
        print(f"【警告】读取昵称表失败：{异常}（将显示原始账号）")
        return {}


# ============================================================
# 消息读取与解析
# ============================================================

def 查询新消息(app, 群上下文们, 游标状态):
    """
    从各群的消息表里查 create_time 大于游标的新消息。
    返回 (消息列表, 新游标状态)。消息字典结构和老引擎一致。
    注意：每轮必须重新走 _find_msg_tables_for_user（内部 cache.get 会按 mtime
    变化重新解密）。直接用启动时解析的 db_path 会一直读旧快照，新消息进不来。
    """
    from wechat_cli.core.messages import decompress_content, _split_msg_type, _find_msg_tables_for_user

    新消息 = []
    见过的 = set(游标状态.get("recent", []))
    最大时间 = 游标状态.get("max_ct", 0)

    for ctx in 群上下文们:
        群id = ctx["username"]
        for 表 in _find_msg_tables_for_user(群id, app.msg_db_keys, app.cache):
            表名 = 表["table_name"]
            try:
                连接 = sqlite3.connect(表["db_path"])
                行们 = 连接.execute(
                    f"SELECT local_id, local_type, create_time, real_sender_id, "
                    f"message_content, WCDB_CT_message_content FROM [{表名}] "
                    f"WHERE create_time >= ? ORDER BY create_time",
                    (最大时间 - 5,),  # 回退 5 秒防同秒漏消息，靠 recent 去重
                ).fetchall()
                连接.close()
            except Exception as 异常:
                print(f"【警告】读取消息表 {表名} 失败：{异常}")
                continue

            for local_id, local_type, 创建时间, 真实发送者id, 内容, 压缩类型 in 行们:
                唯一键 = f"{表名}:{local_id}"
                if 唯一键 in 见过的 or not 创建时间:
                    continue
                见过的.add(唯一键)

                类型基础, _ = _split_msg_type(local_type)
                文本 = decompress_content(内容, 压缩类型) or ""

                # 群消息发送者嵌在内容开头 "wxid:\n..."；自己的消息没有前缀
                发送者 = ""
                正文 = 文本
                if ctx["is_group"] and ":\n" in 文本:
                    候选, 剩下 = 文本.split(":\n", 1)
                    if re.fullmatch(r"[A-Za-z0-9_-]{3,64}", 候选 or ""):
                        发送者 = 候选
                        正文 = 剩下
                新消息.append({
                    "id": 唯一键,
                    "local_id": local_id,
                    "类型": 类型基础,
                    "发送者": 发送者,   # 空串 = 可能是自己发的，后面统一处理
                    "群id": 群id,
                    "时间": int(创建时间),
                    "内容": (正文 or "").strip() if 类型基础 == 消息类型_文本 else "",
                    "图片路径": "",
                    "图片车牌": "",
                })
                if 创建时间 > 最大时间:
                    最大时间 = 创建时间

    新消息.sort(key=lambda m: (m["时间"], m["id"]))
    新游标 = {"max_ct": 最大时间, "recent": sorted(见过的)[-300:]}
    return 新消息, 新游标


def 补发送者(消息列表, 本号):
    """发送者为空的消息：群消息里没写发送者的基本都是自己发的"""
    for 消息 in 消息列表:
        if not 消息["发送者"]:
            消息["发送者"] = "__自己__"
        elif 本号 and 消息["发送者"] == 本号:
            消息["发送者"] = "__自己__"


def 解密消息图片(消息, app, aes钥匙, xor钥匙, 图片目录):
    """给一条图片消息解密出普通图片文件。返回文件名；失败返回空串。"""
    try:
        资源库 = app.cache.get(os.path.join("message", "message_resource.db"))
        attach根 = str(Path(app.db_dir).parent / "msg" / "attach")
        输出基础 = str(图片目录 / f"{消息['local_id']}")
        路径, 格式或错误 = wximg.解密群图片(
            资源库, attach根, 消息["群id"], 消息["local_id"], aes钥匙, 输出基础, xor钥匙 or 0x88)
        if 路径:
            return Path(路径).name
        消息["_图片错误"] = 格式或错误 or "未知错误"
    except Exception as 异常:
        消息["_图片错误"] = str(异常)
    return ""


# ============================================================
# 照片车牌识别（可选，百度云车牌识别接口，免费额度内零费用）
# ============================================================

_百度令牌缓存 = {"令牌": "", "过期时间": 0.0}


def 获取百度令牌(配置):
    """用 API Key/Secret 换 access_token，失败返回空串。"""
    import urllib.parse
    import urllib.request

    if _百度令牌缓存["令牌"] and time.time() < _百度令牌缓存["过期时间"]:
        return _百度令牌缓存["令牌"]
    try:
        参数 = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": 配置["OCR密钥"],
            "client_secret": 配置["OCR密文"],
        })
        地址 = f"https://aip.baidubce.com/oauth/2.0/token?{参数}"
        with urllib.request.urlopen(地址, timeout=10) as 响应:
            数据 = json.loads(响应.read().decode("utf-8"))
        令牌 = 数据.get("access_token", "")
        if 令牌:
            _百度令牌缓存["令牌"] = 令牌
            _百度令牌缓存["过期时间"] = time.time() + 数据.get("expires_in", 2592000) - 86400
        return 令牌
    except Exception as 异常:
        print(f"【警告】获取 OCR 令牌失败：{异常}（本轮跳过照片识别）")
        return ""


def OCR识别车牌(图片文件, 配置):
    """车牌专用接口：识别照片里的车牌号。未启用/失败返回空串。"""
    if not 配置["OCR启用"] or not 配置["OCR密钥"] or not 配置["OCR密文"]:
        return ""
    import base64
    import urllib.parse
    import urllib.request

    令牌 = 获取百度令牌(配置)
    if not 令牌:
        return ""
    try:
        图片数据 = base64.b64encode(Path(图片文件).read_bytes())
        地址 = f"https://aip.baidubce.com/rest/2.0/ocr/v1/license_plate?access_token={令牌}"
        请求体 = urllib.parse.urlencode({"image": 图片数据}).encode("utf-8")
        with urllib.request.urlopen(地址, data=请求体, timeout=15) as 响应:
            数据 = json.loads(响应.read().decode("utf-8"))
        车牌 = (数据.get("words_result") or {}).get("number", "")
        return 车牌.strip().upper()
    except Exception as 异常:
        print(f"【警告】照片车牌识别失败：{异常}（这张照片按无车牌处理）")
        return ""


def OCR识别文字(图片文件, 配置):
    """通用文字识别（兜底）：电脑截图里的车牌专用接口认不出，用它读出全部文字再正则找车牌。"""
    if not 配置["OCR启用"] or not 配置["OCR密钥"] or not 配置["OCR密文"]:
        return ""
    import base64
    import urllib.parse
    import urllib.request

    令牌 = 获取百度令牌(配置)
    if not 令牌:
        return ""
    try:
        图片数据 = base64.b64encode(Path(图片文件).read_bytes())
        地址 = f"https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token={令牌}"
        请求体 = urllib.parse.urlencode({"image": 图片数据}).encode("utf-8")
        with urllib.request.urlopen(地址, data=请求体, timeout=15) as 响应:
            数据 = json.loads(响应.read().decode("utf-8"))
        全部文字 = " ".join(w.get("words", "") for w in 数据.get("words_result", []))
        命中 = 车牌正则.findall(re.sub(r"[\s·・.。]", "", 全部文字.upper()))
        return 命中[0] if 命中 else ""
    except Exception as 异常:
        print(f"【警告】通用文字识别失败：{异常}（这张图按无车牌处理）")
        return ""


def 识别图片车牌(图片文件, 配置):
    """先用车牌专用接口（准），认不出再用通用文字识别兜底（覆盖电脑截图）"""
    车牌 = OCR识别车牌(图片文件, 配置)
    if 车牌 and 车牌正则.findall(车牌):
        return 车牌
    return OCR识别文字(图片文件, 配置)


# ============================================================
# 归堆：按车牌归类（同一辆车的需求归到一起，拍到新车牌才另起一堆）
# ============================================================

def 提取消息车牌(消息):
    """文字里正则识别，或照片 OCR 结果。返回车牌号，没有返回空串。"""
    if 消息["内容"]:
        命中 = 车牌正则.findall(消息["内容"].upper())
        if 命中:
            return 命中[0]
    # OCR 可能有误报（把零件标签认成车牌），同样过一遍正则校验
    ocr结果 = 消息.get("图片车牌", "") or ""
    if ocr结果:
        命中 = 车牌正则.findall(ocr结果.upper())
        if 命中:
            return 命中[0]
    return ""


def 归堆成需求包(消息列表):
    """
    归堆规则（按车牌归类）：
    1. 消息里识别到车牌 → 归入该车牌的包，并成为该发送者的"当前车辆"
    2. 没带车牌 → 归入该发送者"当前车辆"的包（跟着上一条车牌走）
    3. 还没有任何车辆上下文 → 进该发送者的"未识别车牌"包
    4. 同一车牌跨自然日自动分包（昨天的需求归昨天）
    5. 先发消息、后补车牌的，此人最近半小时的未识别包自动并入车牌包
    返回需求包列表（最新活跃的在前）。
    """
    排序后 = sorted(消息列表, key=lambda m: (m["时间"], m["id"]))

    包们 = {}          # 包键 -> 包
    包顺序 = []        # 记录创建顺序（最后按活跃时间重排）
    每人当前车辆 = {}  # 发送者 -> (车牌, 日期)
    每人未识别包 = {}  # 发送者 -> 其未识别包的包键

    def 取包(键, 车牌, 日期, 消息):
        if 键 not in 包们:
            包们[键] = {
                "包id": f"{车牌}_{日期}" if 车牌 else f"未识别_{日期}_{消息['发送者']}",
                "车牌": 车牌,
                "日期": 日期,
                "开始时间": 消息["时间"],
                "结束时间": 消息["时间"],
                "消息们": [],
            }
            包顺序.append(键)
        return 包们[键]

    for 消息 in 排序后:
        if 消息["类型"] == 消息类型_系统:
            continue
        日期 = datetime.fromtimestamp(消息["时间"]).strftime("%Y-%m-%d") if 消息["时间"] else "未知日期"
        车牌 = 提取消息车牌(消息)
        发送者 = 消息["发送者"]

        if 车牌:
            # 规则 5：先发配件名、后补车牌 → 此人最近的未识别包并过来
            旧键 = 每人未识别包.pop(发送者, None)
            if 旧键 and 旧键 in 包们:
                旧包 = 包们[旧键]
                if 0 <= 消息["时间"] - 旧包["结束时间"] <= 30 * 60:
                    车牌包 = 取包((车牌, 日期), 车牌, 日期, 消息)
                    车牌包["消息们"].extend(旧包["消息们"])
                    车牌包["开始时间"] = min(车牌包["开始时间"], 旧包["开始时间"])
                    del 包们[旧键]
                    包顺序.remove(旧键)
            每人当前车辆[发送者] = (车牌, 日期)
            键 = (车牌, 日期)
        else:
            当前 = 每人当前车辆.get(发送者)
            if 当前 and 当前[1] == 日期:
                键 = (当前[0], 日期)
            else:
                键 = (None, 日期, 发送者)
                每人未识别包[发送者] = 键

        包 = 取包(键, 车牌, 日期, 消息)
        包["消息们"].append(消息)
        包["结束时间"] = 消息["时间"]

    结果 = []
    for 键 in 包顺序:
        包 = 包们[键]
        包["消息们"].sort(key=lambda m: (m["时间"], m["id"]))
        发送者们 = []
        for 单条 in 包["消息们"]:
            if 单条["发送者"] not in 发送者们:
                发送者们.append(单条["发送者"])
        包["发送者列表"] = 发送者们
        结果.append(包)

    结果.sort(key=lambda p: p["结束时间"], reverse=True)
    return 结果


# ============================================================
# HTML 看板生成
# ============================================================

看板模板 = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>配件需求看板</title>
<style>
  body {{ font-family: "Microsoft YaHei", sans-serif; background: #f3f4f6; margin: 0; padding: 16px; }}
  .头部 {{ max-width: 800px; margin: 0 auto 16px; }}
  .头部 h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .头部 .时间 {{ color: #6b7280; font-size: 13px; }}
  .说明 {{ background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; font-size: 13px;
          padding: 8px 12px; border-radius: 8px; margin-top: 8px; }}
  .包卡片 {{ max-width: 800px; margin: 0 auto 12px; background: #fff; border-radius: 12px;
            border: 1px solid #e5e7eb; padding: 12px 16px; }}
  .包卡片.已处理 {{ opacity: 0.45; }}
  .卡主体 {{ display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }}
  .列时间 {{ width: 66px; flex-shrink: 0; }}
  .列时间 .点钟 {{ color: #9ca3af; font-size: 12px; }}
  .列时间 .人名2 {{ color: #2563eb; font-size: 12px; word-break: break-all; margin-bottom: 6px; }}
  .车牌标题 {{ font-size: 17px; font-weight: 700; color: #111827; flex-shrink: 0;
              padding-top: 24px; min-width: 90px; }}
  .车牌标题.未识别 {{ color: #b45309; font-size: 14px; }}
  .列图片横排 {{ display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 1; }}
  .列图片横排 img {{ width: 130px; height: 130px; object-fit: cover; border-radius: 8px;
                    border: 1px solid #e5e7eb; cursor: zoom-in; }}
  .图占位 {{ color: #9ca3af; font-size: 12px; }}
  .列文字 {{ font-size: 14px; color: #111827; line-height: 1.8; word-break: break-all;
            flex: 1; min-width: 160px; padding-top: 2px; }}
  .处理行 {{ margin-top: 10px; border-top: 1px dashed #e5e7eb; padding-top: 8px; font-size: 13px; color: #374151; }}
  .处理行 .时刻 {{ color: #9ca3af; font-size: 12px; margin-right: 12px; }}
  .处理行 input[type=text] {{ width: 60%; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; }}
  .空提示 {{ max-width: 800px; margin: 40px auto; text-align: center; color: #9ca3af; }}
  /* 大图弹层：点图放大，点空白处或按 Esc 关闭 */
  .大图遮罩 {{ display: none; position: fixed; inset: 0; background: rgba(0,0,0,.75);
              z-index: 9999; align-items: center; justify-content: center; cursor: zoom-out; }}
  .大图遮罩.开 {{ display: flex; }}
  .大图遮罩 img {{ max-width: 92vw; max-height: 92vh; border-radius: 8px;
                  box-shadow: 0 4px 30px rgba(0,0,0,.5); cursor: default; }}
</style>
</head>
<body>
<div class="头部">
  <h1>配件需求看板</h1>
  <div class="时间">最后更新：{更新时间}　｜　共 {包数量} 个消息包　｜　保留最近 {保留天数} 天</div>
  <div class="说明">看完一条处理完一条：勾选"已处理"即可（勾选状态本浏览器自动记住）。
  建议处理完在备注里写一句（如"已下单"）。照片点一下可放大。</div>
</div>
{包列表html}
<div class="空提示" {空提示显示}>暂无群消息。确认脚本正在运行、目标群里有新消息。</div>
<div class="大图遮罩" id="大图遮罩" onclick="关大图()"><img id="大图本体" onclick="event.stopPropagation()"></div>
<script>
// 大图弹层：点缩略图放大，点空白处/按 Esc 关闭
function 放大看图(src) {{
  document.getElementById("大图本体").src = src;
  document.getElementById("大图遮罩").classList.add("开");
}}
function 关大图() {{
  document.getElementById("大图遮罩").classList.remove("开");
  document.getElementById("大图本体").src = "";
}}
document.addEventListener("keydown", function(e) {{ if (e.key === "Escape") 关大图(); }});
// 自动刷新：每 60 秒拉最新看板；正在看大图或正在输入备注时本轮跳过
setInterval(function() {{
  var 遮罩 = document.getElementById("大图遮罩");
  if (遮罩 && 遮罩.classList.contains("开")) return;
  var 焦点 = document.activeElement;
  if (焦点 && 焦点.tagName === "INPUT") return;
  location.reload();
}}, 60000);
// 勾选与备注存在浏览器 localStorage，重新打开/刷新不丢失
document.querySelectorAll(".包卡片").forEach(function(卡片) {{
  var id = 卡片.dataset.包id;
  var 勾选框 = 卡片.querySelector("input[type=checkbox]");
  var 备注框 = 卡片.querySelector("input[type=text]");
  if (localStorage.getItem("已处理_" + id) === "1") {{ 勾选框.checked = true; 卡片.classList.add("已处理"); }}
  var 旧备注 = localStorage.getItem("备注_" + id);
  if (旧备注) 备注框.value = 旧备注;
  勾选框.addEventListener("change", function() {{
    localStorage.setItem("已处理_" + id, 勾选框.checked ? "1" : "0");
    卡片.classList.toggle("已处理", 勾选框.checked);
  }});
  备注框.addEventListener("input", function() {{ localStorage.setItem("备注_" + id, 备注框.value); }});
}});
</script>
</body>
</html>
"""

包卡片模板 = """<div class="包卡片" data-包id="{包id}">
  <div class="卡主体">
    <div class="列时间">{时间人列表html}</div>
    <div class="{标题样式}">{标题}</div>
    <div class="列图片横排">{图片们html}</div>
    <div class="列文字">{文字们html}</div>
  </div>
  <div class="处理行">
    <span class="时刻">{日期}　{起止时间}</span>
    <label><input type="checkbox"> 已处理</label>　备注：<input type="text" placeholder="如：已下单 / 库里">
  </div>
</div>
"""


def 文字分行(内容):
    """按标点/空格/回车把一段文字拆成多行（如"前弓子，询价" → 前弓子 / 询价）"""
    return [段 for 段 in re.split(r"[\s,，、。;；!！?？~～…]+", 内容) if 段]


def 取显示名(发送者, 昵称表):
    """发送者 username → 显示名（自己/昵称/账号尾号兜底）"""
    return 昵称表.get(发送者, "") or ("我自己" if 发送者 == "__自己__" else 发送者[-6:] if 发送者 else "未知")


def 生成看板(包们, 昵称表, 输出目录):
    """根据需求包列表生成自包含的 HTML 看板文件。所有用户来源文本先转义再进 HTML。
    卡片内横向布局：左列时间+上传人 → 车牌 → 图片横排 → 文字分行。"""
    卡片们 = []
    for 包 in 包们:
        if 包["车牌"]:
            标题 = html.escape(包["车牌"])
            标题样式 = "车牌标题"
        else:
            标题 = "未识别车牌"
            标题样式 = "车牌标题 未识别"

        # 第一列：每个上传人一行（其在本卡片里第一条消息的时间 + 名字）
        时间人行们 = []
        见过的人 = set()
        for m in 包["消息们"]:
            if m["发送者"] in 见过的人:
                continue
            见过的人.add(m["发送者"])
            点钟 = datetime.fromtimestamp(m["时间"]).strftime("%H:%M") if m["时间"] else ""
            时间人行们.append(
                f'<div class="点钟">{点钟}</div><div class="人名2">{html.escape(取显示名(m["发送者"], 昵称表))}</div>')
        时间人列表html = "".join(时间人行们)

        # 第三列：图片横排
        图们 = []
        for m in 包["消息们"]:
            if m["类型"] == 消息类型_图片:
                if m["图片路径"]:
                    名 = html.escape(m["图片路径"])
                    图们.append(f'<img src="images/{名}" loading="lazy" onclick="放大看图(\'images/{名}\')">')
                else:
                    图们.append('<span class="图占位">[图片读取失败]</span>')
        图片们html = "".join(图们)

        # 第四列：文字分行（多上传人时带名字前缀）
        多人 = len(见过的人) > 1
        文字行们 = []
        for m in 包["消息们"]:
            if m["类型"] == 消息类型_文本 and m["内容"]:
                前缀 = f'{html.escape(取显示名(m["发送者"], 昵称表))}：' if 多人 else ""
                for 行 in 文字分行(m["内容"]):
                    文字行们.append(f"<div>{前缀}{html.escape(行)}</div>")
            elif m["类型"] == 消息类型_语音:
                文字行们.append("<div>[语音消息，请在微信里收听]</div>")
            elif m["类型"] == 消息类型_视频:
                文字行们.append("<div>[视频，请在微信里查看]</div>")
            elif m["类型"] == 消息类型_应用 and m["内容"]:
                摘要 = re.sub(r"<[^>]+>", " ", m["内容"])
                摘要 = re.sub(r"\s+", " ", 摘要).strip()[:60]
                if 摘要:
                    文字行们.append(f"<div>[链接/引用] {html.escape(摘要)}</div>")
        文字们html = "".join(文字行们)

        开始 = datetime.fromtimestamp(包["开始时间"]).strftime("%H:%M") if 包["开始时间"] else ""
        结束 = datetime.fromtimestamp(包["结束时间"]).strftime("%H:%M") if 包["结束时间"] else ""
        起止时间 = f"{开始} ~ {结束}" if 开始 != 结束 else 开始

        卡片们.append(包卡片模板.format(
            包id=html.escape(包["包id"]), 标题=标题, 标题样式=标题样式, 日期=包["日期"],
            起止时间=起止时间, 时间人列表html=时间人列表html,
            图片们html=图片们html, 文字们html=文字们html,
        ))

    看板html = 看板模板.format(
        更新时间=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        包数量=len(包们),
        保留天数=保留天数,
        包列表html="\n".join(卡片们),
        空提示显示='style="display:none"' if 包们 else "",
    )

    看板路径 = 输出目录 / "配件需求看板.html"
    看板路径.write_text(看板html, encoding="utf-8")
    return 看板路径


# ============================================================
# 历史消息持久化与游标（存在工作目录，不放公开输出目录）
# ============================================================

def 加载历史消息(工作目录):
    存档路径 = 工作目录 / "messages.json"
    if not 存档路径.exists():
        return []
    try:
        return json.loads(存档路径.read_text(encoding="utf-8"))
    except Exception:
        return []


def 保存历史消息(工作目录, 消息列表):
    (工作目录 / "messages.json").write_text(
        json.dumps(消息列表, ensure_ascii=False, indent=1), encoding="utf-8")


def 清理过期消息(消息列表):
    截止 = time.time() - 保留天数 * 86400
    return [m for m in 消息列表 if m["时间"] >= 截止]


def 读游标(工作目录):
    游标路径 = 工作目录 / "cursor.json"
    if not 游标路径.exists():
        return {"max_ct": 0, "recent": []}
    try:
        状态 = json.loads(游标路径.read_text(encoding="utf-8"))
        return {"max_ct": int(状态.get("max_ct", 0)), "recent": list(状态.get("recent", []))}
    except Exception:
        return {"max_ct": 0, "recent": []}


def 写游标(工作目录, 游标状态):
    (工作目录 / "cursor.json").write_text(
        json.dumps(游标状态, ensure_ascii=False), encoding="utf-8")


# ============================================================
# 诊断模式：安装后先跑这个，确认环境没问题
# ============================================================

def 诊断模式(配置):
    print("=" * 50)
    print("诊断模式（新引擎）：只跑一次，用于验证环境")
    print("=" * 50)

    print("\n第 1 步：读取 wechat-cli 密钥配置……")
    app = 建上下文()
    if not app:
        print("\n诊断未通过。请按上面提示处理后重试。")
        return
    print(f"  成功。微信数据目录：{app.db_dir}")
    本号 = 本号wxid(app)
    print(f"  当前登录账号：{本号 or '（没识别出来，不影响采集）'}")

    print("\n第 2 步：定位目标群……")
    群上下文们, 没找到 = 定位目标群(app, 配置["目标群列表"])
    for ctx in 群上下文们:
        print(f"  找到群：{ctx['display_name']}（{len(ctx['message_tables'])} 个消息表）")
    for 名 in 没找到:
        print(f"  【警告】没找到群「{名}」：检查群名是否和微信里一字不差、当前账号是否在群里")
    if not 群上下文们:
        print("\n诊断未通过。")
        return

    print("\n第 3 步：试读最近消息……")
    试探游标 = {"max_ct": int(time.time()) - 3600, "recent": []}
    新消息们, _ = 查询新消息(app, 群上下文们, 试探游标)
    print(f"  最近 1 小时读到 {len(新消息们)} 条消息。")
    for m in 新消息们[-5:]:
        预览 = m["内容"][:30] if m["内容"] else f"[类型{m['类型']}]"
        print(f"    {datetime.fromtimestamp(m['时间']).strftime('%H:%M')} {预览}")

    print("\n第 4 步：图片解密链路……")
    aes钥匙, xor钥匙 = 读图片钥匙()
    if not aes钥匙:
        print("  【提示】还没有图片 AES 钥匙（image_key.json 不存在）。")
        print("  群里只发照片不打字的消息将无法显示图片。")
        print("  需要图片时：在微信里点开几张大图，然后运行 提取图片钥匙.py")
    else:
        print("  已有图片 AES 钥匙。")
        图片消息 = next((m for m in reversed(新消息们) if m["类型"] == 消息类型_图片), None)
        if 图片消息:
            图片目录 = 配置["输出目录"] / "images"
            图片目录.mkdir(parents=True, exist_ok=True)
            文件名 = 解密消息图片(图片消息, app, aes钥匙, xor钥匙, 图片目录)
            print(f"  试解最近一张图片：{'成功 → ' + 文件名 if 文件名 else '失败：' + 图片消息.get('_图片错误', '')}")
        else:
            print("  最近 1 小时没有图片消息，跳过试解。")

    print("\n第 5 步：试生成看板……")
    try:
        昵称表 = 加载昵称表(app)
        补发送者(新消息们, 本号)
        包们 = 归堆成需求包(新消息们)
        看板路径 = 生成看板(包们, 昵称表, 配置["输出目录"])
        print(f"  看板已生成：{看板路径}")
    except Exception:
        traceback.print_exc()
        print("  【警告】看板生成失败，请把上面红字截图发给技术人员。")
        return

    print("\n诊断完成。环境没问题的话，直接运行 python poller2.py 开始采集。")


# ============================================================
# 主循环
# ============================================================

def 主循环(配置):
    输出目录 = 配置["输出目录"]
    图片目录 = 输出目录 / "images"
    工作目录 = 配置["工作目录"]
    for 目录 in (输出目录, 图片目录, 工作目录):
        目录.mkdir(parents=True, exist_ok=True)

    print("微信群配件需求采集工具（新引擎） 已启动")
    print(f"目标群：{'、'.join(配置['目标群列表'])}")
    print(f"轮询间隔：{配置['轮询间隔']} 秒")
    print(f"看板文件：{输出目录 / '配件需求看板.html'}")
    print("（关掉本窗口即停止采集）\n")

    app = None
    昵称表 = {}
    群上下文们 = []
    上次刷新昵称 = 0.0
    上次重建上下文 = 0.0

    游标状态 = 读游标(工作目录)
    历史消息 = 加载历史消息(工作目录)
    aes钥匙, xor钥匙 = 读图片钥匙()
    上次升级小图 = 0.0

    # 启动时给历史图片补识别车牌（截图走通用文字识别兜底，只补没识别过的）
    if 配置["OCR启用"]:
        补了 = 0
        for m in 历史消息:
            if m["类型"] == 消息类型_图片 and m.get("图片路径") and not m.get("图片车牌"):
                try:
                    车牌 = 识别图片车牌(图片目录 / m["图片路径"], 配置)
                except Exception:
                    车牌 = ""
                if 车牌:
                    m["图片车牌"] = 车牌
                    补了 += 1
        if 补了:
            保存历史消息(工作目录, 历史消息)
            print(f"历史图片补识别出 {补了} 张车牌")

    while True:
        try:
            # 上下文每小时重建一次（微信重启/换号后能自愈）
            if not app or time.time() - 上次重建上下文 > 3600:
                新上下文 = 建上下文()
                if 新上下文:
                    app = 新上下文
                    上次重建上下文 = time.time()
                if not app:
                    print("等待微信密钥配置……30 秒后重试")
                    time.sleep(30)
                    continue

            # 昵称表每小时刷新一次（新人入群/改昵称能跟上）
            if time.time() - 上次刷新昵称 > 3600 or not 昵称表:
                昵称表 = 加载昵称表(app, 强制刷新=bool(昵称表))
                上次刷新昵称 = time.time()

            # 目标群定位：找不到时每轮都会重试，不会卡死
            if not 群上下文们:
                群上下文们, 没找到 = 定位目标群(app, 配置["目标群列表"])
                if 群上下文们:
                    print(f"已锁定 {len(群上下文们)} 个目标群。")
                else:
                    print("【警告】还没找到目标群，请检查群名配置。30 秒后重试。")
                    time.sleep(30)
                    continue

            新消息们, 新游标 = 查询新消息(app, 群上下文们, 游标状态)

            # 小图升级：只有缩略图的消息，等有人在微信里点开大图后原图落地，自动换成高清并重新识别车牌
            if aes钥匙 and time.time() - 上次升级小图 > 600:
                上次升级小图 = time.time()
                升级了 = 0
                for m in 历史消息:
                    if m["类型"] != 消息类型_图片 or not m.get("图片路径"):
                        continue
                    旧文件 = 图片目录 / m["图片路径"]
                    if not 旧文件.exists() or 旧文件.stat().st_size >= 30 * 1024:
                        continue  # 已经是高清的跳过
                    新文件名 = 解密消息图片(m, app, aes钥匙, xor钥匙, 图片目录)
                    if 新文件名:
                        新文件 = 图片目录 / 新文件名
                        if 新文件.exists() and 新文件.stat().st_size > 旧文件.stat().st_size:
                            m["图片路径"] = 新文件名
                            if 配置["OCR启用"]:
                                车牌 = 识别图片车牌(新文件, 配置)
                                if 车牌:
                                    m["图片车牌"] = 车牌
                                    print(f"  升级高清后识别出车牌：{车牌}")
                            升级了 += 1
                if 升级了:
                    保存历史消息(工作目录, 历史消息)
                    print(f"有 {升级了} 张图片升级成高清版")

            if 新消息们:
                本号 = 本号wxid(app)
                补发送者(新消息们, 本号)
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 收到 {len(新消息们)} 条新消息")
                for 消息 in 新消息们:
                    if 消息["类型"] == 消息类型_图片:
                        消息["图片路径"] = 解密消息图片(消息, app, aes钥匙, xor钥匙, 图片目录)
                        if 消息["图片路径"] and 配置["OCR启用"]:
                            车牌 = 识别图片车牌(图片目录 / 消息["图片路径"], 配置)
                            if 车牌:
                                消息["图片车牌"] = 车牌
                                print(f"  照片识别出车牌：{车牌}")
                        elif not 消息["图片路径"]:
                            print(f"  图片解密失败：{消息.get('_图片错误', '')}")
                历史消息.extend(新消息们)
                历史消息 = 清理过期消息(历史消息)
                保存历史消息(工作目录, 历史消息)
                写游标(工作目录, 新游标)
                游标状态 = 新游标

            # 无论有没有新消息都重新生成看板（更新时间戳）
            包们 = 归堆成需求包(历史消息)
            看板路径 = 生成看板(包们, 昵称表, 输出目录)
            if 新消息们:
                print(f"  看板已更新：{看板路径}")

            time.sleep(配置["轮询间隔"])

        except KeyboardInterrupt:
            print("\n已手动停止。历史消息已保存，下次启动继续。")
            break
        except Exception:
            print("【错误】本轮采集出现异常：")
            traceback.print_exc()
            print("60 秒后自动重试。若反复报错，请把上面红字截图发给技术人员。")
            app = None  # 出错后下轮重建上下文（应对微信重启/升级）
            time.sleep(60)


def main():
    配置 = 读取配置()
    if "--test" in sys.argv:
        诊断模式(配置)
    else:
        主循环(配置)


if __name__ == "__main__":
    main()
