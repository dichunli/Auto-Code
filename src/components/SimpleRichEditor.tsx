"use client";

import { useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function SimpleRichEditor({ value, onChange, placeholder = "请输入内容..." }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeCommands, setActiveCommands] = useState<Set<string>>(new Set());

  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    updateActiveCommands();
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }

  function updateActiveCommands() {
    const cmds = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];
    const active = new Set<string>();
    cmds.forEach((cmd) => {
      try {
        if (document.queryCommandState(cmd)) active.add(cmd);
      } catch {}
    });
    setActiveCommands(active);
  }

  function handleInput() {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
    updateActiveCommands();
  }

  function insertLink() {
    const url = prompt("输入链接地址:");
    if (url) exec("createLink", url);
  }

  function insertVideo() {
    const url = prompt("输入视频链接（支持 B站、抖音、快手等）:\n也可以直接粘贴 <iframe> 嵌入代码");
    if (!url) return;
    let embedHtml = "";
    // B站
    const bvidMatch = url.match(/bilibili\.com\/video\/(BV[\w]+)/i);
    if (bvidMatch) {
      embedHtml = `<iframe src="https://player.bilibili.com/player.html?bvid=${bvidMatch[1]}&page=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%;height:360px;max-width:640px;display:block;margin:8px 0;"></iframe>`;
    } else if (url.trim().startsWith("<iframe")) {
      // 直接粘贴 iframe
      embedHtml = url.trim();
    } else {
      // 通用链接转为可点击的卡片
      embedHtml = `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:8px 0;"><a href="${url}" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:500;">🎬 点击观看视频: ${url}</a></div>`;
    }
    if (embedHtml) {
      exec("insertHTML", embedHtml);
    }
  }

  function insertImage() {
    const url = prompt("输入图片地址:");
    if (url) exec("insertImage", url);
  }

  function clearFormat() {
    exec("removeFormat");
    exec("formatBlock", "div");
  }

  const btnBase = "px-2 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 transition-colors";
  const btnActive = "px-2 py-1 text-xs rounded border border-blue-300 bg-blue-50 text-blue-700";

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
        <button type="button" onClick={() => exec("bold")} className={activeCommands.has("bold") ? btnActive : btnBase}><b>B</b></button>
        <button type="button" onClick={() => exec("italic")} className={activeCommands.has("italic") ? btnActive : btnBase}><i>I</i></button>
        <button type="button" onClick={() => exec("underline")} className={activeCommands.has("underline") ? btnActive : btnBase}><u>U</u></button>
        <button type="button" onClick={() => exec("strikeThrough")} className={activeCommands.has("strikeThrough") ? btnActive : btnBase}>S</button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" onClick={() => exec("formatBlock", "H3")} className={btnBase}>标题</button>
        <button type="button" onClick={() => exec("formatBlock", "P")} className={btnBase}>正文</button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" onClick={() => exec("insertUnorderedList")} className={activeCommands.has("insertUnorderedList") ? btnActive : btnBase}>• 列表</button>
        <button type="button" onClick={() => exec("insertOrderedList")} className={activeCommands.has("insertOrderedList") ? btnActive : btnBase}>1. 列表</button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" onClick={insertLink} className={btnBase}>链接</button>
        <button type="button" onClick={insertImage} className={btnBase}>图片</button>
        <button type="button" onClick={insertVideo} className={btnBase}>视频</button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" onClick={clearFormat} className={btnBase}>清除格式</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="px-3 py-2 text-sm min-h-[200px] outline-none"
        style={{ lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: value || `<p>${placeholder}</p>` }}
        onInput={handleInput}
        onKeyUp={updateActiveCommands}
        onMouseUp={updateActiveCommands}
        onFocus={(e) => {
          if (!value && e.currentTarget.innerHTML === `<p>${placeholder}</p>`) {
            e.currentTarget.innerHTML = "<p><br></p>";
          }
        }}
        onBlur={(e) => {
          if (!value && e.currentTarget.innerText.trim() === "") {
            e.currentTarget.innerHTML = `<p>${placeholder}</p>`;
          }
          onChange(e.currentTarget.innerHTML);
        }}
      />
    </div>
  );
}
