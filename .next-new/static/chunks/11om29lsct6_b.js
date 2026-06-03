(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,95187,(e,t,i)=>{"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={callServer:function(){return r.callServer},createServerReference:function(){return s.createServerReference},findSourceMapURL:function(){return a.findSourceMapURL}};for(var o in n)Object.defineProperty(i,o,{enumerable:!0,get:n[o]});let r=e.r(32120),a=e.r(92245),s=e.r(35326)},94542,e=>{"use strict";e.i(47167);var t=e.i(43476),i=e.i(71645),n=e.i(11795),o=e.i(95187);let r=(0,o.createServerReference)("40cf3acbc32f6741011e57682c4a94be66f3c8ed49",o.callServer,void 0,o.findSourceMapURL,"logLogin");e.s(["default",0,function(){let[e,o]=(0,i.useState)(""),[a,s]=(0,i.useState)(""),[l,c]=(0,i.useState)(!1),[d,p]=(0,i.useState)(""),[g,u]=(0,i.useState)("检测中..."),[f,x]=(0,i.useState)(null);async function m(){if(alert("点击了登录按钮"),!f){alert("supabase 未初始化，尝试直接创建...");try{let e=(0,n.createClient)();x(e),await h(e);return}catch(t){let e=t instanceof Error?t.message:String(t);alert("创建客户端失败: "+e),p("登录服务初始化失败: "+e),c(!1);return}}await h(f)}async function h(t){c(!0),p("");let i={password:a,email:""};/^1[3-9]\d{9}$/.test(e)?i.email="phone-"+e+"@auto.local":i.email=e;try{let{data:n,error:o}=await Promise.race([t.auth.signInWithPassword(i),new Promise((e,t)=>setTimeout(()=>t(Error("登录请求超时，请检查网络连接或刷新页面重试")),1e4))]);if(o){p(o.message||"登录失败，请检查账号密码"),c(!1);return}if(!n.session){p("登录成功但未获取到会话，请检查网络或 Supabase 配置"),c(!1);return}r({userId:n.user?.id||"",userName:n.user?.email||e,description:`用户 ${e} 登录系统`}).catch(()=>{});let a=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);window.location.href=a?"/m":"/"}catch(e){p("登录请求失败: "+(e instanceof Error?e.message:"网络错误或浏览器安全策略阻止了请求")),c(!1)}}return(0,i.useEffect)(()=>{u((0,n["获取当前环境"])()),x((0,n.createClient)())},[]),(0,i.useEffect)(()=>{function e(e){if(e.persisted){let e=window;!e.Capacitor&&!e.CapacitorIsNative&&(document.cookie.includes("sb-")||window.localStorage.getItem("sb-"))&&(window.location.href="/")}}return window.addEventListener("pageshow",e),()=>window.removeEventListener("pageshow",e)},[]),(0,i.useEffect)(()=>{"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(()=>{})},[]),(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("div",{dangerouslySetInnerHTML:{__html:`
        <script id="native-login-script">
          (function() {
            /* 如果React加载成功，让React接管；否则原生登录作为fallback */
            window._nativeLoginInit = function() {
              var accountEl = document.getElementById('login-account');
              var passwordEl = document.getElementById('login-password');
              var account = accountEl ? accountEl.value : '';
              var password = passwordEl ? passwordEl.value : '';

              if (!account || !password) {
                alert('请输入账号和密码');
                return;
              }

              var isPhone = /^1[3-9]\\d{9}$/.test(account);
              var email = isPhone ? 'phone-' + account + '@auto.local' : account;

              var SUPABASE_URL = 'https://eyyhcdoftwhhpexteuvz.supabase.co';
              var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5eWhjZG9mdHdoaHBleHRldXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MzYwNDEsImV4cCI6MjA5MzIxMjA0MX0.tbFfZs1tg2NRX7i0X8qNsB97zdOm84PGSaJMhuwZzkI';

              fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: email, password: password })
              })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.error) {
                  alert('登录失败: ' + (data.error_description || data.error || '未知错误'));
                  return;
                }
                if (data.access_token) {
                  var tokenKey = 'sb-' + SUPABASE_URL.replace('https://', '').split('.')[0] + '-auth-token';
                  localStorage.setItem(tokenKey, JSON.stringify(data));
                  /* 同时写入cookie，让服务端也能识别 */
                  var maxAge = 400 * 24 * 60 * 60;
                  document.cookie = tokenKey + '=' + encodeURIComponent(JSON.stringify(data)) + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
                  alert('✅ 登录成功！正在跳转...');
                  window.location.href = '/m';
                } else {
                  alert('登录响应异常，没有获取到token');
                }
              })
              .catch(function(err) {
                alert('登录请求失败: ' + (err.message || String(err)));
              });
            };
          })();
        </script>
      `}}),(0,t.jsx)("style",{dangerouslySetInnerHTML:{__html:`
        .login-root { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f9fafb; padding:0 16px; font-family:system-ui,-apple-system,sans-serif; }
        .login-card { width:100%; max-width:400px; background:#fff; border-radius:12px; border:1px solid #e5e7eb; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
        @media (min-width:768px){ .login-card { padding:32px; } }
        .login-logo { display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:24px; }
        @media (min-width:768px){ .login-logo { margin-bottom:32px; } }
        .login-logo-box { width:40px; height:40px; background:#2563eb; border-radius:8px; display:flex; align-items:center; justify:center; flex-shrink:0; }
        .login-logo-text { color:#fff; font-weight:700; font-size:18px; }
        .login-title { font-size:20px; font-weight:700; color:#111827; }
        @media (min-width:768px){ .login-title { font-size:24px; } }
        .login-form { display:flex; flex-direction:column; gap:16px; }
        .login-label { display:block; font-size:14px; font-weight:500; color:#374151; margin-bottom:4px; }
        .login-input { width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:16px; outline:none; box-sizing:border-box; }
        .login-input:focus { border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,0.2); }
        .login-error { font-size:14px; color:#dc2626; background:#fef2f2; padding:10px 12px; border-radius:8px; }
        .login-btn { width:100%; padding:12px; font-size:14px; font-weight:500; color:#fff; background:#2563eb; border:none; border-radius:8px; cursor:pointer; }
        .login-btn:disabled { opacity:0.5; cursor:not-allowed; }
        .login-hint { margin-top:24px; text-align:center; font-size:12px; color:#9ca3af; }
        /* 移动端：内容靠上对齐，防止键盘弹出遮挡输入框 */
        @media (max-width:767px){ .login-root { align-items:flex-start; padding-top:60px; } }
      `}}),(0,t.jsx)("noscript",{children:(0,t.jsxs)("div",{style:{padding:"20px",textAlign:"center",color:"#dc2626",background:"#fef2f2",borderRadius:"8px",margin:"20px"},children:[(0,t.jsx)("strong",{children:"请启用JavaScript"}),(0,t.jsx)("br",{}),"您的浏览器禁用了JavaScript，无法登录。请换用Chrome浏览器或开启JavaScript后刷新。"]})}),(0,t.jsx)("div",{className:"login-root",children:(0,t.jsxs)("div",{className:"login-card",children:[(0,t.jsxs)("div",{className:"login-logo",children:[(0,t.jsx)("div",{className:"login-logo-box",children:(0,t.jsx)("span",{className:"login-logo-text",children:"修"})}),(0,t.jsx)("h1",{className:"login-title",children:"汽修管家"})]}),(0,t.jsxs)("div",{style:{fontSize:"12px",color:"#9ca3af",textAlign:"center",marginBottom:"12px"},children:["当前环境: ",g]}),(0,t.jsxs)("div",{className:"login-form",onKeyDown:e=>{"Enter"===e.key&&m()},children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("label",{className:"login-label",children:"手机号 / 邮箱"}),(0,t.jsx)("input",{id:"login-account",type:"text",className:"login-input",value:e,onChange:e=>o(e.target.value),placeholder:"请输入手机号或邮箱"})]}),(0,t.jsxs)("div",{children:[(0,t.jsx)("label",{className:"login-label",children:"密码"}),(0,t.jsx)("input",{id:"login-password",type:"password",className:"login-input",value:a,onChange:e=>s(e.target.value),placeholder:"请输入密码"})]}),d&&(0,t.jsx)("div",{className:"login-error",children:d}),(0,t.jsx)("button",{type:"button",onClick:m,disabled:l,className:"login-btn",children:l?"登录中...":"登录"}),(0,t.jsx)("div",{dangerouslySetInnerHTML:{__html:`
              <button type="button"
                onclick="if(window._nativeLoginInit){window._nativeLoginInit();}else{alert('登录脚本加载中，请稍后再试');}"
                style="margin-top:8px;padding:12px;font-size:14px;font-weight:500;color:#fff;background:#2563eb;border:none;border-radius:8px;cursor:pointer;width:100%;"
              >
                登录（兼容模式）
              </button>
            `}}),(0,t.jsx)("div",{id:"debug-info",style:{marginTop:"8px",fontSize:"11px",color:"#9ca3af",lineHeight:"1.5",wordBreak:"break-all"},children:"检测中..."===g?'如果上方按钮点击无反应，请使用"兼容模式"按钮':`环境: ${g}`})]}),(0,t.jsx)("div",{className:"login-hint",children:"首次使用请在 Supabase 控制台创建用户"})]})})]})}],94542)}]);