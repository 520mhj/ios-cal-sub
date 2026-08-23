/** 日期工具:全部以 UTC 语义处理纯日期字符串,避免时区偏移问题 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> YYYY-MM-DD */
export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** YYYY-MM-DD -> Date(UTC 午夜) */
export function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`非法日期: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/** 本机时区今天的 YYYY-MM-DD(生成窗口的锚点) */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 某年某月的天数(m: 1-12) */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 比较两个 YYYY-MM-DD:a<b 返回 -1,a>b 返回 1,相等返回 0 */
export function cmpDate(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** HH:mm 加 N 分钟,返回 {date, hhmm},支持跨天进位(date 为基准日) */
export function addMinutesToTime(
  baseDateCompact: string,
  hhmm: string,
  minutes: number,
): { date: string; hhmm: string } {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let date = baseDateCompact;
  while (total >= 1440) {
    total -= 1440;
    date = addDays(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      1,
    ).replace(/-/g, '');
  }
  return { date, hhmm: `${pad(Math.floor(total / 60))}${pad(total % 60)}` };
}
