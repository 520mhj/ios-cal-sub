/** 事件源展开:把配置中的各类型 source 展开为窗口内的具体事件 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Lunar, LunarMonth, Solar } from 'lunar-typescript';
import type {
  HolidayCnSource,
  HolidayCnYear,
  LunarSource,
  Occurrence,
  RuleSource,
  SolarSource,
  SolarTermSource,
  Source,
} from './types.js';
import { addDays, cmpDate, isLeapYear, lastDayOfMonth, todayLocal } from './dates.js';

export interface Window {
  start: string;
  end: string;
}

export function buildWindow(yearsAhead: number): Window {
  const now = new Date();
  return {
    // 从当年 1 月 1 日起:订阅日历应当能看到今年已经过去的节日/连续打卡,
    // 否则 iPhone 端会出现"事件从年中被截断"的困惑(窗口外日期根本不写入 .ics)
    start: `${now.getFullYear()}-01-01`,
    end: `${now.getFullYear() + yearsAhead}-12-31`,
  };
}

/** 稳定 UID:同一逻辑事件的 UID 永不变化,订阅端更新时是"修改"而非"重复新增" */
export function makeUid(calId: string, ...parts: (string | number)[]): string {
  const h = createHash('sha1')
    .update([calId, ...parts].join('|'))
    .digest('hex')
    .slice(0, 20);
  return `${h}@${calId}`;
}

function mergeAlarms(
  src: LunarSource | SolarSource | RuleSource | SolarTermSource,
): string[] {
  const set = new Set(src.alarms ?? []);
  for (const n of src.alarm_days_before ?? []) set.add(`-P${n}D`);
  return [...set];
}

const WEEKDAY_NUM: Record<NonNullable<RuleSource['weekday']>, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** ---------- holidays-cn ---------- */

const REST_EMOJI: [RegExp, string][] = [
  [/春节/, '🧨'],
  [/元旦/, '🎊'],
  [/清明/, '🌿'],
  [/劳动/, '🛠️'],
  [/端午/, '🐉'],
  [/中秋/, '🥮'],
  [/国庆|十一/, '🇨🇳'],
];

function festEmoji(name: string): string {
  for (const [re, e] of REST_EMOJI) if (re.test(name)) return e;
  return '📅';
}

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

export function expandHolidaysCn(
  src: HolidayCnSource,
  data: Map<number, HolidayCnYear>,
  win: Window,
  calId: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const yearData of data.values()) {
    for (const day of yearData.days) {
      if (cmpDate(day.date, win.start) < 0 || cmpDate(day.date, win.end) > 0) continue;
      if (day.isOffDay && !src.include_rest_days) continue;
      if (!day.isOffDay && !src.include_workdays) continue;
      if (day.isOffDay) {
        out.push({
          uid: makeUid(calId, 'holiday-cn', day.date),
          start: day.date,
          end: addDays(day.date, 1),
          time: null,
          summary: `${festEmoji(day.name)} ${day.name} · 放假`,
          description: '法定节假日休息日。数据来源:NateScarlet/holiday-cn',
          alarms: [],
        });
      } else {
        out.push({
          uid: makeUid(calId, 'holiday-workday', day.date),
          start: day.date,
          end: addDays(day.date, 1),
          time: null,
          summary: `💼 ${day.name} · 调休补班(上班)`,
          description: '⚠️ 今天是周末调休上班日!Apple 自带节假日日历不显示这条。',
          alarms: ['-PT19H'], // 前一天早上5点 ≈ 提醒"明天上班"
        });
      }
    }
  }
  return out;
}

/** ---------- 农历事件 ---------- */

/**
 * 把农历(lunarYear 年的 m 月 d 日)换算为公历 YYYY-MM-DD。
 * 返回 null 表示该农历月不存在;日超过当月天数时贴到月末。
 * 默认使用"平月":即使当年有闰 m 月也按普通 m 月算(可在文档中了解原因)。
 */
export function lunarToSolar(lunarYear: number, m: number, d: number): string | null {
  const lm = LunarMonth.fromYm(lunarYear, m);
  if (!lm) return null;
  const day = Math.min(d, lm.getDayCount());
  // 正数月份即普通月份(负数才表示闰月),符合"平月过生日"的常见习惯
  return Lunar.fromYmd(lm.getYear(), lm.getMonth(), day).getSolar().toYmd();
}

export function expandLunar(
  src: LunarSource,
  win: Window,
  calId: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const gStart = Number(win.start.slice(0, 4));
  const gEnd = Number(win.end.slice(0, 4));
  const emoji = src.kind === 'birthday' ? '🎂' : '🕯️';
  const kindText = src.kind === 'birthday' ? '生日' : '纪念日';

  for (let gy = gStart; gy <= gEnd; gy++) {
    // 公历 gy 年中的这次农历纪念日:先试农历 gy 年,若落在 gy 年之前则用农历 gy-1 年
    let solarDate = lunarToSolar(gy, src.lunar_month, src.lunar_day);
    let usedLunarYear = gy;
    if (!solarDate || solarDate.slice(0, 4) !== String(gy)) {
      usedLunarYear = gy - 1;
      solarDate = lunarToSolar(gy - 1, src.lunar_month, src.lunar_day);
    }
    if (!solarDate) continue;
    if (cmpDate(solarDate, win.start) < 0 || cmpDate(solarDate, win.end) > 0) continue;

    const descParts: string[] = [
      `农历${src.lunar_month}月${src.lunar_day} · ${kindText}`,
    ];
    if (src.birth_year) {
      const virtualAge = usedLunarYear - src.birth_year + 1;
      descParts.push(`虚岁 ${virtualAge}`);
    }
    if (src.note) descParts.push(src.note);

    out.push({
      uid: makeUid(calId, `lunar-${src.title}`, solarDate),
      start: solarDate,
      end: addDays(solarDate, 1),
      time: src.time ?? null,
      summary: `${emoji} ${src.title}`,
      description: descParts.join(' | '),
      alarms: mergeAlarms(src),
    });
  }
  return out;
}

/** ---------- 固定公历日期(每年一次) ---------- */

export function expandSolar(
  src: SolarSource,
  win: Window,
  calId: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const gStart = Number(win.start.slice(0, 4));
  const gEnd = Number(win.end.slice(0, 4));
  const MM = String(src.month).padStart(2, '0');
  for (let gy = gStart; gy <= gEnd; gy++) {
    // 2月29日在平年直接跳过
    if (src.month === 2 && src.day === 29 && !isLeapYear(gy)) continue;
    const date = `${gy}-${MM}-${String(Math.min(src.day, lastDayOfMonth(gy, src.month))).padStart(2, '0')}`;
    if (cmpDate(date, win.start) < 0 || cmpDate(date, win.end) > 0) continue;
    const descParts = [`每年 ${MM}-${String(src.day).padStart(2, '0')}`];
    if (src.note) descParts.push(src.note);
    out.push({
      uid: makeUid(calId, `solar-${src.title}`, date),
      start: date,
      end: addDays(date, 1),
      time: src.time ?? null,
      summary: `📌 ${src.title}`,
      description: descParts.join(' | '),
      alarms: mergeAlarms(src),
    });
  }
  return out;
}

/** ---------- 周期规则 ---------- */

const FREQ_TEXT: Record<RuleSource['freq'], string> = {
  weekly: '每周循环',
  monthly: '每月循环',
  yearly: '每年循环',
  once: '单次',
};

function inRange(date: string, range: Window): boolean {
  return cmpDate(date, range.start) >= 0 && cmpDate(date, range.end) <= 0;
}

export function expandRule(
  src: RuleSource,
  win: Window,
  calId: string,
): Occurrence[] {
  const range: Window = {
    start: src.start && cmpDate(src.start, win.start) > 0 ? src.start : win.start,
    end: src.end && cmpDate(src.end, win.end) < 0 ? src.end : win.end,
  };
  const dates: string[] = [];

  if (src.freq === 'once') {
    if (!src.date) throw new Error(`规则 "${src.title}" freq=once 需要提供 date`);
    if (inRange(src.date, range)) dates.push(src.date);
  } else if (src.freq === 'weekly') {
    if (!src.weekday) throw new Error(`规则 "${src.title}" freq=weekly 需要提供 weekday`);
    const target = WEEKDAY_NUM[src.weekday];
    for (let d = range.start; cmpDate(d, range.end) <= 0; d = addDays(d, 1)) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === target) dates.push(d);
    }
  } else if (src.freq === 'monthly') {
    if (src.day == null) throw new Error(`规则 "${src.title}" freq=monthly 需要提供 day`);
    let y = Number(range.start.slice(0, 4));
    let m = Number(range.start.slice(5, 7));
    const endY = Number(range.end.slice(0, 4));
    const endM = Number(range.end.slice(5, 7));
    while (y < endY || (y === endY && m <= endM)) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(src.day, lastDayOfMonth(y, m))).padStart(2, '0')}`;
      if (inRange(date, range)) dates.push(date);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  } else {
    // yearly
    if (src.month == null || src.day == null)
      throw new Error(`规则 "${src.title}" freq=yearly 需要提供 month 和 day`);
    const startY = Number(range.start.slice(0, 4));
    const endY = Number(range.end.slice(0, 4));
    for (let y = startY; y <= endY; y++) {
      if (src.month === 2 && src.day === 29 && !isLeapYear(y)) continue;
      const date = `${y}-${String(src.month).padStart(2, '0')}-${String(Math.min(src.day, lastDayOfMonth(y, src.month))).padStart(2, '0')}`;
      if (inRange(date, range)) dates.push(date);
    }
  }

  const descParts = [FREQ_TEXT[src.freq]];
  if (src.time) descParts.push(`时间 ${src.time}`);
  if (src.note) descParts.push(src.note);

  return dates.map((date) => ({
    uid: makeUid(calId, `rule-${src.title}`, date),
    start: date,
    end: addDays(date, 1),
    time: src.time ?? null,
    summary: `⏰ ${src.title}`,
    description: descParts.join(' | '),
    alarms: mergeAlarms(src),
  }));
}

/** ---------- 节气事件 ---------- */

/**
 * 收集窗口内(外扩一年保证边界覆盖)所有节气的公历日期。
 * lunar-typescript 的 getJieQiTable():普通对象,键为中文名或拼音键,
 * 值直接是 Solar 实例。同一节气在不同农历年的表中可能重复出现,需去重排序。
 */
export function solarTermDatesInRange(win: Window): Map<string, string[]> {
  const gStart = Number(win.start.slice(0, 4)) - 1;
  const gEnd = Number(win.end.slice(0, 4)) + 1;
  const out = new Map<string, Set<string>>();
  for (let gy = gStart; gy <= gEnd; gy++) {
    // 取年中日期锚定到该公历年的农历年表
    const table = Solar.fromYmd(gy, 6, 1).getLunar().getJieQiTable() as unknown as Record<string, { toYmd(): string }>;
    for (const [key, solar] of Object.entries(table)) {
      // 拼音键(如 DA_XUE)与中文名重复,只收中文名;个别节气只有拼音键时也兜底收录
      if (/^[A-Z_]+$/.test(key)) continue;
      const d = solar.toYmd();
      if (!out.has(key)) out.set(key, new Set());
      out.get(key)!.add(d);
    }
  }
  const sorted = new Map<string, string[]>();
  for (const [name, set] of out) sorted.set(name, [...set].sort());
  return sorted;
}

export function expandSolarTerm(
  src: SolarTermSource,
  win: Window,
  calId: string,
): Occurrence[] {
  const all = solarTermDatesInRange(win);
  const termDates = all.get(src.term) ?? [];
  const out: Occurrence[] = [];
  for (const d of termDates) {
    for (let i = 0; i < src.days; i++) {
      const date = addDays(d, src.offset_days + i);
      if (cmpDate(date, win.start) < 0 || cmpDate(date, win.end) > 0) continue;
      const descParts: string[] = [];
      descParts.push(
        src.days > 1 ? `${src.term}起第 ${i + 1}/${src.days} 天` : `节气日:${src.term}`,
      );
      if (src.offset_days !== 0 && src.days === 1)
        descParts.push(`${src.term}${src.offset_days > 0 ? '后' : '前'}第 ${Math.abs(src.offset_days)} 天`);
      else if (src.offset_days !== 0)
        descParts.push(`起点:${src.term}${src.offset_days > 0 ? '后' : '前'}第 ${Math.abs(src.offset_days)} 天`);
      if (src.note) descParts.push(src.note);
      out.push({
        uid: makeUid(calId, `term-${src.term}-${src.offset_days}`, date),
        start: date,
        end: addDays(date, 1),
        time: src.time ?? null,
        summary:
          src.days > 1
            ? `⛅ ${src.title}(${i + 1}/${src.days})`
            : `⛅ ${src.title}`,
        description: descParts.join(' | '),
        alarms: mergeAlarms(src),
      });
    }
  }
  return out;
}

/** ---------- 总入口 ---------- */

export function expandSource(
  src: Source,
  ctx: { win: Window; calId: string; holidayData?: Map<number, HolidayCnYear> },
): Occurrence[] {
  switch (src.type) {
    case 'holidays-cn':
      if (!ctx.holidayData) throw new Error('holidays-cn 数据未加载');
      return expandHolidaysCn(src, ctx.holidayData, ctx.win, ctx.calId);
    case 'lunar':
      return expandLunar(src, ctx.win, ctx.calId);
    case 'solar':
      return expandSolar(src, ctx.win, ctx.calId);
    case 'rule':
      return expandRule(src, ctx.win, ctx.calId);
    case 'solar-term':
      return expandSolarTerm(src, ctx.win, ctx.calId);
  }
}
