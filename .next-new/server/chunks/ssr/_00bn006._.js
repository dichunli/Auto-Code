module.exports=[5050,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0});var d={callServer:function(){return f.callServer},createServerReference:function(){return h.createServerReference},findSourceMapURL:function(){return g.findSourceMapURL}};for(var e in d)Object.defineProperty(c,e,{enumerable:!0,get:d[e]});let f=a.r(41961),g=a.r(1722),h=a.r(38783)},93482,a=>{"use strict";var b=a.i(87924),c=a.i(72131),d=a.i(95445),e=a.i(5050);let f=(0,e.createServerReference)("40f380e923b8b3eebbf1bd13018ca7a7e33ec65df3",e.callServer,void 0,e.findSourceMapURL,"logLogin");a.s(["default",0,function(){let[a,e]=(0,c.useState)(""),[g,h]=(0,c.useState)(""),[i,j]=(0,c.useState)(!1),[k,l]=(0,c.useState)(""),[m,n]=(0,c.useState)("检测中..."),[o,p]=(0,c.useState)(null);async function q(){if(alert("点击了登录按钮"),!o){alert("supabase 未初始化，尝试直接创建...");try{let a=(0,d.createClient)();p(a),await r(a);return}catch(b){let a=b instanceof Error?b.message:String(b);alert("创建客户端失败: "+a),l("登录服务初始化失败: "+a),j(!1);return}}await r(o)}async function r(b){j(!0),l("");let c={password:g,email:""};/^1[3-9]\d{9}$/.test(a)?c.email="phone-"+a+"@auto.local":c.email=a;try{let{data:d,error:e}=await Promise.race([b.auth.signInWithPassword(c),new Promise((a,b)=>setTimeout(()=>b(Error("登录请求超时，请检查网络连接或刷新页面重试")),1e4))]);if(e){l(e.message||"登录失败，请检查账号密码"),j(!1);return}if(!d.session){l("登录成功但未获取到会话，请检查网络或 Supabase 配置"),j(!1);return}f({userId:d.user?.id||"",userName:d.user?.email||a,description:`用户 ${a} 登录系统`}).catch(()=>{});let g=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);window.location.href=g?"/m":"/"}catch(a){l("登录请求失败: "+(a instanceof Error?a.message:"网络错误或浏览器安全策略阻止了请求")),j(!1)}}return(0,c.useEffect)(()=>{n((0,d["获取当前环境"])()),p((0,d.createClient)())},[]),(0,c.useEffect)(()=>{function a(a){if(a.persisted){let a=window;!a.Capacitor&&!a.CapacitorIsNative&&(document.cookie.includes("sb-")||window.localStorage.getItem("sb-"))&&(window.location.href="/")}}return window.addEventListener("pageshow",a),()=>window.removeEventListener("pageshow",a)},[]),(0,c.useEffect)(()=>{},[]),(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("div",{dangerouslySetInnerHTML:{__html:`
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
      `}}),(0,b.jsx)("style",{dangerouslySetInnerHTML:{__html:`
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
      `}}),(0,b.jsx)("noscript",{children:(0,b.jsxs)("div",{style:{padding:"20px",textAlign:"center",color:"#dc2626",background:"#fef2f2",borderRadius:"8px",margin:"20px"},children:[(0,b.jsx)("strong",{children:"请启用JavaScript"}),(0,b.jsx)("br",{}),"您的浏览器禁用了JavaScript，无法登录。请换用Chrome浏览器或开启JavaScript后刷新。"]})}),(0,b.jsx)("div",{className:"login-root",children:(0,b.jsxs)("div",{className:"login-card",children:[(0,b.jsxs)("div",{className:"login-logo",children:[(0,b.jsx)("div",{className:"login-logo-box",children:(0,b.jsx)("span",{className:"login-logo-text",children:"修"})}),(0,b.jsx)("h1",{className:"login-title",children:"汽修管家"})]}),(0,b.jsxs)("div",{style:{fontSize:"12px",color:"#9ca3af",textAlign:"center",marginBottom:"12px"},children:["当前环境: ",m]}),(0,b.jsxs)("div",{className:"login-form",onKeyDown:a=>{"Enter"===a.key&&q()},children:[(0,b.jsxs)("div",{children:[(0,b.jsx)("label",{className:"login-label",children:"手机号 / 邮箱"}),(0,b.jsx)("input",{id:"login-account",type:"text",className:"login-input",value:a,onChange:a=>e(a.target.value),placeholder:"请输入手机号或邮箱"})]}),(0,b.jsxs)("div",{children:[(0,b.jsx)("label",{className:"login-label",children:"密码"}),(0,b.jsx)("input",{id:"login-password",type:"password",className:"login-input",value:g,onChange:a=>h(a.target.value),placeholder:"请输入密码"})]}),k&&(0,b.jsx)("div",{className:"login-error",children:k}),(0,b.jsx)("button",{type:"button",onClick:q,disabled:i,className:"login-btn",children:i?"登录中...":"登录"}),(0,b.jsx)("div",{dangerouslySetInnerHTML:{__html:`
              <button type="button"
                onclick="if(window._nativeLoginInit){window._nativeLoginInit();}else{alert('登录脚本加载中，请稍后再试');}"
                style="margin-top:8px;padding:12px;font-size:14px;font-weight:500;color:#fff;background:#2563eb;border:none;border-radius:8px;cursor:pointer;width:100%;"
              >
                登录（兼容模式）
              </button>
            `}}),(0,b.jsx)("div",{id:"debug-info",style:{marginTop:"8px",fontSize:"11px",color:"#9ca3af",lineHeight:"1.5",wordBreak:"break-all"},children:"检测中..."===m?'如果上方按钮点击无反应，请使用"兼容模式"按钮':`环境: ${m}`})]}),(0,b.jsx)("div",{className:"login-hint",children:"首次使用请在 Supabase 控制台创建用户"})]})})]})}],93482)}];

//# sourceMappingURL=_00bn006._.js.map