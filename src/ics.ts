/**
 * 极简 RFC 5545 ICS 写入器。
 * 要点:CRLF 行尾、75 八折行(UTF-8 安全)、TEXT 转义、稳定 UID、
 * 全天事件用 VALUE=DATE(排他 DTEND)、定时事件带 VTIMEZONE(TZID)。
 */
import type { Occurrence } from './types.js';
import { addMinutesToTime } from './dates.js';

const CRLF = '\r\n';

/** TEXT 值转义(RFC 5545 §3.3.11) */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 按 RFC 5545 把超长行折叠为 ≤75 八字节的连续行(续行前导一个空格) */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let pos = 0;
  let first = true;
  while (pos < bytes.length) {
    const maxContent = first ? 75 : 74; // 续行含 1 字节前导空格
    let end = Math.min(pos + maxContent, bytes.length);
    // 回退到 UTF-8 字符边界,避免拆开多字节字符
    while (end > pos && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === pos) end = Math.min(pos + maxContent, bytes.length); // 防御异常字节
    parts.push((first ? '' : ' ') + bytes.subarray(pos, end).toString('utf8'));
    pos = end;
    first = false;
  }
  return parts.join(CRLF);
}

export interface CalendarMeta {
  name: string;
  description?: string;
  timezone: string;
  /** DTSTAMP/LAST-MODIFIED,格式 YYYYMMDDTHHMMSSZ */
  stampUtc: string;
}

/** 最小 VTIMEZONE。仅对 Asia/Shanghai 发出固定 +0800 块;其他时区省略(iOS 会按 TZID 名查系统时区库) */
function vtimezone(tzid: string): string[] {
  if (tzid !== 'Asia/Shanghai') return [];
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}

function eventLines(ev: Occurrence, meta: CalendarMeta): string[] {
  const compact = ev.start.replace(/-/g, '');
  const L: string[] = ['BEGIN:VEVENT'];
  L.push(`UID:${ev.uid}`);
  L.push(`DTSTAMP:${meta.stampUtc}`);
  if (ev.time) {
    L.push(`DTSTART;TZID=${meta.timezone}:${compact}T${ev.time.replace(':', '')}00`);
    const endT = addMinutesToTime(compact, ev.time, 30); // 定时事件默认 30 分钟
    L.push(`DTEND;TZID=${meta.timezone}:${endT.date}T${endT.hhmm}00`);
  } else {
    L.push(`DTSTART;VALUE=DATE:${compact}`);
    L.push(`DTEND;VALUE=DATE:${ev.end.replace(/-/g, '')}`);
  }
  // RFC 5545 重复规则:存在时 start 仅是首个发生日,订阅端自行展开
  if (ev.rrule) L.push(`RRULE:${ev.rrule}`);
  L.push(`SUMMARY:${escapeText(ev.summary)}`);
  if (ev.description) L.push(`DESCRIPTION:${escapeText(ev.description)}`);
  L.push(`LAST-MODIFIED:${meta.stampUtc}`);
  for (const a of ev.alarms) {
    L.push('BEGIN:VALARM');
    L.push('ACTION:DISPLAY');
    L.push(`TRIGGER:${a}`);
    L.push(`DESCRIPTION:${escapeText(ev.summary)}`);
    L.push('END:VALARM');
  }
  L.push('END:VEVENT');
  return L;
}

export function buildIcs(meta: CalendarMeta, events: Occurrence[]): string {
  const L: string[] = [];
  L.push('BEGIN:VCALENDAR');
  L.push('VERSION:2.0');
  L.push('PRODID:-//ios-cal-sub//calendar-subscription//ZH-CN');
  L.push('CALSCALE:GREGORIAN');
  L.push('METHOD:PUBLISH');
  L.push(`X-WR-CALNAME:${escapeText(meta.name)}`);
  if (meta.description) L.push(`X-WR-CALDESC:${escapeText(meta.description)}`);
  L.push(`X-WR-TIMEZONE:${meta.timezone}`);
  // 提示订阅端每 12 小时自动刷新(Apple 对此属性的支持有限,但无害)
  L.push('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
  L.push('X-PUBLISHED-TTL:PT12H');
  L.push(...vtimezone(meta.timezone));
  for (const ev of events) L.push(...eventLines(ev, meta));
  L.push('END:VCALENDAR');
  return L.map(foldLine).join(CRLF) + CRLF;
}
