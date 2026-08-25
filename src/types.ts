import { z } from 'zod';

/** ---------- 基础字段 ---------- */

const timeHHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time 必须是 HH:mm 格式,如 09:00');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD 格式');

/** 提醒:相对事件开始的 ISO8601 负时长,如 -P1D(提前1天)、-PT9H(提前9小时) */
const alarmDuration = z
  .string()
  .regex(/^-P(?=\w)/, 'alarms 必须是负的 ISO8601 时长,如 "-P1D" 或 "-PT9H"');

/** 各事件源的公共字段 */
const eventCommon = {
  title: z.string().min(1, 'title 不能为空'),
  note: z.string().optional(),
  /** 设置后生成定时事件(默认为全天事件),时区取 defaults.timezone */
  time: timeHHmm.optional(),
  /** 相对提醒,如 ["-P1D", "-PT1H"] */
  alarms: z.array(alarmDuration).optional(),
  /** 便捷写法:提前 N 天全天提醒,与 alarms 合并去重 */
  alarm_days_before: z.array(z.number().int().min(0).max(365)).optional(),
};

/** title 可选的公共字段(lunar-festival 用:标题自动取节日名) */
const eventCommonOmitTitle = {
  note: eventCommon.note,
  time: eventCommon.time,
  alarms: eventCommon.alarms,
  alarm_days_before: eventCommon.alarm_days_before,
};

/** ---------- 事件源 ---------- */

export const holidaysCnSource = z.object({
  type: z.literal('holidays-cn'),
  /** 收录法定休息日(默认 true) */
  include_rest_days: z.boolean().default(true),
  /** 收录调休补班日 —— Apple 日历缺失的关键信息(默认 true) */
  include_workdays: z.boolean().default(true),
});

export const lunarSource = z.object({
  type: z.literal('lunar'),
  ...eventCommon,
  title: eventCommon.title,
  /** 农历月,1-12 */
  lunar_month: z.number().int().min(1).max(12),
  /** 农历日,初一=1;当月只有29天而填了30时会自动贴到月末 */
  lunar_day: z.number().int().min(1).max(30),
  /** 出生年份(公历),填写后在描述里显示虚岁 */
  birth_year: z.number().int().min(1900).max(2100).optional(),
  kind: z.enum(['birthday', 'memorial']).default('birthday'),
});

export const solarSource = z.object({
  type: z.literal('solar'),
  ...eventCommon,
  title: eventCommon.title,
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

export const ruleSource = z.object({
  type: z.literal('rule'),
  ...eventCommon,
  title: eventCommon.title,
  freq: z.enum(['weekly', 'monthly', 'yearly', 'once']),
  /** weekly:星期几 mon/tue/wed/thu/fri/sat/sun */
  weekday: z
    .enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    .optional(),
  /** monthly:每月几号 1-31(不足的月份自动贴到月末) */
  day: z.number().int().min(1).max(31).optional(),
  /** yearly:几月 */
  month: z.number().int().min(1).max(12).optional(),
  /** once:具体日期 */
  date: isoDate.optional(),
  /** 限定区间(可选,闭区间) */
  start: isoDate.optional(),
  end: isoDate.optional(),
});

/** 二十四节气名(lunar-typescript 支持的标准写法) */
export const SOLAR_TERM_NAMES = [
  '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降',
  '立冬', '小雪', '大雪', '冬至', '小寒', '大寒',
] as const;

export const solarTermSource = z.object({
  type: z.literal('solar-term'),
  ...eventCommon,
  title: eventCommon.title,
  /** 节气名,如 处暑 / 冬至 */
  term: z.enum(SOLAR_TERM_NAMES),
  /** 相对节气日的偏移天数:-1 = 前一天,默认 0(当天) */
  offset_days: z.number().int().min(-183).max(183).default(0),
  /** 从偏移日起连续展开几天,每天一条事件便于逐日提醒;默认 1(上限一整年) */
  days: z.number().int().min(1).max(366).default(1),
});

/** 内置农历传统节日名(与 sources.ts 的 LUNAR_FESTIVALS 一一对应) */
export const LUNAR_FESTIVAL_NAMES = [
  '元宵节', '龙抬头', '上巳节', '七夕节', '中元节', '中秋节',
  '重阳节', '寒衣节', '下元节', '腊八节', '小年', '除夕',
] as const;

export const lunarFestivalSource = z.object({
  type: z.literal('lunar-festival'),
  /** 标题自动取节日名;仍可覆盖 */
  title: eventCommon.title.optional(),
  festival: z.enum(LUNAR_FESTIVAL_NAMES),
  ...eventCommonOmitTitle,
});

export const sourceSchema = z.discriminatedUnion('type', [
  holidaysCnSource,
  lunarSource,
  solarSource,
  ruleSource,
  solarTermSource,
  lunarFestivalSource,
]);

export type HolidayCnSource = z.infer<typeof holidaysCnSource>;
export type LunarSource = z.infer<typeof lunarSource>;
export type SolarSource = z.infer<typeof solarSource>;
export type RuleSource = z.infer<typeof ruleSource>;
export type SolarTermSource = z.infer<typeof solarTermSource>;
export type LunarFestivalSource = z.infer<typeof lunarFestivalSource>;
export type Source = z.infer<typeof sourceSchema>;

/** ---------- 日历与全局配置 ---------- */

export const calendarSchema = z.object({
  /** 文件名的一部分,小写字母数字连字符 */
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'id 只能是小写字母、数字、连字符'),
  name: z.string().min(1),
  description: z.string().optional(),
  sources: z.array(sourceSchema).min(1, '每个日历至少要有一个 sources'),
  /**
   * 订阅方式:
   *   public  —— 订阅页公开展示链接(默认)
   *   private —— 首页不展示;.ics 写入 /s/<令牌>/ 路径,
   *              令牌 = sha256(访问密钥SHA-256 + '|' + id) 前 32 位,
   *              专属链接在编辑页对应日历区域查看/复制。
   *              私密要求已配置访问密钥(CAL_EDITOR_KEY),否则构建报错。
   */
  access: z.enum(['public', 'private']).default('public'),
});

/** 在线编辑器的访问门禁:UUID 本身绝不入库,只存其 SHA-256 */
export const editorAuthSchema = z.object({
  /** pnpm cal:key 生成的 SHA-256 十六进制(64 位小写) */
  key_sha256: z.string().regex(/^[a-f0-9]{64}$/, 'key_sha256 必须是 64 位十六进制 SHA-256'),
  /** 忘记密钥时的提示语(可选,会公开展示,别写敏感信息) */
  hint: z.string().max(100).optional(),
});

export const configSchema = z.object({
  /** 部署后的公开地址(不含末尾斜杠),用于在 index.html 里生成 webcal:// 链接;空串视为未设置 */
  site_base_url: z
    .string()
    .default('')
    .refine((s) => s === '' || /^https?:\/\//.test(s), 'site_base_url 必须以 http:// 或 https:// 开头,或留空'),
  /** 在线编辑器访问门禁(可选;不配置则编辑页对知道地址的人开放,提交仍需 GitHub Token) */
  editor_auth: editorAuthSchema.optional(),
  defaults: z
    .object({
      timezone: z.string().default('Asia/Shanghai'),
      /** 向未来展开几年(建议 ≥1,iOS 订阅同步窗口有限,2 年较稳妥) */
      years_ahead: z.number().int().min(1).max(10).default(2),
      timezone_emoji: z.boolean().default(true),
    })
    .prefault({}),
  calendars: z.array(calendarSchema).min(1, '至少定义一个日历'),
});

export type CalendarDef = z.infer<typeof calendarSchema>;
export type AppConfig = z.infer<typeof configSchema>;

/** ---------- 内部规范化事件 ---------- */

export interface Occurrence {
  uid: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD(排他,全天事件通常为次日) */
  end: string;
  /** null=全天事件;否则为 HH:mm 的定时事件 */
  time: string | null;
  summary: string;
  description?: string;
  alarms: string[];
  /**
   * RFC 5545 RRULE 规则体(如 `FREQ=DAILY;COUNT=90`、`FREQ=MONTHLY;UNTIL=20281225T235959Z`)。
   * 存在时,start/end 仅描述首个发生日;订阅端按规则自行展开后续发生日。
   * 用于节气连续场景与周/月/年循环——避免把每个发生日物化成独立 VEVENT。
   */
  rrule?: string;
}

/** holiday-cn 官方数据结构(NateScarlet/holiday-cn) */
export interface HolidayCnYear {
  year: number;
  /** 国务院公告原文链接 */
  papers: string[];
  days: { name: string; date: string; isOffDay: boolean }[];
}
