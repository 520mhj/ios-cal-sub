/** 小工具:列出窗口内二十四节气的公历日期。用法: tsx scripts/list-terms.ts [年份] */
import { solarTermDatesInRange } from '../src/sources.js';

const now = new Date();
const yearArg = Number(process.argv[2] ?? now.getFullYear());
const win = { start: `${yearArg}-01-01`, end: `${yearArg}-12-31` };
const table = solarTermDatesInRange(win);

for (const [name, dates] of [...table.entries()].sort(
  (a, b) => (a[1][0] ?? '') < (b[1][0] ?? '') ? -1 : 1,
)) {
  const inYear = dates.filter((d) => d.startsWith(String(yearArg)));
  if (inYear.length > 0) console.log(`${name.padEnd(3, '　')} ${inYear.join(', ')}`);
}
