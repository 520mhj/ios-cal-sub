/**
 * 每日日程推送(Bark)。
 * 用法:CAL_BARK_KEY=<device key> tsx scripts/notify-daily.ts
 * 未配置 CAL_BARK_KEY 时静默跳过(exit 0),不影响 CI。
 */
import { loadConfig } from '../src/generate.js';
import { buildWindow, expandSource, loadHolidayData } from '../src/sources.js';
import type { Occurrence } from '../src/types.js';
import path from 'node:path';

const KEY = (process.env.CAL_BARK_KEY ?? '').trim();
if (!KEY) {
  console.log('(未配置 CAL_BARK_KEY,跳过每日推送)');
  process.exit(0);
}

const TZ_OFFSET_HOURS = 8; // Asia/Shanghai
function todayLocal(): string {
  const now = new Date(Date.now() + TZ_OFFSET_HOURS * 3600_000);
  return now.toISOString().slice(0, 10);
}

/** 把一条(可能带 RRULE 的)定义展开:判断 day 是否为发生日 */
function occursOn(o: Occurrence, day: string): boolean {
  if (!o.rrule) return o.start === day;
  const untilM = /UNTIL=(\d{8})/.exec(o.rrule);
  const untilDate = untilM ? `${untilM[1]!.slice(0, 4)}-${untilM[1]!.slice(4, 6)}-${untilM[1]!.slice(6, 8)}` : '9999-12-31';
  if (o.start > day || day > untilDate) return false;
  const mFreq = /^FREQ=([A-Z]+)/.exec(o.rrule)?.[1];
  if (mFreq === 'DAILY') {
    const count = Number(/COUNT=(\d+)/.exec(o.rrule)?.[1] ?? 1);
    const [sy, sm, sd] = o.start.split('-').map(Number);
    const end = new Date(Date.UTC(sy!, (sm! - 1), sd!) + (count - 1) * 86_400_000);
    const endStr = end.toISOString().slice(0, 10);
    return day <= endStr;
  }
  const [yy, ym, yd] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  const [sy2, sm2, sd2] = [Number(o.start.slice(0, 4)), Number(o.start.slice(5, 7)), Number(o.start.slice(8, 10))];
  if (mFreq === 'WEEKLY') {
    if (day < o.start) return false;
    const utc = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
    return utc(day) === utc(o.start);
  }
  if (mFreq === 'MONTHLY') return yd === sd2 && !(ym < sm2 && yy === sy2) && !(yy === sy2 && ym < sm2);
  if (mFreq === 'YEARLY') return ym === sm2 && yd === sd2;
  return false;
}

async function main(): Promise<void> {
  const cfg = loadConfig(path.resolve('calendars.yaml'));
  const win = buildWindow(cfg.defaults.years_ahead);
  const today = todayLocal();

  // 与构建同源地展开全部定义(节假日缓存缺失不阻塞推送)
  let holidayData;
  try {
    holidayData = await loadHolidayData(path.resolve('data/holiday-cn'), win);
  } catch {
    holidayData = undefined;
  }

  const lines: { time: string; text: string }[] = [];
  for (const cal of cfg.calendars) {
    for (const src of cal.sources) {
      let occs: Occurrence[] = [];
      try {
        occs = expandSource(src, { win, calId: cal.id });
      } catch {
        continue;
      }
      for (const o of occs) {
        if (!occursOn(o, today)) continue;
        // DAILY 序列物化时已是逐日事件;RRULE 定义只取当天这一次
        lines.push({
          time: o.time ?? '全天',
          text: o.summary.replace(/^⛅ |^⏰ |^🎂 |^💼 |^🇨🇳 /, ''),
        });
      }
    }
  }
  if (lines.length === 0) {
    console.log(`(${today}) 今日无事项,跳过推送`);
    return;
  }
  lines.sort((a, b) => (a.time === '全天' ? -1 : b.time === '全天' ? 1 : a.time.localeCompare(b.time)));
  const dedup = [...new Map(lines.map((l) => [l.time + l.text, l])).values()];

  const md = today.slice(5).replace('-', '/');
  const title = `📅 今日日程 ${md}(${dedup.length} 项)`;
  const body = dedup.map((l) => `${l.time === '全天' ? '☀️' : '🕐'} ${l.time} ${l.text}`).join('\n');

  const url =
    `https://api.day.app/${encodeURIComponent(KEY)}/` +
    `${encodeURIComponent(title)}/${encodeURIComponent(body)}` +
    `?group=ios-cal-sub&sound=minuet&level=timeSensitive`;
  const res = await fetch(url);
  const j = (await res.json()) as { code: number; message?: string };
  if (res.ok && j.code === 200) console.log(`✅ 已推送今日日程(${dedup.length} 项)`);
  else throw new Error(`Bark 推送失败 HTTP ${res.status}: ${j.message ?? ''}`);
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
