/** 生成器:既作 CLI 入口,也导出 buildCalendars() 供 Web 编辑器复用 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { configSchema, type AppConfig, type Occurrence } from './types.js';
import { buildIcs } from './ics.js';
import { dumpYaml } from './yaml-dump.js';
import {
  buildWindow,
  expandSource,
  loadHolidayData,
} from './sources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function stampUtcNow(): string {
  // 支持 SOURCE_DATE_EPOCH 实现可复现构建;否则按小时取整,减少 git 无谓抖动
  const ms =
    process.env.SOURCE_DATE_EPOCH != null
      ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 // 秒 → 毫秒
      : Math.floor(Date.now() / 3_600_000) * 3_600_000; // 毫秒,取整到小时
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 解析并校验配置文件(zod),失败时打印可读错误并退出 */
export function loadConfig(cfgPath: string): AppConfig {
  const rawText = fs.readFileSync(cfgPath, 'utf8');
  let raw: unknown;
  try {
    raw = parseYaml(rawText);
  } catch (e) {
    console.error(`❌ YAML 解析失败(${cfgPath}): ${(e as Error).message}`);
    process.exit(2);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('❌ 配置校验失败:');
    for (const issue of parsed.error.issues) {
      console.error(`   - 路径 ${issue.path.join('.') || '(根)'}: ${issue.message}`);
    }
    process.exit(2);
  }
  return parsed.data;
}

function indexHtml(cfg: AppConfig, rows: BuildSummaryRow[], generatedAt: string): string {
  const base = cfg.site_base_url?.replace(/\/+$/, '') ?? '';
  const subscribeBtn = (file: string) =>
    base
      ? `<a class="btn" href="webcal://${base.replace(/^https?:\/\//, '')}/${file}">📲 订阅(webcal)</a>`
      : `<span class="btn disabled" title="在 calendars.yaml 填写 site_base_url 并重新生成后可用">📲 部署后可订阅</span>`;
  const cards = rows
    .map(
      (r) => `  <div class="card">
    <h2>${escapeHtml(r.name)}</h2>
    <p class="meta">${r.count} 个事件 · 覆盖 ${r.first} ~ ${r.last}</p>
    <p>${subscribeBtn(r.file)}
       <a class="btn ghost" href="./${r.file}" download>⬇️ 下载 .ics</a></p>
    <code>${escapeHtml(base ? `${base}/${r.file}` : r.file)}</code>
  </div>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>iOS 日历订阅</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28px; }
  .card { border: 1px solid #8884; border-radius: 14px; padding: 18px 22px; margin: 16px 0; }
  .card h2 { margin: 0 0 6px; font-size: 20px; }
  .meta { color: #888; margin: 0 0 12px; font-size: 13px; }
  .btn { display: inline-block; padding: 8px 14px; border-radius: 9px; background: #0a84ff; color: #fff; text-decoration: none; font-size: 14px; margin-right: 8px; }
  .btn.ghost { background: transparent; color: inherit; border: 1px solid #8886; }
  .btn.disabled { background: #8884; color: inherit; cursor: default; }
  code { display: block; margin-top: 10px; font-size: 12px; opacity: .7; word-break: break-all; }
  footer { color: #888; font-size: 12px; margin-top: 32px; line-height: 1.7; }
</style>
</head>
<body>
<h1>📅 iOS 日历订阅</h1>
<p>在 iPhone 上打开本页,点「订阅(webcal)」即可;或在 <b>设置 → 应用 → 日历 → 日历账户 → 添加订阅日历</b> 中粘贴下方链接。</p>
${cards}
<footer>由 ios-cal-sub 生成于 ${escapeHtml(generatedAt)}。数据来源:<a href="https://github.com/NateScarlet/holiday-cn">NateScarlet/holiday-cn</a>(国务院公告自动化解析)。</footer>
</body>
</html>`;
}

export interface BuildSummaryRow {
  id: string;
  name: string;
  file: string;
  count: number;
  first: string;
  last: string;
}

export interface BuildOptions {
  config: AppConfig;
  /** 输出目录,默认 <cwd>/dist */
  distDir?: string;
  /** holiday-cn 数据目录,默认 <cwd>/data/holiday-cn */
  dataDir?: string;
  log?: boolean;
}

export interface BuildResult {
  window: { start: string; end: string };
  rows: BuildSummaryRow[];
}

/** 核心构建:展开全部事件源并写出 dist/*.ics + index.html + manifest.json */
export async function buildCalendars(opts: BuildOptions): Promise<BuildResult> {
  const cfg = opts.config;
  const win = buildWindow(cfg.defaults.years_ahead);
  const outDir = path.resolve(opts.distDir ?? 'dist');
  await fs.promises.mkdir(outDir, { recursive: true });

  const needHoliday = cfg.calendars.some((c) =>
    c.sources.some((s) => s.type === 'holidays-cn'),
  );
  const holidayData = needHoliday
    ? await loadHolidayData(path.resolve(opts.dataDir ?? 'data/holiday-cn'), win)
    : undefined;
  if (needHoliday && (!holidayData || holidayData.size === 0)) {
    throw new Error('需要 holidays-cn 数据但 data/holiday-cn/ 为空,请先运行 pnpm cal:fetch');
  }

  const stamp = stampUtcNow();
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const summaryRows: BuildSummaryRow[] = [];

  for (const cal of cfg.calendars) {
    const occs: Occurrence[] = [];
    for (const src of cal.sources) {
      occs.push(...expandSource(src, { win, calId: cal.id, holidayData }));
    }
    occs.sort((a, b) => (a.start === b.start ? a.uid.localeCompare(b.uid) : a.start < b.start ? -1 : 1));

    const descParts = [cal.description, '数据与工具:ios-cal-sub(节假日数据来自 holiday-cn)'].filter(Boolean);
    const ics = buildIcs(
      { name: cal.name, description: descParts.join(' | '), timezone: cfg.defaults.timezone, stampUtc: stamp },
      occs,
    );
    const file = `${cal.id}.ics`;
    await fs.promises.writeFile(path.join(outDir, file), ics, 'utf8');

    const countWithAlarms = occs.filter((o) => o.alarms.length > 0).length;
    const row: BuildSummaryRow = {
      id: cal.id,
      name: cal.name,
      file,
      count: occs.length,
      first: occs[0]?.start ?? '-',
      last: occs[occs.length - 1]?.start ?? '-',
    };
    summaryRows.push(row);
    if (opts.log !== false) {
      console.log(
        `✅ ${file.padEnd(22)} ${String(row.count).padStart(4)} 个事件(${countWithAlarms} 带提醒)  ${row.first} ~ ${row.last}`,
      );
    }
  }

  await fs.promises.writeFile(
    path.join(outDir, 'index.html'),
    indexHtml(cfg, summaryRows, generatedAt),
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ generated_at: generatedAt, window: win, calendars: summaryRows }, null, 2),
    'utf8',
  );

  // 在线编辑器产物:data.json(结构化配置)+ editor/(门禁信息 + 单页应用)
  const edDir = path.join(outDir, 'editor');
  await fs.promises.mkdir(edDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(outDir, 'data.json'),
    JSON.stringify({ generated_at: generatedAt, config: cfg }),
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(edDir, 'auth.json'),
    JSON.stringify({
      enabled: !!cfg.editor_auth?.key_sha256,
      sha256: cfg.editor_auth?.key_sha256 ?? '',
      hint: cfg.editor_auth?.hint ?? '',
    }),
    'utf8',
  );
  const tpl = await fs.promises.readFile(path.join(HERE, 'editor-page.html'), 'utf8');
  // 注入与 Node 端完全一致的 YAML 序列化函数(运行时编译后的源码)
  const page = tpl.replace(
    '/*__INLINE_YAML_DUMP__*/null',
    () => dumpYaml.toString(),
  );
  await fs.promises.writeFile(path.join(edDir, 'index.html'), page, 'utf8');

  if (opts.log !== false) {
    console.log(`\n🎉 完成:${cfg.calendars.length} 个日历 → ${path.basename(outDir)}(含 index.html、manifest.json、editor/)`);
  }
  return { window: win, rows: summaryRows };
}

/** CLI 入口(被 import 时不执行) */
async function main() {
  const cfgPath = path.resolve(process.argv[2] ?? 'calendars.yaml');
  const cfg = loadConfig(cfgPath);
  await buildCalendars({ config: cfg });
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error('❌ 生成失败:', e);
    process.exit(1);
  });
}
