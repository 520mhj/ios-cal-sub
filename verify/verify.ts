/**
 * 验证 dist/ 下生成的日历:
 *  1. 物理格式:CRLF、行 ≤75 八字节、VCALENDAR 配对、UID 唯一
 *  2. 第三方回读:ts-ics convertIcsCalendar 能完整解析且事件数与 manifest 一致
 *  3. 数据抽查:
 *     - 缓存数据里每个调休补班日都在 cn-holidays 中有对应事件
 *     - 农历换算已知事实校验(2000 年八月十五 = 2000-09-12)
 *     - family-days 含配置中的农历生日(2026 八月十五 → 2026-09-25)
 *     - monthly 规则事件数量与独立推算一致;定时事件带正确 TZID
 */
import fs from 'node:fs';
import path from 'node:path';
import { convertIcsCalendar } from 'ts-ics';
import { parse as parseYaml } from 'yaml';
import { lunarToSolar, solarTermDatesInRange } from '../src/sources.js';
import { configSchema } from '../src/types.js';
import { dumpYaml } from '../src/yaml-dump.js';
import { resolveConfig } from '../src/generate.js';

let failures = 0;
const fail = (msg: string) => {
  console.error(`   ❌ ${msg}`);
  failures++;
};
const pass = (msg: string) => console.log(`   ✅ ${msg}`);

const distDir = path.resolve('dist');
if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
  console.error('❌ dist/manifest.json 不存在,请先运行 pnpm cal:build');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')) as {
  window: { start: string; end: string };
  calendars: { id: string; name: string; file: string; count: number }[];
};

console.log('\n━━ 1. 逐文件结构与回读 ━━');
interface ParsedCal {
  raw: string;
  events: { uid: string; summary?: string; start?: unknown }[];
}
const parsed = new Map<string, ParsedCal>();

for (const cal of manifest.calendars) {
  console.log(`\n▶ ${cal.file} (${cal.name})`);
  const raw = fs.readFileSync(path.join(distDir, cal.file), 'utf8');
  if (!raw.startsWith('BEGIN:VCALENDAR\r\n')) fail('开头不是 BEGIN:VCALENDAR(CRLF)');
  else pass('CRLF 开头正确');
  if (!raw.endsWith('END:VCALENDAR\r\n')) fail('结尾不是 END:VCALENDAR(CRLF)');
  else pass('CRLF 结尾正确');

  const longLines = raw.split('\r\n').filter((l) => Buffer.byteLength(l, 'utf8') > 75);
  if (longLines.length > 0) fail(`有 ${longLines.length} 行超过 75 八字节: ${longLines[0]!.slice(0, 50)}…`);
  else pass('所有物理行 ≤75 字节(RFC 5545 折行合规)');
  if (raw.includes('\n') && !raw.includes('\r\n')) fail('包含裸 LF');
  else pass('无裸 LF');

  let calObj;
  try {
    calObj = convertIcsCalendar(undefined, raw);
    pass(`ts-ics 回读解析成功:${calObj.events?.length ?? 0} 个事件`);
  } catch (e) {
    fail(`ts-ics 解析失败:${(e as Error).message}`);
    continue;
  }
  const events = calObj.events ?? [];
  if (events.length !== cal.count) fail(`事件数不一致:manifest=${cal.count},实际解析=${events.length}`);
  else pass(`事件数与 manifest 一致(${cal.count})`);

  const uids = events.map((e) => e.uid);
  const dup = uids.filter((u, i) => uids.indexOf(u) !== i);
  if (dup.length > 0) fail(`UID 重复:${[...new Set(dup)].join(', ')}`);
  else pass(`UID 全局唯一(${uids.length} 个)`);

  const noStamp = events.filter((e) => !e.start).length;
  if (noStamp > 0) fail(`${noStamp} 个事件缺 DTSTART`);
  parsed.set(cal.id, { raw, events });
}

console.log('\n━━ 2. 调休补班日抽查(Apple 日历缺失的关键)━━');
{
  const cal = parsed.get('cn-holidays');
  if (!cal) {
    console.log('   (跳过:未生成 cn-holidays)');
  } else {
    const dataDir = path.resolve('data/holiday-cn');
    const win = manifest.window;
    const inWin = (d: string) => d >= win.start && d <= win.end;
    let checked = 0;
    let missing = 0;
    for (const f of fs.readdirSync(dataDir)) {
      const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      for (const day of j.days ?? []) {
        if (!inWin(day.date)) continue;
        const compact = day.date.replace(/-/g, '');
        const hit = cal.events.some(
          (e) =>
            JSON.stringify(e.start ?? {}).includes(compact) ||
            cal.raw.includes(`DTSTART;VALUE=DATE:${compact}`),
        );
        // 更精确:按 UID 前缀对应的日期逐条比对
        const exact = cal.raw.includes(`DTSTART;VALUE=DATE:${compact}`);
        void hit;
        if (!exact) {
          missing++;
          fail(`补班日 ${day.date}(${day.name})未出现在 cn-holidays.ics`);
        }
        checked++;
      }
    }
    if (missing === 0) pass(`窗口内全部 ${checked} 个节假日条目(含补班)均有对应事件`);
  }
}

console.log('\n━━ 3. 农历换算抽查 ━━');
{
  const known: [number, number, number, string][] = [
    [2000, 8, 15, '2000-09-12'], // 2000 年中秋节
    [2026, 8, 15, '2026-09-25'], // 2026 年中秋节
    [2025, 1, 1, '2025-01-29'], // 2025 春节(正月初一)
  ];
  for (const [y, m, d, expect] of known) {
    const got = lunarToSolar(y, m, d);
    if (got !== expect) fail(`农历 ${y}-${m}-${d} 应为公历 ${expect},得到 ${got}`);
    else pass(`农历 ${y} 年 ${m} 月 ${d} 日 → 公历 ${got} ✓`);
  }

  const fam = parsed.get('family-days');
  if (fam) {
    const okDate = fam.raw.includes('DTSTART;VALUE=DATE:20260925') && fam.events.some((e) => (e.summary ?? '').includes('妈妈·生日'));
    if (okDate) pass('family-days 含 2026-09-25「妈妈·生日」(农历八月十五)');
    else fail('family-days 缺少预期的农历生日事件');

    // 虚岁检查:1965 年生 → 农历 2026 年虚岁 62
    const descHit = [...fam.raw.matchAll(/DESCRIPTION:(.+)/g)].some((m) => m[1]!.includes('虚岁 62'));
    if (descHit) pass('虚岁计算正确(2026 农历年 − 1965 + 1 = 62)');
    else fail('未找到虚岁 62 的描述');
  }
}

console.log('\n━━ 4. 周期规则与定时事件抽查 ━━');
{
  const rec = parsed.get('recurring');
  if (!rec) {
    console.log('   (跳过:未生成 recurring)');
  } else {
    // 每月还款:窗口内每个月都应有一条
    const repayCount = rec.events.filter((e) => (e.summary ?? '').includes('信用卡还款日')).length;
    const win = manifest.window;
    const startY = Number(win.start.slice(0, 4));
    const startM = Number(win.start.slice(5, 7));
    const endY = Number(win.end.slice(0, 4));
    const endM = Number(win.end.slice(5, 7));
    const expectMonths = (endY - startY) * 12 + (endM - startM) + 1; // 窗口起点早于每月 25 号时成立
    if (repayCount === expectMonths)
      pass(`monthly 还款事件数量正确(${repayCount} = 窗口内 ${expectMonths} 个月)`);
    else if (Math.abs(repayCount - expectMonths) <= 1)
      pass(`monthly 还款事件数量合理(${repayCount} ≈ 窗口 ${expectMonths} 月,边界月差异属预期)`);
    else fail(`monthly 还款事件数量异常:${repayCount},期望约 ${expectMonths}`);

    // 定时事件必须带 TZID 且时间正确
    const timedOk = /DTSTART;TZID=Asia\/Shanghai:\d{8}T193000/.test(rec.raw);
    if (timedOk) pass('定时事件 DTSTART 带 TZID=Asia/Shanghai 且时间 19:30 正确');
    else fail('未找到 19:30 的 TZID 定时事件');

    // VALARM 存在性
    const alarmCount = (rec.raw.match(/BEGIN:VALARM/g) ?? []).length;
    if (alarmCount >= repayCount * 2) pass(`提醒数量充足(${alarmCount} 个 VALARM)`);
    else fail(`VALARM 数量偏少:${alarmCount}`);
  }
}

console.log('\n━━ 5. index.html / manifest 一致性 ━━');
{
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const missingLink = manifest.calendars.filter((c) => !html.includes(c.file));
  if (missingLink.length === 0) pass('index.html 包含全部日历链接');
  else fail(`index.html 缺少链接:${missingLink.map((c) => c.id).join(', ')}`);
}

console.log('\n━━ 6. 在线编辑器产物(Pages /editor/)━━');
{
  const dataPath = path.join(distDir, 'data.json');
  const edIndex = path.join(distDir, 'editor', 'index.html');
  const edAuth = path.join(distDir, 'editor', 'auth.json');

  let dataObj: { config: unknown } | null = null;
  try {
    dataObj = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const re = configSchema.safeParse(dataObj!.config);
    if (re.success) pass('data.json 结构化配置可被 zod schema 完整校验');
    else fail(`data.json 配置不符合 schema:${re.error.issues[0]!.path.join('.')} ${re.error.issues[0]!.message}`);

    // YAML 序列化往返一致性(浏览器提交的内容必须能被 Node 端原样读回)
    const yamlText = dumpYaml(re.success ? re.data : dataObj!.config);
    const reparsed = parseYaml(yamlText);
    if (JSON.stringify(reparsed) === JSON.stringify(dataObj!.config)) pass('dumpYaml 往返无损(YAML → 对象逐字段一致)');
    else fail('dumpYaml 往返有差异:序列化的 YAML 解析后与原对象不一致');
  } catch (e) {
    fail(`data.json 检查失败:${(e as Error).message}`);
  }

  if (fs.existsSync(edIndex) && fs.readFileSync(edIndex, 'utf8').includes('在线编辑器'))
    pass('editor/index.html 已生成且注入了页面主体');
  else fail('editor/index.html 缺失或内容异常');

  if (fs.existsSync(edIndex)) {
    const html = fs.readFileSync(edIndex, 'utf8');
    if (/const dumpYaml\s*=\s*function/.test(html)) pass('编辑器已内嵌 YAML 序列化函数(保存链路可用)');
    else fail('编辑器未注入 dumpYaml 函数');
  }

  try {
    const authInfo = JSON.parse(fs.readFileSync(edAuth, 'utf8')) as { enabled: boolean; sha256: string; hint?: string };
    // 与「解析后」的配置比对(环境变量优先,yaml 兜底)——和构建时同一套逻辑
    const rawCfg = configSchema.parse(parseYaml(fs.readFileSync(path.resolve('calendars.yaml'), 'utf8')));
    const eff = resolveConfig(rawCfg);
    const wantEnabled = !!eff.editor_auth?.key_sha256;
    if (authInfo.enabled === wantEnabled && authInfo.sha256 === (eff.editor_auth?.key_sha256 ?? ''))
      pass(`auth.json 与生效配置一致(门禁${wantEnabled ? '已启用' : '未启用'})`);
    else fail('auth.json 与解析后的 editor_auth 不一致');
  } catch (e) {
    fail(`auth.json 检查失败:${(e as Error).message}`);
  }
}

console.log('\n━━ 6. 节气事件抽查 ━━');
{
  // 已知公开事实:2025 处暑 = 08-23,2024 处暑 = 08-22,2026 冬至 = 12-22
  const table25 = solarTermDatesInRange({ start: '2025-08-01', end: '2025-08-31' });
  const chushu25 = (table25.get('处暑') ?? []).filter((d) => d.startsWith('2025'));
  if (chushu25.includes('2025-08-23')) pass('处暑 2025 = 2025-08-23 ✓(与公开资料一致)');
  else fail(`处暑 2025 计算异常:${chushu25.join(',') || '(空)'}`);

  const table24 = solarTermDatesInRange({ start: '2024-08-01', end: '2024-08-31' });
  const chushu24 = (table24.get('处暑') ?? []).filter((d) => d.startsWith('2024'));
  if (chushu24.includes('2024-08-22')) pass('处暑 2024 = 2024-08-22 ✓(与公开资料一致)');
  else fail(`处暑 2024 计算异常:${chushu24.join(',') || '(空)'}`);

  const table26 = solarTermDatesInRange({ start: '2026-12-01', end: '2026-12-31' });
  const dongzhi26 = (table26.get('冬至') ?? []).filter((d) => d.startsWith('2026'));
  if (dongzhi26.includes('2026-12-22')) pass('冬至 2026 = 2026-12-22 ✓(与公开资料一致)');
  else fail(`冬至 2026 计算异常:${dongzhi26.join(',') || '(空)'}`);

  // dist 内容:节气日历应含"前一天预告"与"连续打卡"两类事件
  const jq = parsed.get('jieqi-notes');
  if (jq) {
    const winStart = manifest.window.start;
    const advance = jq.events.filter((e) => (e.summary ?? '').includes('明天处暑')).length;
    const streak = jq.events.filter((e) => (e.summary ?? '').includes('处暑晨跑')).length;
    if (advance >= 1) pass(`「明天处暑·前一天预告」事件已生成 ${advance} 条`);
    else fail('缺少「明天处暑」前一天预告事件');

    if (streak >= 2) {
      pass(`「处暑晨跑·连续打卡」已展开 ${streak} 天`);
      const timedOk = /DTSTART;TZID=Asia\/Shanghai:\d{8}T064000/.test(jq.raw);
      if (timedOk) pass('连续打卡为每日 06:40 定时事件(TZID 正确)');
      else fail('连续打卡未找到 06:40 的定时 DTSTART');
    } else fail(`处暑晨跑展开天数不足:${streak}`);

    // 前一天预告应为当晚 20:30 定时事件
    const prevDayTimed = /DTSTART;TZID=Asia\/Shanghai:\d{8}T203000/.test(jq.raw);
    if (prevDayTimed) pass('「明天处暑」预告为前一天 20:30 定时事件');
    else fail('「明天处暑」预告未找到 20:30 定时 DTSTART');
  } else {
    console.log('   (未找到 jieqi-notes 日历,跳过 dist 抽查)');
  }
}

console.log(`\n${failures === 0 ? '🎉 全部验证通过' : `💥 ${failures} 项验证失败`}`);
process.exit(failures === 0 ? 0 : 1);
