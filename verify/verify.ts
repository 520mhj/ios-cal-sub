/**
 * 验证 dist/ 下生成的日历 —— 全部断言均为「内容无关」:
 * 用户任意修改 calendars.yaml 的标题/时间/天数都不应导致验证失败。
 *  1. 物理格式:CRLF、行 ≤75 八字节、UID 唯一、事件数与 manifest 一致
 *  2. 节假日:缓存数据里每个条目(含调休补班)都有对应事件(动态读取,无硬编码)
 *  3. 纯函数已知事实:农历换算 / 节气天文计算与公开资料一致
 *  4. 配置 ↔ 产物全量比对:用生成器同款展开逻辑推导期望事件集,
 *     以确定性 UID 逐条核对 dist 内容(缺失/多余都会报出),
 *     并精确校验定时事件的 TZID 时间与 VALARM 总数
 *  5. index.html 链接完整性
 *  6. 在线编辑器产物:data.json 校验、yaml-dump.js 可独立执行且输出一致、auth.json 门禁状态
 */
import fs from 'node:fs';
import path from 'node:path';
import { convertIcsCalendar } from 'ts-ics';
import { parse as parseYaml } from 'yaml';
import { lunarToSolar, solarTermDatesInRange, expandSource, loadHolidayData } from '../src/sources.js';
import { configSchema } from '../src/types.js';
import type { Occurrence } from '../src/types.js';
import { dumpYaml, stripNullValues } from '../src/yaml-dump.js';
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

console.log('\n━━ 2. 节假日条目全覆盖(含调休补班,动态读取缓存)━━');
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
        const exact = cal.raw.includes(`DTSTART;VALUE=DATE:${compact}`);
        if (!exact) {
          missing++;
          fail(`${day.isOffDay ? '休息日' : '补班日'} ${day.date}(${day.name})未出现在 cn-holidays.ics`);
        }
        checked++;
      }
    }
    if (missing === 0) pass(`窗口内全部 ${checked} 个节假日条目均有对应事件`);
  }
}

console.log('\n━━ 3. 天文换算已知事实抽查 ━━');
{
  const lunarKnown: [number, number, number, string][] = [
    [2000, 8, 15, '2000-09-12'], // 2000 年中秋节
    [2026, 8, 15, '2026-09-25'], // 2026 年中秋节
    [2025, 1, 1, '2025-01-29'], // 2025 春节(正月初一)
  ];
  for (const [y, m, d, expect] of lunarKnown) {
    const got = lunarToSolar(y, m, d);
    if (got !== expect) fail(`农历 ${y}-${m}-${d} 应为公历 ${expect},得到 ${got}`);
    else pass(`农历 ${y} 年 ${m} 月 ${d} 日 → 公历 ${got} ✓`);
  }

  const termKnown: [string, string, string][] = [
    ['处暑', '2024', '2024-08-22'],
    ['处暑', '2025', '2025-08-23'],
    ['冬至', '2026', '2026-12-22'],
  ];
  for (const [term, year, expect] of termKnown) {
    const table = solarTermDatesInRange({ start: `${year}-01-01`, end: `${year}-12-31` });
    const hits = (table.get(term) ?? []).filter((d) => d.startsWith(year));
    if (hits.includes(expect)) pass(`${term} ${year} = ${expect} ✓(与公开资料一致)`);
    else fail(`${term} ${year} 计算异常:${hits.join(',') || '(空)'}`);
  }
}

console.log('\n━━ 4. 配置 ↔ 产物全量一致性 ━━');
{
  const dataObj = JSON.parse(fs.readFileSync(path.join(distDir, 'data.json'), 'utf8')) as { config: unknown };
  const cfgParsed = configSchema.safeParse(dataObj.config);
  if (!cfgParsed.success) {
    fail(`data.json 配置不符合 schema:${cfgParsed.error.issues[0]!.path.join('.')}`);
  } else {
    const cfg = cfgParsed.data;
    const win = manifest.window;
    const holidayData = await loadHolidayData(path.resolve('data/holiday-cn'), win);

    for (const cal of cfg.calendars) {
      const entry = parsed.get(cal.id);
      console.log(`\n▶ ${cal.id}.ics`);
      if (!entry) {
        fail('dist 中找不到该日历(构建遗漏?)');
        continue;
      }
      let expected: Occurrence[] = [];
      try {
        expected = cal.sources.flatMap((s) =>
          expandSource(s, { win, calId: cal.id, holidayData }),
        );
      } catch (e) {
        fail(`展开配置时出错:${(e as Error).message}`);
        continue;
      }

      // 定义级 UID 双向比对(RRULE 事件在两侧都只是一条定义)
      const actualUids = new Set(entry.events.map((e) => e.uid));
      const expectedUids = new Set(expected.map((o) => o.uid));
      const missing = [...expectedUids].filter((u) => !actualUids.has(u));
      const extra = [...actualUids].filter((u) => !expectedUids.has(u));
      if (missing.length === 0 && extra.length === 0)
        pass(`事件定义与配置完全一致(${expected.length} 条,UID 逐条匹配)`);
      else {
        if (missing.length) fail(`缺少 ${missing.length} 条期望事件,如:${missing.slice(0, 3).join(', ')}`);
        if (extra.length) fail(`多出 ${extra.length} 条意外事件,如:${extra.slice(0, 3).join(', ')}`);
      }

      // RRULE 规则体逐条核对
      const rruleDefs = expected.filter((o) => o.rrule);
      for (const o of rruleDefs) {
        if (!entry.raw.includes(`RRULE:${o.rrule}`))
          fail(`RRULE 缺失或不符:期望 [${o.rrule}](uid=${o.uid})`);
      }
      if (rruleDefs.length > 0)
        pass(`重复规则正确(${rruleDefs.length} 条 RRULE)`);

      // 首个发生日:抽前 2 条核对日期/TZID/时刻
      const timed = expected.filter((o) => o.time);
      for (const o of timed.slice(0, 2)) {
        const line = `DTSTART;TZID=${cfg.defaults.timezone}:${o.start.replace(/-/g, '')}T${o.time!.replace(':', '')}00`;
        if (!entry.raw.includes(line))
          fail(`定时事件首发生日不符:期望存在 ${line}`);
      }
      if (timed.length > 0)
        pass(`定时事件时刻/TZID 正确(抽查 ${Math.min(2, timed.length)}/${timed.length} 条)`);

      // 提醒总数精确相等
      const wantAlarms = expected.reduce((n, o) => n + o.alarms.length, 0);
      const gotAlarms = (entry.raw.match(/BEGIN:VALARM/g) ?? []).length;
      if (gotAlarms === wantAlarms) pass(`提醒数量精确一致(${wantAlarms} 个 VALARM)`);
      else fail(`提醒数量不符:文件 ${gotAlarms},配置推导应为 ${wantAlarms}`);
    }
  }
}

console.log('\n━━ 5. index.html / manifest 一致性 ━━');
{
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const privRows = manifest.calendars.filter((c) => c.file.includes('/'));
  const pubRows = manifest.calendars.filter((c) => !c.file.includes('/'));

  // 公开日历:首页应有链接
  const missingLink = pubRows.filter((c) => !html.includes(c.file));
  if (pubRows.length === 0) console.log('   (无公开日历)');
  else if (missingLink.length === 0) pass(`公开日历链接完整(${pubRows.length} 个)`);
  else fail(`index.html 缺少公开链接:${missingLink.map((c) => c.id).join(', ')}`);

  // 私密日历:根目录无明文文件、首页不出现其路径
  for (const c of privRows) {
    if (fs.existsSync(path.join(distDir, `${c.id}.ics`)))
      fail(`私密日历 ${c.id} 在根目录存在明文副本(泄露!)`);
    if (html.includes(`${c.id}.ics`))
      fail(`index.html 泄露了私密日历 ${c.id} 的路径`);
  }
  if (privRows.length > 0 && failures === 0)
    pass(`私密日历 ${privRows.length} 个:仅存于 /s/<令牌>/ 路径,首页未展示`);
}

console.log('\n━━ 6. 在线编辑器产物(Pages /editor/)━━');
{
  const dataPath = path.join(distDir, 'data.json');
  const edIndex = path.join(distDir, 'editor', 'index.html');
  const edAuth = path.join(distDir, 'editor', 'auth.json');

  let dataObj: { config: unknown } | null = null;
  try {
    dataObj = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    // 与构建入口一致:data.json 的配置同样先清洗历史 null 再过 schema
    const re = configSchema.safeParse(stripNullValues(dataObj!.config));
    if (re.success) pass('data.json 结构化配置可被 zod schema 完整校验');
    else fail(`data.json 配置不符合 schema:${re.error.issues[0]!.path.join('.')} ${re.error.issues[0]!.message}`);

    // Node 端 dumpYaml 往返无损
    const yamlText = dumpYaml(re.success ? re.data : dataObj!.config);
    const reparsed = parseYaml(yamlText);
    if (JSON.stringify(reparsed) === JSON.stringify(dataObj!.config)) pass('dumpYaml 往返无损(YAML → 对象逐字段一致)');
    else fail('dumpYaml 往返有差异:序列化的 YAML 解析后与原对象不一致');
  } catch (e) {
    fail(`data.json 检查失败:${(e as Error).message}`);
  }

  if (fs.existsSync(edIndex) && fs.readFileSync(edIndex, 'utf8').includes('yaml-dump.js'))
    pass('editor/index.html 已生成并引用 yaml-dump.js');
  else fail('editor/index.html 缺失或未引用序列化脚本');

  // 关键:浏览器版序列化器必须「可独立执行」且与 Node 端输出逐字符一致
  // (回归防护:此前 tsx keepNames 注入的 __name 曾导致浏览器端 ReferenceError)
  try {
    const src = fs.readFileSync(path.join(distDir, 'editor', 'yaml-dump.js'), 'utf8');
    const browserDumpYaml = new Function(src + '\nreturn dumpYaml;')() as typeof dumpYaml;
    const sample = { s: '含,逗号"引号"\n换行', arr: [1, true, '处暑'], o: { k: '' } };
    if (browserDumpYaml(sample) === dumpYaml(sample))
      pass('内嵌序列化器可独立执行,特殊字符输出与 Node 端一致');
    else fail('内嵌 dumpYaml 输出与 Node 端不一致');

    if (dataObj) {
      const backFromBrowser = parseYaml(browserDumpYaml(dataObj.config));
      if (JSON.stringify(backFromBrowser) === JSON.stringify(dataObj.config))
        pass('浏览器版 dumpYaml 对完整配置往返无损');
      else fail('浏览器版 dumpYaml 完整配置往返有差异');
    }
  } catch (e) {
    fail(`执行内嵌序列化器失败:${(e as Error).message}`);
  }

  try {
    const authInfo = JSON.parse(fs.readFileSync(edAuth, 'utf8')) as { enabled: boolean; sha256: string; hint?: string };
    // 与「解析后」的配置比对(环境变量优先,yaml 兜底)——和构建时同一套逻辑
    const rawCfg = configSchema.parse(stripNullValues(parseYaml(fs.readFileSync(path.resolve('calendars.yaml'), 'utf8'))));
    const eff = resolveConfig(rawCfg);
    const wantEnabled = !!eff.editor_auth?.key_sha256;
    if (authInfo.enabled === wantEnabled && authInfo.sha256 === (eff.editor_auth?.key_sha256 ?? ''))
      pass(`auth.json 与生效配置一致(门禁${wantEnabled ? '已启用' : '未启用'})`);
    else fail('auth.json 与解析后的 editor_auth 不一致');
  } catch (e) {
    fail(`auth.json 检查失败:${(e as Error).message}`);
  }
}

console.log(`\n${failures === 0 ? '🎉 全部验证通过' : `💥 ${failures} 项验证失败`}`);
process.exit(failures === 0 ? 0 : 1);
