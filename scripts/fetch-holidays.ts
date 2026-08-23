/**
 * 拉取中国法定节假日数据(含调休补班),来源:NateScarlet/holiday-cn
 * 该仓库自动解析国务院办公厅公告,是社区最权威的机器可读节假日数据源。
 * 拉取范围:去年 ~ 今年+2 年(未来年份可能尚未发布,404 属正常)。
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master';
const outDir = path.resolve('data/holiday-cn');

const now = new Date();
const years: number[] = [];
for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) years.push(y);

let available = 0;
for (const y of years) {
  const file = path.join(outDir, `${y}.json`);
  let body: string;
  try {
    const res = await fetch(`${BASE}/${y}.json`, {
      headers: { 'user-agent': 'ios-cal-sub/0.1 (+github)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.text();
    const j = JSON.parse(body) as { days?: unknown };
    if (!Array.isArray(j.days)) throw new Error('响应缺少 days 数组');
  } catch (e) {
    if (fs.existsSync(file)) {
      console.warn(`⚠️ ${y} 年拉取失败(${(e as Error).message}),沿用本地缓存`);
      available++;
    } else {
      console.warn(`⚠️ ${y} 年拉取失败且无缓存:${(e as Error).message}`);
    }
    continue;
  }
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) {
    console.log(`✓ ${y} 年无变化(跳过写入)`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    console.log(`✅ 已保存 data/holiday-cn/${y}.json`);
  }
  available++;
}

if (available === 0) {
  console.error('❌ 任何年份的节假日数据都不可用,请检查网络后重试');
  process.exit(1);
}
console.log(`\n完成:${available}/${years.length} 个年份数据可用`);
