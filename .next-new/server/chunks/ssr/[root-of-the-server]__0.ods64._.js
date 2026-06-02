module.exports=[50640,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"InvariantError",{enumerable:!0,get:function(){return d}});class d extends Error{constructor(a,b){super(`Invariant: ${a.endsWith(".")?a:a+"."} This is a bug in Next.js.`,b),this.name="InvariantError"}}},64240,(a,b,c)=>{"use strict";function d(a){if("function"!=typeof WeakMap)return null;var b=new WeakMap,c=new WeakMap;return(d=function(a){return a?c:b})(a)}c._=function(a,b){if(!b&&a&&a.__esModule)return a;if(null===a||"object"!=typeof a&&"function"!=typeof a)return{default:a};var c=d(b);if(c&&c.has(a))return c.get(a);var e={__proto__:null},f=Object.defineProperty&&Object.getOwnPropertyDescriptor;for(var g in a)if("default"!==g&&Object.prototype.hasOwnProperty.call(a,g)){var h=f?Object.getOwnPropertyDescriptor(a,g):null;h&&(h.get||h.set)?Object.defineProperty(e,g,h):e[g]=a[g]}return e.default=a,c&&c.set(a,e),e}},93695,(a,b,c)=>{b.exports=a.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},75476,a=>{"use strict";a.s(["PageHeader",()=>b]);let b=(0,a.i(11857).registerClientReference)(function(){throw Error("Attempted to call PageHeader() from the server but PageHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/components/PageHeader.tsx <module evaluation>","PageHeader")},97745,a=>{"use strict";a.s(["PageHeader",()=>b]);let b=(0,a.i(11857).registerClientReference)(function(){throw Error("Attempted to call PageHeader() from the server but PageHeader is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/components/PageHeader.tsx","PageHeader")},25395,a=>{"use strict";a.i(75476);var b=a.i(97745);a.n(b)},10585,a=>{a.v("/_next/static/media/favicon.0x3dzn~oxb6tn.ico"+(globalThis.NEXT_CLIENT_ASSET_SUFFIX||""))},68611,a=>{"use strict";let b={src:a.i(10585).default,width:256,height:256};a.s(["default",0,b])},976,a=>{"use strict";a.s(["default",()=>b]);let b=(0,a.i(11857).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/src/app/reports/auto-linked-parts/AutoLinkedPartsReportTable.tsx <module evaluation> from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/reports/auto-linked-parts/AutoLinkedPartsReportTable.tsx <module evaluation>","default")},69875,a=>{"use strict";a.s(["default",()=>b]);let b=(0,a.i(11857).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/src/app/reports/auto-linked-parts/AutoLinkedPartsReportTable.tsx from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/app/reports/auto-linked-parts/AutoLinkedPartsReportTable.tsx","default")},68388,a=>{"use strict";a.i(976);var b=a.i(69875);a.n(b)},23159,a=>{"use strict";var b=a.i(7997),c=a.i(16349),d=a.i(25395),e=a.i(68388);async function f(){let a=await (0,c.createClient)(),{data:f}=await a.from("part_vehicle_models").select(`
      id,
      notes,
      created_at,
      parts(
        id,
        name,
        part_number,
        part_names(
          name,
          auto_link_vehicle_model,
          part_categories(name, auto_link_vehicle_model)
        )
      ),
      vehicle_models(
        厂商,
        品牌,
        车系,
        车型,
        销售版本,
        年款,
        排量,
        发动机型号,
        燃油类型,
        进气形式,
        变速箱类型,
        变速箱代号,
        底盘代号,
        驱动方式,
        车身类型,
        排放标准
      )
    `).order("created_at",{ascending:!1}),g=(f||[]).filter(a=>a.parts?.part_names?.auto_link_vehicle_model||a.parts?.part_names?.part_categories?.auto_link_vehicle_model);return(0,b.jsxs)("div",{className:"p-6 space-y-6",children:[(0,b.jsx)(d.PageHeader,{title:"自动关联配件",description:"查看系统自动从工单中建立的配件与车型关联，并可直接更新备注或删除关联。"}),(0,b.jsxs)("div",{className:"bg-white rounded-xl border border-gray-200 p-6",children:[(0,b.jsx)("div",{className:"flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4",children:(0,b.jsxs)("div",{children:[(0,b.jsx)("h2",{className:"text-lg font-semibold text-gray-900",children:"自动关联记录"}),(0,b.jsxs)("p",{className:"text-sm text-gray-500 mt-1",children:["共 ",g.length," 条自动关联"]})]})}),(0,b.jsx)(e.default,{rows:g})]})]})}a.s(["default",0,f])},69642,a=>{a.n(a.i(23159))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0.ods64._.js.map