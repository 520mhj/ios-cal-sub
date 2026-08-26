/** 事件源展开:把配置中的各类型 source 展开为窗口内的具体事件 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Lunar, LunarMonth, Solar } from 'lunar-typescript';
import {
  LUNAR_FESTIVALS,
  LUNAR_FESTIVAL_ALIASES,
  SOLAR_TERM_NAMES,
} from './types.js';
import type {
  HolidayCnSource,
  HolidayCnYear,
  LunarFestivalSource,
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
  src: LunarSource | SolarSource | RuleSource | SolarTermSource | LunarFestivalSource,
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

/**
 * 法定假期里"真正的节日当天"解析:名称匹配到哪条规则,就用它算出当年的节日公历日。
 * 例如春节假期可能从除夕开始,但「春节」是正月初一;清明是节气日;端午/中秋是农历固定日。
 */
const FEST_DATE_RESOLVERS: { re: RegExp; fn: (y: number) => string | null }[] = [
  { re: /春节/, fn: (y) => lunarToSolar(y, 1, 1) }, // 正月初一
  { re: /清明/, fn: (y) => (solarTermDatesInRange({ start: `${y}-01-01`, end: `${y}-12-31` }).get('清明') ?? []).find((d) => d.startsWith(String(y))) ?? null },
  { re: /端午/, fn: (y) => lunarToSolar(y, 5, 5) },
  { re: /中秋/, fn: (y) => lunarToSolar(y, 8, 15) },
  { re: /国庆/, fn: (y) => `${y}-10-01` },
  { re: /元旦/, fn: (y) => `${y}-01-01` },
  { re: /劳动/, fn: (y) => `${y}-05-01` },
];

function festivalDatesFor(name: string, year: number): Set<string> {
  const out = new Set<string>();
  for (const r of FEST_DATE_RESOLVERS) {
    if (!r.re.test(name)) continue;
    const d = r.fn(year);
    if (d) out.add(d);
  }
  return out;
}

export function expandHolidaysCn(
  src: HolidayCnSource,
  data: Map<number, HolidayCnYear>,
  win: Window,
  calId: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const yearData of data.values()) {
    // 按「连续同名休息日」分组,算出假期总天数与第几天;
    // 组内若包含"真节日当天"(如初一/清明/五月初五/八月十五/10·1),
    // 那天单独显示为「🧨 春节」「🌸 清明节」,其余显示进度(「…假期 2/9」)
    const offDays = yearData.days
      .filter((d) => d.isOffDay && cmpDate(d.date, win.start) >= 0 && cmpDate(d.date, win.end) <= 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const groups: { name: string; days: typeof offDays }[] = [];
    for (const d of offDays) {
      const g = groups[groups.length - 1];
      const prev = g?.days[g.days.length - 1];
      if (g && prev && g.name === d.name && addDays(prev.date, 1) === d.date) g.days.push(d);
      else groups.push({ name: d.name, days: [d] });
    }
    const spanByName = new Map<string, { i: number; n: number; start: string; isFest: boolean }>();
    for (const g of groups) {
      const festDates = festivalDatesFor(g.name, Number(g.days[0]!.date.slice(0, 4)));
      g.days.forEach((d, idx) =>
        spanByName.set(d.date, {
          i: idx + 1,
          n: g.days.length,
          start: g.days[0]!.date,
          isFest: festDates.has(d.date),
        }),
      );
    }

    for (const day of yearData.days) {
      if (cmpDate(day.date, win.start) < 0 || cmpDate(day.date, win.end) > 0) continue;
      if (day.isOffDay && !src.include_rest_days) continue;
      if (!day.isOffDay && !src.include_workdays) continue;
      const emoji = festEmoji(day.name);
      if (day.isOffDay) {
        const span = spanByName.get(day.date)!;
        let summary: string;
        if (span.isFest) {
          summary = `${emoji} ${day.name}`; // 节日当天:独立、醒目
        } else if (span.n === 1) {
          summary = `${emoji} ${day.name}`;
        } else {
          summary = `${emoji} ${day.name}假期 ${span.i}/${span.n}`;
        }
        const descParts = [
          span.isFest ? `🎉 今天${day.name.replace(/节假日?$/, '')}!` : '',
          span.n === 1
            ? '法定节假日。'
            : `法定节假日 · 假期 ${span.start} ~ ${addDays(span.start, span.n - 1)},共 ${span.n} 天(第 ${span.i} 天)。`,
          '数据来源:NateScarlet/holiday-cn',
        ];
        out.push({
          uid: makeUid(calId, 'holiday-cn', day.date),
          start: day.date,
          end: addDays(day.date, 1),
          time: null,
          summary,
          description: descParts.filter(Boolean).join(' '),
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
  const descParts = [FREQ_TEXT[src.freq]];
  if (src.time) descParts.push(`时间 ${src.time}`);
  if (src.note) descParts.push(src.note);
  const base = {
    time: src.time ?? null,
    summary: `⏰ ${src.title}`,
    description: descParts.join(' | '),
    alarms: mergeAlarms(src),
  };

  const untilCompact = range.end.replace(/-/g, '');
  // UNTIL 的类型必须与 DTSTART 一致:定时事件用 UTC 日期时间,全天用日期
  const until = base.time ? `${untilCompact}T235959Z` : untilCompact;

  // ---- 可安全表达为 RFC 5545 RRULE 的形态:单条定义,订阅端自行展开 ----
  // 月循环 day>28 或 2月29日 无法用 BYMONTHDAY 表达"钳到月末"的语义,回退为逐年物化。
  if (src.freq === 'weekly' && src.weekday) {
    // 找窗口内第一个目标星期
    let d = range.start;
    for (let i = 0; i < 7 && new Date(`${d}T00:00:00Z`).getUTCDay() !== WEEKDAY_NUM[src.weekday]; i++)
      d = addDays(d, 1);
    if (cmpDate(d, range.end) <= 0)
      return [{
        ...base,
        uid: makeUid(calId, `rule-${src.title}`, 'weekly'),
        start: d,
        end: addDays(d, 1),
        rrule: `FREQ=WEEKLY;UNTIL=${until}`,
      }];
    return [];
  }
  if (src.freq === 'monthly' && src.day != null && src.day <= 28) {
    let y = Number(range.start.slice(0, 4));
    let m = Number(range.start.slice(5, 7));
    for (;;) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(src.day).padStart(2, '0')}`;
      if (cmpDate(date, range.start) >= 0) {
        if (cmpDate(date, range.end) > 0) return [];
        return [{
          ...base,
          uid: makeUid(calId, `rule-${src.title}`, 'monthly'),
          start: date,
          end: addDays(date, 1),
          rrule: `FREQ=MONTHLY;UNTIL=${until}`,
        }];
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  if (src.freq === 'yearly' && !(src.month === 2 && src.day === 29)) {
    const startY = Number(range.start.slice(0, 4));
    for (let y = startY; y <= Number(range.end.slice(0, 4)); y++) {
      const date = `${y}-${String(src.month!).padStart(2, '0')}-${String(Math.min(src.day!, lastDayOfMonth(y, src.month!))).padStart(2, '0')}`;
      if (cmpDate(date, range.start) >= 0) {
        if (cmpDate(date, range.end) > 0) return [];
        return [{
          ...base,
          uid: makeUid(calId, `rule-${src.title}`, 'yearly'),
          start: date,
          end: addDays(date, 1),
          rrule: `FREQ=YEARLY;UNTIL=${until}`,
        }];
      }
    }
    return [];
  }

  // ---- 物化回退:once、月末钳制语义(day>28 / 2·29)等 ----
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
    // yearly(含 2·29 跳过非闰年的既有语义)
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

  return dates.map((date) => ({
    ...base,
    uid: makeUid(calId, `rule-${src.title}`, date),
    start: date,
    end: addDays(date, 1),
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
    const anchor = addDays(d, src.offset_days);
    const lastDay = addDays(anchor, src.days - 1);
    // 序列与窗口有交集才生成
    if (cmpDate(lastDay, win.start) < 0 || cmpDate(anchor, win.end) > 0) continue;

    // 多天序列物化为逐日独立事件:标题携带 (n/N) 进度、UID 按日期稳定。
    // (曾试过每年一条 + RRULE:FREQ=DAILY;COUNT=N,但单条定义的 SUMMARY 无法逐日变化,
    //  用户裁定进度数字优先 —— 见 docs/KNOWLEDGE-BASE.md §12)
    for (let i = 0; i < src.days; i++) {
      const date = addDays(anchor, i);
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

/** ---------- 农历传统节日(预设定义在 types.ts,单一事实源) ---------- */

export function expandLunarFestival(
  src: LunarFestivalSource,
  win: Window,
  calId: string,
): Occurrence[] {
  // 旧名兼容:如 '小年' → '小年(北方)';展示名一律用规范名
  const canonical = LUNAR_FESTIVAL_ALIASES[src.festival] ?? src.festival;
  const preset = LUNAR_FESTIVALS[canonical];
  if (!preset) throw new Error(`未知传统节日:${src.festival}`);
  // title 若只是旧名/与节日同名,升级为规范名;用户真正自定义的标题则保留
  const t = src.title?.trim();
  const displayName =
    !t || t === src.festival || t === canonical || LUNAR_FESTIVAL_ALIASES[t]
      ? canonical
      : t;
  const out: Occurrence[] = [];

  if (preset.term) {
    // 节气锚定(如冬至):直接用节气表
    for (const solar of solarTermDatesInRange(win).get(preset.term) ?? []) {
      if (cmpDate(solar, win.start) < 0 || cmpDate(solar, win.end) > 0) continue;
      out.push({
        uid: makeUid(calId, `lf-${src.festival}`, solar),
        start: solar,
        end: addDays(solar, 1),
        time: src.time ?? null,
        summary: `${preset.emoji} ${displayName}`,
        description: [`传统节日 · ${preset.term}(公历 ${solar})`, src.note].filter(Boolean).join(' | '),
        alarms: mergeAlarms(src),
      });
    }
    return out;
  }

  // 农历锚定
  const yStart = Number(win.start.slice(0, 4)) - 1;
  const yEnd = Number(win.end.slice(0, 4)) + 1;
  for (let ly = yStart; ly <= yEnd; ly++) {
    let solar: string | null;
    let dateText: string;
    if (preset.d === 'last') {
      // 除夕 = 腊月最后一天(廿九或三十)
      const m = preset.m!;
      const dc = LunarMonth.fromYm(ly, m)?.getDayCount() ?? 30;
      solar = lunarToSolar(ly, m, dc);
      dateText = `农历腊月${dc === 30 ? '三十' : '廿九'}`;
    } else {
      solar = lunarToSolar(ly, preset.m!, preset.d!);
      dateText = `农历${preset.m}月${preset.d}日`;
    }
    if (!solar) continue;
    if (cmpDate(solar, win.start) < 0 || cmpDate(solar, win.end) > 0) continue;
    out.push({
      uid: makeUid(calId, `lf-${src.festival}`, solar),
      start: solar,
      end: addDays(solar, 1),
      time: src.time ?? null,
      summary: `${preset.emoji} ${displayName}`,
      description: [`传统节日 · ${dateText}`, src.note].filter(Boolean).join(' | '),
      alarms: mergeAlarms(src),
    });
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
    case 'lunar-festival':
      return expandLunarFestival(src, ctx.win, ctx.calId);
  }
}
