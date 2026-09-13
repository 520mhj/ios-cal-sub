/**
 * 内置节假日数据(来源:NateScarlet/holiday-cn,国务院公告自动化解析)
 *
 * 为什么内置到代码里而不是运行时 fetch:
 *   1. Cloudflare Workers 没有文件系统,不能像本地构建那样读 data/holiday-cn/*.json
 *   2. 内置后零外部依赖,冷启动更快,不依赖 holiday-cn 仓库的可用性
 *   3. 数据量小(每年约 40 条,3 年不到 10KB),内置成本可忽略
 *
 * 更新方法:运行 pnpm cal:fetch 拉取最新数据到 data/holiday-cn/,
 * 然后运行 tsx scripts/gen-holiday-data.ts 重新生成本文件。
 */
import type { HolidayCnYear } from './types.js';

const RAW: HolidayCnYear[] = [
  {
    year: 2025,
    papers: ['https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm'],
    days: [
      { name: '元旦', date: '2025-01-01', isOffDay: true },
      { name: '春节', date: '2025-01-26', isOffDay: false },
      { name: '春节', date: '2025-01-28', isOffDay: true },
      { name: '春节', date: '2025-01-29', isOffDay: true },
      { name: '春节', date: '2025-01-30', isOffDay: true },
      { name: '春节', date: '2025-01-31', isOffDay: true },
      { name: '春节', date: '2025-02-01', isOffDay: true },
      { name: '春节', date: '2025-02-02', isOffDay: true },
      { name: '春节', date: '2025-02-03', isOffDay: true },
      { name: '春节', date: '2025-02-04', isOffDay: true },
      { name: '春节', date: '2025-02-08', isOffDay: false },
      { name: '清明节', date: '2025-04-04', isOffDay: true },
      { name: '清明节', date: '2025-04-05', isOffDay: true },
      { name: '清明节', date: '2025-04-06', isOffDay: true },
      { name: '劳动节', date: '2025-04-27', isOffDay: false },
      { name: '劳动节', date: '2025-05-01', isOffDay: true },
      { name: '劳动节', date: '2025-05-02', isOffDay: true },
      { name: '劳动节', date: '2025-05-03', isOffDay: true },
      { name: '劳动节', date: '2025-05-04', isOffDay: true },
      { name: '劳动节', date: '2025-05-05', isOffDay: true },
      { name: '端午节', date: '2025-05-31', isOffDay: true },
      { name: '端午节', date: '2025-06-01', isOffDay: true },
      { name: '端午节', date: '2025-06-02', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-09-28', isOffDay: false },
      { name: '国庆节、中秋节', date: '2025-10-01', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-02', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-03', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-04', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-05', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-06', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-07', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-08', isOffDay: true },
      { name: '国庆节、中秋节', date: '2025-10-11', isOffDay: false },
    ],
  },
  {
    year: 2026,
    papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
    days: [
      { name: '元旦', date: '2026-01-01', isOffDay: true },
      { name: '元旦', date: '2026-01-02', isOffDay: true },
      { name: '元旦', date: '2026-01-03', isOffDay: true },
      { name: '元旦', date: '2026-01-04', isOffDay: false },
      { name: '春节', date: '2026-02-14', isOffDay: false },
      { name: '春节', date: '2026-02-15', isOffDay: true },
      { name: '春节', date: '2026-02-16', isOffDay: true },
      { name: '春节', date: '2026-02-17', isOffDay: true },
      { name: '春节', date: '2026-02-18', isOffDay: true },
      { name: '春节', date: '2026-02-19', isOffDay: true },
      { name: '春节', date: '2026-02-20', isOffDay: true },
      { name: '春节', date: '2026-02-21', isOffDay: true },
      { name: '春节', date: '2026-02-22', isOffDay: true },
      { name: '春节', date: '2026-02-23', isOffDay: true },
      { name: '春节', date: '2026-02-28', isOffDay: false },
      { name: '清明节', date: '2026-04-04', isOffDay: true },
      { name: '清明节', date: '2026-04-05', isOffDay: true },
      { name: '清明节', date: '2026-04-06', isOffDay: true },
      { name: '劳动节', date: '2026-05-01', isOffDay: true },
      { name: '劳动节', date: '2026-05-02', isOffDay: true },
      { name: '劳动节', date: '2026-05-03', isOffDay: true },
      { name: '劳动节', date: '2026-05-04', isOffDay: true },
      { name: '劳动节', date: '2026-05-05', isOffDay: true },
      { name: '劳动节', date: '2026-05-09', isOffDay: false },
      { name: '端午节', date: '2026-06-19', isOffDay: true },
      { name: '端午节', date: '2026-06-20', isOffDay: true },
      { name: '端午节', date: '2026-06-21', isOffDay: true },
      { name: '国庆节', date: '2026-09-20', isOffDay: false },
      { name: '中秋节', date: '2026-09-25', isOffDay: true },
      { name: '中秋节', date: '2026-09-26', isOffDay: true },
      { name: '中秋节', date: '2026-09-27', isOffDay: true },
      { name: '国庆节', date: '2026-10-01', isOffDay: true },
      { name: '国庆节', date: '2026-10-02', isOffDay: true },
      { name: '国庆节', date: '2026-10-03', isOffDay: true },
      { name: '国庆节', date: '2026-10-04', isOffDay: true },
      { name: '国庆节', date: '2026-10-05', isOffDay: true },
      { name: '国庆节', date: '2026-10-06', isOffDay: true },
      { name: '国庆节', date: '2026-10-07', isOffDay: true },
      { name: '国庆节', date: '2026-10-10', isOffDay: false },
    ],
  },
];

/** 内置节假日数据 Map:year -> HolidayCnYear */
export const HOLIDAY_DATA: Map<number, HolidayCnYear> = new Map(
  RAW.map((y) => [y.year, y]),
);
