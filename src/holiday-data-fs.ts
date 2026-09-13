/**
 * 从文件系统加载节假日数据(仅本地构建/验证用,Worker 不导入此文件)
 *
 * Worker 中使用 src/holiday-data.ts 的内置 HOLIDAY_DATA,零文件系统依赖。
 * 此文件保留是为了本地开发时可以从 data/holiday-cn/ 读取最新数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HolidayCnYear } from './types.js';
import type { Window } from './sources.js';

export async function loadHolidayData(
  dataDir: string,
  win: Window,
): Promise<Map<number, HolidayCnYear>> {
  const map = new Map<number, HolidayCnYear>();
  const firstYear = Number(win.start.slice(0, 4));
  const lastYear = Number(win.end.slice(0, 4));
  for (let y = firstYear; y <= lastYear; y++) {
    const p = path.join(dataDir, `${y}.json`);
    if (!fs.existsSync(p)) {
      console.warn(`⚠️ 缺少 ${y} 年节假日数据(data/holiday-cn/${y}.json 不存在)——公告可能尚未发布`);
      continue;
    }
    try {
      const json = JSON.parse(await fs.promises.readFile(p, 'utf8')) as HolidayCnYear;
      if (!Array.isArray(json.days)) throw new Error('缺少 days 数组');
      if (json.days.length === 0) {
        console.warn(`⏳ ${y} 年节假日数据为空占位(国务院公告尚未发布),该年份将不生成假日事件`);
        continue;
      }
      map.set(y, json);
    } catch (e) {
      console.warn(`⚠️ 跳过损坏的节假日数据 ${p}: ${(e as Error).message}`);
    }
  }
  return map;
}
