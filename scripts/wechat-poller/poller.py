#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信群配件需求采集小工具

工作原理（通俗版）：
  微信在电脑上把聊天记录存在一个加密的本地数据库里。
  本脚本借助 PyWxDump 拿到"钥匙"，每隔一会儿把数据库解密复制一份，
  找出目标群里的新消息，自动按"同一个人、5分钟内"归堆成一个个"需求包"，
  生成一个网页看板（HTML 文件），双击打开就能看。

用法：
  python poller.py            正式运行（持续轮询）
  python poller.py --test     诊断模式（只跑一次，打印读到了什么，用于安装后验证）

作者备注：所有提示信息均为中文，出错时会尽量给出通俗的解决建议。
"""

import configparser
import html
import json
import re
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

# 控制台按 UTF-8 输出，避免老电脑上中文/符号打印报错（失败也不影响运行）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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

# 微信消息类型（Type 字段）
消息类型_文本 = 1
消息类型_图片 = 3
消息类型_语音 = 34
消息类型_视频 = 43
消息类型_表情 = 47
消息类型_应用 = 49   # 引用、链接、文件、转账等
消息类型_系统 = 10000


# ============================================================
# 配置读取
# ============================================================

def 读取配置():
    """读取同目录下的 config.ini，返回配置字典。缺配置时给出通俗提示并退出。"""
    配置路径 = Path(__file__).parent / "config.ini"
    if not 配置路径.exists():
        print(f"【错误】找不到配置文件：{配置路径}")
        print("请确认 config.ini 和 poller.py 放在同一个文件夹里。")
        sys.exit(1)

    解析器 = configparser.ConfigParser()
    解析器.read(配置路径, encoding="utf-8")

    群名原文 = 解析器.get("wechat", "groups", fallback="").strip()
    if not 群名原文:
        print("【错误】config.ini 里的 groups 没填。")
        print("请打开 config.ini，把目标群的群名填在 groups = 后面，保存后重新运行。")
        sys.exit(1)

    return {
        "目标群列表": [g.strip() for g in 群名原文.split(",") if g.strip()],
        "轮询间隔": max(5, 解析器.getint("wechat", "interval", fallback=30)),
        "输出目录": Path(解析器.get("paths", "output", fallback="./输出")).resolve(),
    }


# ============================================================
# 微信数据库钥匙与解密（依赖 PyWxDump）
# ============================================================

def 获取微信钥匙():
    """
    从正在运行的微信进程里读取数据库密钥。
    返回 (密钥, 微信数据目录)。失败时返回 (None, None) 并打印原因。
    """
    try:
        from pywxdump import get_wx_info
    except ImportError:
        print("【错误】没有安装 PyWxDump。")
        print("请先运行：pip install -r requirements.txt")
        return None, None

    try:
        信息列表 = get_wx_info()
    except Exception as 异常:
        print(f"【错误】读取微信信息失败：{异常}")
        print("常见原因：微信没有登录。请先登录微信小号，再运行本脚本。")
        return None, None

    if not 信息列表:
        print("【错误】没有读到任何微信账号信息。请确认微信已经登录。")
        return None, None

    账号 = 信息列表[0]
    密钥 = 账号.get("key")
    数据目录 = 账号.get("filePath") or 账号.get("file_path") or ""
    if not 密钥:
        print("【错误】拿到了微信信息但密钥为空。")
        print("可能微信版本太新，PyWxDump 还没适配。请把本提示截图发给技术人员。")
        return None, None

    return 密钥, 数据目录


def 解密联系人库(密钥, 数据目录, 工作目录):
    """
    解密 MicroMsg.db（里面有群列表和好友昵称）。
    返回解密后的 sqlite 文件路径；失败返回 None。
    联系人变动少，脚本启动时解密一次即可。
    """
    from pywxdump import decrypt

    源文件们 = list(Path(数据目录).rglob("MicroMsg.db"))
    if not 源文件们:
        print("【警告】没找到 MicroMsg.db，昵称将无法显示（不影响消息采集）。")
        return None

    目标 = 工作目录 / "MicroMsg_decrypted.db"
    try:
        结果 = decrypt(密钥, str(源文件们[0]), str(目标))
        # 不同版本返回值不同：可能返回目标路径，也可能返回 (是否成功, 路径)
        if isinstance(结果, (list, tuple)):
            成功 = 结果[0]
            if not 成功:
                raise RuntimeError(str(结果))
        return 目标
    except Exception as 异常:
        print(f"【警告】解密联系人库失败：{异常}（昵称将无法显示，不影响消息采集）")
        return None


def 解密消息库们(密钥, 数据目录, 工作目录):
    """
    把微信正在使用的消息数据库（MSG0.db、MSG1.db……）实时合并解密到工作目录。
    返回解密后的消息库文件路径列表。
    """
    from pywxdump import merge_real_time_db

    # 微信的消息库存放在 数据目录/Msg/Multi/ 下，文件名形如 MSG0.db、MSG1.db
    源目录 = Path(数据目录) / "Msg" / "Multi"
    if not 源目录.exists():
        # 部分版本目录结构不同，退而求其次全目录搜索
        源文件们 = sorted(Path(数据目录).rglob("MSG*.db"))
    else:
        源文件们 = sorted(p for p in 源目录.glob("MSG*.db") if not p.name.endswith((".shm", ".wal")))

    解密结果 = []
    for 源文件 in 源文件们:
        目标 = 工作目录 / f"{源文件.stem}_decrypted.db"
        try:
            # merge_real_time_db 会把微信运行中的数据库安全地合并复制并解密
            merge_real_time_db(密钥, str(源文件), str(目标))
            解密结果.append(目标)
        except Exception as 异常:
            print(f"【警告】解密 {源文件.name} 失败：{异常}")
    return 解密结果


# ============================================================
# 消息读取与解析
# ============================================================

def 加载昵称表(联系人库路径):
    """
    从解密后的联系人库里读取 "wxid -> 昵称" 对照表（含群名）。
    返回字典；失败返回空字典。
    """
    昵称表 = {}
    if not 联系人库路径 or not Path(联系人库路径).exists():
        return 昵称表
    try:
        连接 = sqlite3.connect(str(联系人库路径))
        # Contact 表：UserName 是 wxid/群id，NickName 是昵称/群名
        行们 = 连接.execute(
            "SELECT UserName, NickName FROM Contact WHERE NickName != ''"
        ).fetchall()
        for wxid, 昵称 in 行们:
            if wxid and 昵称:
                昵称表[wxid] = 昵称
        连接.close()
    except Exception as 异常:
        print(f"【警告】读取昵称表失败：{异常}（将显示原始账号）")
    return 昵称表


def 从BytesExtra找发送者(原始字节):
    """
    群消息的发送者藏在 BytesExtra 二进制字段里。
    用正则从二进制里找 wxid_xxxx 或 纯字母数字账号。
    找不到返回空字符串。
    """
    if not 原始字节:
        return ""
    try:
        匹配 = re.findall(rb"(wxid_[a-z0-9]+)", 原始字节)
        if 匹配:
            return 匹配[0].decode("utf-8", errors="ignore")
        # 有些账号是字母数字组合（非 wxid_ 开头），在群 id 之后出现，这里做保守兜底
        匹配 = re.findall(rb"\x12.{0,4}?([a-zA-Z][a-zA-Z0-9_-]{5,19})\x00?", 原始字节)
        if 匹配:
            候选 = 匹配[0].decode("utf-8", errors="ignore")
            if "@chatroom" not in 候选:
                return 候选
    except Exception:
        pass
    return ""


def 查询新消息(消息库们, 目标群id们, 游标):
    """
    从解密后的消息库里查询目标群的新消息（MsgSvrSeq 大于游标的）。
    返回 (消息列表, 新游标)。每条消息是字典。
    """
    新消息 = []
    最大序号 = 游标

    for 库路径 in 消息库们:
        try:
            连接 = sqlite3.connect(str(库路径))
            连接.text_factory = bytes  # 原始字节读出，自己控制解码，避免个别坏字符弄崩
            # MSG 表：StrTalker 是群id，MsgSvrSeq 是服务器消息序号（全局递增，可当唯一主键）
            占位符 = ",".join("?" * len(目标群id们))
            行们 = 连接.execute(
                f"SELECT MsgSvrSeq, Type, IsSender, CreateTime, StrContent, StrTalker, BytesExtra "
                f"FROM MSG WHERE StrTalker IN ({占位符}) AND MsgSvrSeq > ? "
                f"ORDER BY MsgSvrSeq",
                (*目标群id们, 游标),
            ).fetchall()
            连接.close()
        except sqlite3.OperationalError:
            # 该库里没有 MSG 表（比如空库），跳过
            continue
        except Exception as 异常:
            print(f"【警告】读取消息库 {库路径.name} 失败：{异常}")
            continue

        for 序号, 类型, 是否自己, 创建时间, 内容字节, 群id, 附加字节 in 行们:
            内容 = ""
            if 内容字节:
                内容 = 内容字节.decode("utf-8", errors="ignore") if isinstance(内容字节, bytes) else str(内容字节)
            群id文本 = 群id.decode("utf-8", errors="ignore") if isinstance(群id, bytes) else str(群id or "")

            # 发送者：自己发的标记"我"；群消息从 BytesExtra 里解析
            if 是否自己 == 1:
                发送者 = "__自己__"
            else:
                发送者 = 从BytesExtra找发送者(附加字节)

            新消息.append({
                "id": str(序号),
                "类型": 类型,
                "发送者": 发送者,
                "群id": 群id文本,
                "时间": int(创建时间 or 0),
                "内容": 内容.strip(),
                "图片路径": "",  # 图片消息稍后填充
            })
            if 序号 > 最大序号:
                最大序号 = 序号

    return 新消息, 最大序号


# ============================================================
# 图片消息处理（微信图片以加密的 .dat 文件存在硬盘上）
# ============================================================

def 寻找并解密图片(消息, 数据目录, 图片输出目录):
    """
    给一条图片消息找到对应的 .dat 文件并解密成普通图片。
    定位思路：微信按 会话/年月 分目录存放图片 dat 文件，
    按消息时间定位目录，再找文件名里含消息时间特征的文件。
    找不到/解密失败返回空字符串（看板上显示"图片请在微信里查看"）。
    """
    try:
        from pywxdump import decode_dat  # 部分版本函数名不同，失败会在下面捕获
    except ImportError:
        try:
            from pywxdump.wx_info import decode_dat  # type: ignore
        except Exception:
            return ""

    消息时间 = datetime.fromtimestamp(消息["时间"]) if 消息["时间"] else None
    if not 消息时间:
        return ""

    # 候选目录：MsgAttach/{群id}/Img/{年-月}/
    年月 = 消息时间.strftime("%Y-%m")
    候选目录们 = [
        Path(数据目录) / "FileStorage" / "MsgAttach" / 消息["群id"] / "Img" / 年月,
        Path(数据目录) / "MsgAttach" / 消息["群id"] / "Img" / 年月,
    ]

    for 目录 in 候选目录们:
        if not 目录.exists():
            continue
        # 按文件修改时间找与消息时间最接近的 dat 文件（±10分钟内）
        候选文件们 = []
        for dat文件 in 目录.glob("*.dat"):
            try:
                文件时间 = dat文件.stat().st_mtime
                差 = abs(文件时间 - 消息["时间"])
                if 差 <= 600:
                    候选文件们.append((差, dat文件))
            except OSError:
                continue
        if not 候选文件们:
            continue
        候选文件们.sort(key=lambda x: x[0])
        dat文件 = 候选文件们[0][1]

        try:
            目标文件 = 图片输出目录 / f"{消息['id']}.jpg"
            结果 = decode_dat(str(dat文件), str(目标文件))
            # 返回值形态不一：有的版本返回路径，有的直接写出文件
            if 目标文件.exists():
                return 目标文件.name
            if isinstance(结果, str) and Path(结果).exists():
                return Path(结果).name
        except Exception:
            continue
    return ""


# ============================================================
# 归堆：把连续消息按"同一个人 + 时间窗口"打包
# ============================================================

def 归堆成需求包(消息列表):
    """
    把消息列表按时间排序后，同一个人、相邻间隔不超过归堆窗口的消息归为一包。
    返回需求包列表（新的在前）。每个包含：包id、发送者、起止时间、文字列表、图片列表、识别到的车牌。
    """
    排序后 = sorted(消息列表, key=lambda m: (m["时间"], m["id"]))

    包们 = []
    当前包 = None
    for 消息 in 排序后:
        # 系统消息（入群通知等）不进包，直接跳过
        if 消息["类型"] == 消息类型_系统:
            continue

        属于当前包 = (
            当前包 is not None
            and 消息["发送者"] == 当前包["发送者"]
            and 消息["群id"] == 当前包["群id"]
            and 消息["时间"] - 当前包["结束时间"] <= 归堆窗口秒
        )
        if not 属于当前包:
            当前包 = {
                "包id": f"{消息['id']}_{消息['发送者']}",
                "发送者": 消息["发送者"],
                "群id": 消息["群id"],
                "开始时间": 消息["时间"],
                "结束时间": 消息["时间"],
                "文字列表": [],
                "图片列表": [],
            }
            包们.append(当前包)
        当前包["结束时间"] = 消息["时间"]

        if 消息["类型"] == 消息类型_图片:
            if 消息["图片路径"]:
                当前包["图片列表"].append(消息["图片路径"])
            else:
                当前包["文字列表"].append("[图片读取失败，请在微信里查看]")
        elif 消息["类型"] == 消息类型_文本 and 消息["内容"]:
            当前包["文字列表"].append(消息["内容"])
        elif 消息["类型"] == 消息类型_语音:
            当前包["文字列表"].append("[语音消息，请在微信里收听]")
        elif 消息["类型"] == 消息类型_视频:
            当前包["文字列表"].append("[视频，请在微信里查看]")
        elif 消息["类型"] == 消息类型_应用 and 消息["内容"]:
            # 引用/链接类消息，截取一小段提示
            摘要 = re.sub(r"<[^>]+>", " ", 消息["内容"])
            摘要 = re.sub(r"\s+", " ", 摘要).strip()[:60]
            if 摘要:
                当前包["文字列表"].append(f"[链接/引用] {摘要}")

    # 从文字里识别车牌号
    for 包 in 包们:
        全部文字 = " ".join(包["文字列表"])
        包["车牌列表"] = sorted(set(车牌正则.findall(全部文字.upper())))

    包们.sort(key=lambda p: p["开始时间"], reverse=True)
    return 包们


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
  .包头部 {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }}
  .发送人 {{ font-weight: 600; font-size: 15px; }}
  .车牌标签 {{ display: inline-block; background: #dcfce7; color: #166534; border-radius: 4px;
              padding: 1px 8px; font-size: 13px; font-weight: 600; margin-left: 8px; }}
  .时刻 {{ color: #9ca3af; font-size: 12px; }}
  .文字行 {{ font-size: 14px; color: #111827; margin: 4px 0; white-space: pre-wrap; word-break: break-all; }}
  .照片墙 {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }}
  .照片墙 img {{ width: 120px; height: 120px; object-fit: cover; border-radius: 8px;
                border: 1px solid #e5e7eb; cursor: zoom-in; }}
  .处理行 {{ margin-top: 10px; border-top: 1px dashed #e5e7eb; padding-top: 8px; font-size: 13px; color: #374151; }}
  .处理行 input[type=text] {{ width: 60%; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; }}
  .空提示 {{ max-width: 800px; margin: 40px auto; text-align: center; color: #9ca3af; }}
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
<script>
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
  <div class="包头部">
    <div><span class="发送人">{发送人}</span>{车牌标签}</div>
    <div class="时刻">{起止时间}</div>
  </div>
  {文字html}
  {照片墙html}
  <div class="处理行">
    <label><input type="checkbox"> 已处理</label>　备注：<input type="text" placeholder="如：已下单 / 库里">
  </div>
</div>
"""


def 生成看板(包们, 昵称表, 输出目录):
    """根据需求包列表生成自包含的 HTML 看板文件。所有用户来源文本先转义再进 HTML。"""
    卡片们 = []
    for 包 in 包们:
        发送人显示 = 昵称表.get(包["发送者"], "") or ("我自己" if 包["发送者"] == "__自己__" else 包["发送者"][-6:] if 包["发送者"] else "未知")
        发送人显示 = html.escape(发送人显示)
        车牌标签 = "".join(f'<span class="车牌标签">{html.escape(p)}</span>' for p in 包["车牌列表"])
        开始 = datetime.fromtimestamp(包["开始时间"]).strftime("%m-%d %H:%M") if 包["开始时间"] else ""
        结束 = datetime.fromtimestamp(包["结束时间"]).strftime("%H:%M") if 包["结束时间"] else ""
        起止时间 = f"{开始} ~ {结束}" if 开始 != 结束 else 开始

        文字html = "".join(f'<div class="文字行">{html.escape(行)}</div>' for 行 in 包["文字列表"])
        if 包["图片列表"]:
            照片们 = "".join(
                f'<a href="images/{html.escape(名)}" target="_blank"><img src="images/{html.escape(名)}" loading="lazy"></a>'
                for 名 in 包["图片列表"]
            )
            照片墙html = f'<div class="照片墙">{照片们}</div>'
        else:
            照片墙html = ""

        卡片们.append(包卡片模板.format(
            包id=html.escape(包["包id"]), 发送人=发送人显示, 车牌标签=车牌标签,
            起止时间=起止时间, 文字html=文字html, 照片墙html=照片墙html,
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
# 历史消息持久化（脚本重启不丢）
# ============================================================

def 加载历史消息(输出目录):
    存档路径 = 输出目录 / "messages.json"
    if not 存档路径.exists():
        return []
    try:
        return json.loads(存档路径.read_text(encoding="utf-8"))
    except Exception:
        return []


def 保存历史消息(输出目录, 消息列表):
    存档路径 = 输出目录 / "messages.json"
    存档路径.write_text(json.dumps(消息列表, ensure_ascii=False, indent=1), encoding="utf-8")


def 清理过期消息(消息列表):
    截止 = time.time() - 保留天数 * 86400
    return [m for m in 消息列表 if m["时间"] >= 截止]


# ============================================================
# 游标（记录上次处理到哪条消息，断点续推）
# ============================================================

def 读游标(输出目录):
    游标路径 = 输出目录 / "cursor.txt"
    if not 游标路径.exists():
        return 0
    try:
        return int(游标路径.read_text().strip())
    except ValueError:
        return 0


def 写游标(输出目录, 游标):
    (输出目录 / "cursor.txt").write_text(str(游标))


# ============================================================
# 诊断模式：安装后先跑这个，确认环境没问题
# ============================================================

def 诊断模式(配置):
    print("=" * 50)
    print("诊断模式：只跑一次，不上传不保存，用于验证环境")
    print("=" * 50)

    print("\n第 1 步：读取微信密钥……")
    密钥, 数据目录 = 获取微信钥匙()
    if not 密钥:
        print("\n诊断未通过。请按上面提示处理后重试。")
        return
    print(f"  成功。微信数据目录：{数据目录}")

    工作目录 = 配置["输出目录"] / "_工作区"
    工作目录.mkdir(parents=True, exist_ok=True)

    print("\n第 2 步：解密联系人库（找群名和昵称）……")
    联系人库 = 解密联系人库(密钥, 数据目录, 工作目录)
    昵称表 = 加载昵称表(联系人库)
    print(f"  读到 {len(昵称表)} 个联系人/群昵称。")

    print("\n第 3 步：在群列表里找目标群……")
    目标群列表 = 配置["目标群列表"]
    群id到群名 = {wxid: 名 for wxid, 名 in 昵称表.items() if wxid.endswith("@chatroom")}
    找到的群id们 = []
    for 群名 in 目标群列表:
        命中 = [wxid for wxid, 名 in 群id到群名.items() if 名 == 群名]
        if 命中:
            print(f"  [成功] 找到群「{群名}」")
            找到的群id们.extend(命中)
        else:
            print(f"  [失败] 没找到群「{群名}」")
            现有群名 = [名 for 名 in 群id到群名.values()][:10]
            print(f"      当前小号在的群（前10个）：{'、'.join(现有群名) if 现有群名 else '（一个都没读到）'}")
            print("      请检查：①小号是否已进群 ②config.ini 里的群名是否和微信里一字不差")
    if not 找到的群id们:
        print("\n诊断未通过：一个目标群都没找到。")
        return

    print("\n第 4 步：解密消息库……")
    消息库们 = 解密消息库们(密钥, 数据目录, 工作目录)
    if not 消息库们:
        print("\n诊断未通过：没有解密出任何消息库。请把上面提示截图发给技术人员。")
        return
    print(f"  解密出 {len(消息库们)} 个消息库。")

    print("\n第 5 步：读取目标群最近 10 条消息……")
    消息们, _ = 查询新消息(消息库们, 找到的群id们, 0)
    最近 = sorted(消息们, key=lambda m: m["时间"])[-10:]
    if not 最近:
        print("  群里暂时没有消息记录。")
        print("  请在群里发一条测试消息（比如发一张车牌照片+一行字），等 1 分钟后再跑一次诊断。")
    for 消息 in 最近:
        时刻 = datetime.fromtimestamp(消息["时间"]).strftime("%m-%d %H:%M")
        类型名 = {1: "文本", 3: "图片", 34: "语音", 43: "视频", 47: "表情", 49: "应用", 10000: "系统"}.get(消息["类型"], str(消息["类型"]))
        发送者 = 昵称表.get(消息["发送者"], 消息["发送者"] or "未知")
        内容预览 = (消息["内容"][:30] + "…") if len(消息["内容"]) > 30 else 消息["内容"]
        print(f"  [{时刻}] {发送者}（{类型名}）: {内容预览}")

    print("\n" + "=" * 50)
    print("诊断完成！上面能看到群消息就说明环境没问题。")
    print("接下来直接运行 python poller.py 即可开始采集。")
    print("=" * 50)


# ============================================================
# 主循环
# ============================================================

def 主循环(配置):
    输出目录 = 配置["输出目录"]
    图片目录 = 输出目录 / "images"
    工作目录 = 输出目录 / "_工作区"
    for 目录 in (输出目录, 图片目录, 工作目录):
        目录.mkdir(parents=True, exist_ok=True)

    print("微信群配件需求采集工具 已启动")
    print(f"目标群：{'、'.join(配置['目标群列表'])}")
    print(f"轮询间隔：{配置['轮询间隔']} 秒")
    print(f"看板文件：{输出目录 / '配件需求看板.html'}")
    print("（关掉本窗口即停止采集）\n")

    密钥 = None
    数据目录 = None
    联系人库 = None
    昵称表 = {}
    目标群id们 = []
    上次刷新昵称 = 0.0

    游标 = 读游标(输出目录)
    历史消息 = 加载历史消息(输出目录)

    while True:
        try:
            # 密钥失效（微信重启）时自动重新获取
            if not 密钥:
                密钥, 数据目录 = 获取微信钥匙()
                if not 密钥:
                    print("等待微信登录……30 秒后重试")
                    time.sleep(30)
                    continue

            # 昵称表每小时刷新一次（新人入群/改昵称能跟上）
            if time.time() - 上次刷新昵称 > 3600 or not 昵称表:
                新联系人库 = 解密联系人库(密钥, 数据目录, 工作目录)
                if 新联系人库:
                    联系人库 = 新联系人库
                昵称表 = 加载昵称表(联系人库)
                上次刷新昵称 = time.time()

            # 目标群定位放在昵称刷新分支之外：找不到时每轮都会重试，不会卡死
            if 昵称表 and not 目标群id们:
                目标群id们 = [wxid for wxid, 名 in 昵称表.items()
                              if 名 in 配置["目标群列表"] and wxid.endswith("@chatroom")]
                if 目标群id们:
                    print(f"已锁定 {len(目标群id们)} 个目标群。")
                else:
                    print("【警告】还没找到目标群，请检查群名配置。30 秒后重试。")
                    time.sleep(30)
                    continue
            if not 目标群id们:
                # 昵称表还没读到（联系人库解密失败等），等下一轮刷新
                time.sleep(30)
                continue

            # 解密消息库并读出目标群新消息
            消息库们 = 解密消息库们(密钥, 数据目录, 工作目录)
            新消息们, 新游标 = 查询新消息(消息库们, 目标群id们, 游标)

            if 新消息们:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 收到 {len(新消息们)} 条新消息")
                # 图片消息逐条尝试解密
                for 消息 in 新消息们:
                    if 消息["类型"] == 消息类型_图片:
                        消息["图片路径"] = 寻找并解密图片(消息, 数据目录, 图片目录)
                历史消息.extend(新消息们)
                历史消息 = 清理过期消息(历史消息)
                保存历史消息(输出目录, 历史消息)
                写游标(输出目录, 新游标)
                游标 = 新游标

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
            # 出错后重置密钥，下一轮重新获取（应对微信重启/升级）
            密钥 = None
            time.sleep(60)


def main():
    配置 = 读取配置()
    if "--test" in sys.argv:
        诊断模式(配置)
    else:
        主循环(配置)


if __name__ == "__main__":
    main()
