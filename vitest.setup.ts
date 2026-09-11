/* 必须用 /vitest 子入口：主入口只注册 jest 命名空间的类型，
   vitest 的 Assertion 接口扩展在 vitest.d.ts 里。
   用主入口时测试运行正常（运行时行为一致），但全量类型检查会报
   "toBeInTheDocument does not exist on Assertion"——增量缓存掩盖了它，
   无缓存环境（devtest）build 直接失败（2026-09-12 发现） */
import "@testing-library/jest-dom/vitest";
