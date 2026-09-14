/* ============================================================
 * 备份恢复导入（灾难恢复 / 恢复演练用）
 *
 * 把 backup-export.js 导出的备份目录（每表一个 <表名>.json + _行数台账.txt）
 * 导回 Supabase 数据库。
 *
 * 适用场景：目标库的表结构已存在（新库需先跑迁移建表），把数据灌回去。
 *
 * 用法：
 *   node scripts/restore-import.js <备份目录> [--表 表名1,表名2] [--确认]
 *   --表    只恢复指定的表（演练时先用小表试手）
 *   --确认  真正执行写入；不传则只打印计划、不动数据（预览模式）
 *
 * 设计说明：
 *   - 走 PostgREST（supabase-js + SERVICE_ROLE_KEY），无需数据库直连串
 *   - 表间外键顺序用"多轮重试"解决：本轮因外键冲突插不进去的表留到
 *     下一轮，通常第 2~3 轮全部落位；连续两轮无进展则判定死锁报错
 *   - 每批 insert 是单条 SQL（原子）：一批失败整批留待重试，不会出现
 *     "半批脏数据"
 *   - 目标表已有数据时主键冲突会直接报错——本脚本不做"清空重灌"，
 *     请先确认目标是空库或确实要合并（防止误盖生产数据）
 * ============================================================ */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

/* 自动加载项目根目录的 .env.local（与其他运维脚本同一模式） */
(function 加载本地环境变量() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const 行 of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const 匹配 = 行.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!匹配) continue;
    const [, 名, 原始值] = 匹配;
    if (process.env[名]) continue; /* 已注入的不覆盖 */
    process.env[名] = 原始值.replace(/^["']|["']$/g, "");
  }
})();

const 每批行数 = 500;
const 最多轮数 = 6;

/* ---------------- 参数解析 ---------------- */
const 位置参数 = [];
let 指定表 = null;
let 确认执行 = false;
for (let i = 2; i < process.argv.length; i++) {
  const 参 = process.argv[i];
  if (参 === "--确认") {
    确认执行 = true;
  } else if (参 === "--表") {
    i++;
    指定表 = (process.argv[i] || "").split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    位置参数.push(参);
  }
}

const 备份目录 = 位置参数[0];
if (!备份目录) {
  console.error("用法: node scripts/restore-import.js <备份目录> [--表 表名1,表名2] [--确认]");
  process.exit(1);
}
if (!fs.existsSync(备份目录) || !fs.statSync(备份目录).isDirectory()) {
  console.error(`❌ 备份目录不存在: ${备份目录}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（.env.local 里应有配置）");
  process.exit(1);
}

/* ---------------- 工具 ---------------- */

/* 判断错误是否为外键冲突（可留到下轮重试） */
function 是外键冲突(错误消息) {
  return /foreign key|23503|violates foreign key/i.test(错误消息);
}

/* 单批插入（原子：一次 HTTP 请求一条 insert 语句，要么全成要么全败） */
async function 插一批(supabase, 表名, 行数组) {
  const { error } = await supabase.from(表名).insert(行数组);
  if (error) throw new Error(error.message);
}

/* 恢复单张表；外键冲突时返回 false 表示"留到下轮"，其他错误直接抛 */
async function 恢复表(supabase, 表名, 全部行, 第几轮) {
  for (let i = 0; i < 全部行.length; i += 每批行数) {
    const 批 = 全部行.slice(i, i + 每批行数);
    try {
      await 插一批(supabase, 表名, 批);
    } catch (err) {
      const 消息 = err instanceof Error ? err.message : String(err);
      if (是外键冲突(消息)) {
        if (第几轮 === 1) {
          console.log(`  ⏳ ${表名}: 外键依赖未就绪，留到下一轮`);
        }
        return false;
      }
      throw new Error(`${表名} 第 ${i + 1}~${i + 批.length} 行写入失败: ${消息}`);
    }
  }
  return true;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  /* 收集备份文件清单 */
  let 表文件 = fs.readdirSync(备份目录)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ 表名: f.slice(0, -5), 文件: path.join(备份目录, f) }))
    .sort((a, b) => a.表名.localeCompare(b.表名));

  if (指定表) {
    表文件 = 表文件.filter((t) => 指定表.includes(t.表名));
    if (表文件.length === 0) {
      console.error(`❌ 备份目录里找不到指定的表: ${指定表.join(", ")}`);
      process.exit(1);
    }
  }

  /* 读行数台账（恢复后对照用） */
  const 台账路径 = path.join(备份目录, "_行数台账.txt");
  const 台账 = new Map();
  if (fs.existsSync(台账路径)) {
    for (const 行 of fs.readFileSync(台账路径, "utf8").split(/\r?\n/)) {
      const [名, 数] = 行.split("\t");
      if (名 && 数) 台账.set(名.trim(), parseInt(数.trim(), 10));
    }
  }

  /* 汇总计划 */
  let 总行数 = 0;
  const 计划 = 表文件.map(({ 表名, 文件 }) => {
    const 行数 = 台账.get(表名);
    总行数 += 行数 ?? 0;
    return `  ${表名}: ${行数 !== undefined ? `${行数} 行` : "（台账无记录）"}`;
  });

  console.log("========================================");
  console.log(" 备份恢复计划");
  console.log("========================================");
  console.log(`目标库: ${url}`);
  console.log(`备份目录: ${备份目录}`);
  console.log(`共 ${表文件.length} 张表${台账.size > 0 ? `、台账合计 ${总行数} 行` : ""}：`);
  console.log(计划.join("\n"));
  console.log("");

  if (!确认执行) {
    console.log("⚠️ 当前为预览模式，未写入任何数据。");
    console.log("   确认目标库无误后，加 --确认 参数真正执行。");
    return;
  }

  const supabase = createClient(url, key);

  /* 多轮恢复：外键冲突的表留到下一轮 */
  let 待恢复 = [...表文件];
  const 完成表 = [];
  for (let 轮 = 1; 轮 <= 最多轮数 && 待恢复.length > 0; 轮++) {
    if (轮 > 1) console.log(`\n—— 第 ${轮} 轮（重试 ${待恢复.length} 张表）——`);
    const 本轮失败 = [];
    for (const { 表名, 文件 } of 待恢复) {
      let 全部行;
      try {
        全部行 = JSON.parse(fs.readFileSync(文件, "utf8"));
      } catch (err) {
        throw new Error(`${表名} 备份文件损坏，无法解析: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!Array.isArray(全部行) || 全部行.length === 0) {
        console.log(`  ⏭️ ${表名}: 空表，跳过`);
        完成表.push(表名);
        continue;
      }
      const 成功 = await 恢复表(supabase, 表名, 全部行, 轮);
      if (成功) {
        console.log(`  ✅ ${表名}: ${全部行.length} 行`);
        完成表.push(表名);
      } else {
        本轮失败.push({ 表名, 文件 });
      }
    }
    if (本轮失败.length === 待恢复.length && 轮 > 1) {
      console.error("\n❌ 连续两轮没有进展，以下表因外键关系无法恢复（可能存在循环依赖或数据缺行）:");
      for (const { 表名 } of 本轮失败) console.error(`   - ${表名}`);
      process.exit(1);
    }
    待恢复 = 本轮失败;
  }

  /* 行数台账对照 */
  if (台账.size > 0) {
    console.log("\n—— 行数台账对照 ——");
    let 不符 = 0;
    for (const 表名 of 完成表) {
      const 应有 = 台账.get(表名);
      if (应有 === undefined) continue;
      const { count, error } = await supabase
        .from(表名)
        .select("*", { count: "exact", head: true });
      if (error) {
        console.log(`  ⚠️ ${表名}: 无法核对（${error.message}）`);
        continue;
      }
      if (count === 应有) {
        console.log(`  ✅ ${表名}: ${count} 行，与台账一致`);
      } else {
        不符++;
        console.log(`  ❌ ${表名}: 库中 ${count} 行 ≠ 台账 ${应有} 行`);
      }
    }
    if (不符 > 0) {
      console.error(`\n❌ ${不符} 张表行数与台账不符，请检查！`);
      process.exit(1);
    }
  }

  console.log(`\n✅ 恢复完成：${完成表.length} 张表全部写入，行数核对通过。`);
}

main().catch((err) => {
  console.error("❌ 恢复中止: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
