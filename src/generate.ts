/** 生成器:既作 CLI 入口,也导出 buildCalendars() 供 Web 编辑器复用 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { configSchema, type AppConfig, type Occurrence } from './types.js';
import { buildIcs } from './ics.js';
import { dumpYaml, stripNullValues } from './yaml-dump.js';
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
  const parsed = configSchema.safeParse(stripNullValues(raw));
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
  const host = base.replace(/^https?:\/\//, '');

  // 公开日历:直接给链接;私密日历:首页只显示 🔒 徽标,专属链接在编辑页对应区域查看
  const subscribeArea = (r: BuildSummaryRow) => {
    if (r.access === 'private') {
      return `<span class="btn disabled" title="私密订阅 · 链接在编辑页该日历区域查看">🔒 私密订阅</span>`;
    }
    return base
      ? `<a class="btn" href="webcal://${host}/${r.file}">📲 订阅(webcal)</a>`
      : `<span class="btn disabled" title="配置 Variable CAL_SITE_BASE_URL 并重新生成后可用">📲 部署后可订阅</span>`;
  };
  const cards = rows
    .map(
      (r) => `  <div class="card">
    <h2>${escapeHtml(r.name)}</h2>
    <p class="meta">${r.count} 个事件 · 覆盖 ${r.first} ~ ${r.last}</p>
    <p>${subscribeArea(r)}</p>
    <code>${escapeHtml(
      r.access === 'private'
        ? '🔒 私密日历 · 专属链接请在编辑页对应日历处复制'
        : base
          ? `${base}/${r.file}`
          : r.file,
    )}</code>
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

/** CLI 入口前的基础设施:运行时配置解析(环境变量优先,yaml 兜底) */

/**
 * 解析生效配置:
 *   CAL_SITE_BASE_URL  > cfg.site_base_url
 *   CAL_EDITOR_KEY     > cfg.editor_auth.key_sha256(存 UUID 原样,构建时现算 SHA-256,
 *                        公开产物只出现哈希,UUID 本身不落盘)
 *   CAL_EDITOR_HINT    > cfg.editor_auth.hint
 * 线上(GitHub Actions)通过仓库 Variables/Secrets 注入;
 * 本地不设环境变量时自动回落到 calendars.yaml 的同名字段。
 * 注意:data.json 写入的是「未解析」的原始配置,避免把密钥发布到公开产物。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function resolveConfig(cfg: AppConfig): AppConfig {
  const envBase = (process.env.CAL_SITE_BASE_URL ?? '').trim();
  const envKey = (process.env.CAL_EDITOR_KEY ?? '').trim().toLowerCase();
  const envHint = (process.env.CAL_EDITOR_HINT ?? '').trim();

  let out = cfg;
  if (envBase) out = { ...out, site_base_url: envBase };

  if (envKey) {
    if (!UUID_RE.test(envKey)) {
      console.warn('⚠️ 环境变量 CAL_EDITOR_KEY 不是合法 UUID(8-4-4-4-12 十六进制),已忽略该覆盖');
    } else {
      const sha256 = createHash('sha256').update(envKey).digest('hex');
      const hint = envHint || cfg.editor_auth?.hint;
      out = { ...out, editor_auth: { key_sha256: sha256, ...(hint ? { hint } : {}) } };
    }
  }
  return out;
}

/** ---------- 私密订阅(capability URL,按日历独立) ---------- */

/**
 * 私密日历的订阅令牌:
 *   token = sha256( 访问密钥的SHA-256十六进制 + '|' + calId ) 前 32 位
 * 双重派生的原因:构建端手里是密钥的哈希(eff.editor_auth.key_sha256),
 * 编辑页浏览器端从 UUID 出发同样先算哈希即可得到同一材料,两端无需传递明文。
 * 每个日历独立令牌:泄露一个链接不影响其他日历;轮换密钥则全部私密链接失效。
 */
export function privateSubscribeToken(keySha256Hex: string, calId: string): string {
  return createHash('sha256').update(`${keySha256Hex}|${calId}`).digest('hex').slice(0, 32);
}

export interface BuildSummaryRow {
  id: string;
  name: string;
  file: string;
  count: number;
  first: string;
  last: string;
  /** public = 首页公开展示链接;private = 首页隐藏,.ics 位于 /s/<令牌>/ 路径 */
  access: 'public' | 'private';
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

/** 核心构建:展开全部事件源并写出 dist/*.ics + index.html + manifest.json + editor/ */
export async function buildCalendars(opts: BuildOptions): Promise<BuildResult> {
  const cfg = opts.config;
  const eff = resolveConfig(cfg); // 环境变量优先的生效配置(用于 index.html / auth.json)
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
  // /s/ 目录与根目录 .ics 完全由本次构建重建:
  // 先清理,避免「日历从公开切到私密」后旧的明文副本残留在根目录造成泄露
  await fs.promises.rm(path.join(outDir, 's'), { recursive: true, force: true });
  for (const f of await fs.promises.readdir(outDir)) {
    if (f.endsWith('.ics')) await fs.promises.unlink(path.join(outDir, f));
  }

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

    // 私密日历:.ics 写入不可猜测的 /s/<令牌>/ 路径;公开日历:根目录
    let file = `${cal.id}.ics`;
    if (cal.access === 'private') {
      const keySha = eff.editor_auth?.key_sha256;
      if (!keySha) {
        throw new Error(
          `日历「${cal.name}」(${cal.id})为私密订阅,但未配置访问密钥。` +
            `请先设置 Secret CAL_EDITOR_KEY(UUID),或在编辑页把该日历改回公开。`,
        );
      }
      file = `s/${privateSubscribeToken(keySha, cal.id)}/${cal.id}.ics`;
    }
    const icsPath = path.join(outDir, file);
    await fs.promises.mkdir(path.dirname(icsPath), { recursive: true });
    await fs.promises.writeFile(icsPath, ics, 'utf8');

    const countWithAlarms = occs.filter((o) => o.alarms.length > 0).length;
    const row: BuildSummaryRow = {
      id: cal.id,
      name: cal.name,
      file,
      count: occs.length,
      first: occs[0]?.start ?? '-',
      last: occs[occs.length - 1]?.start ?? '-',
      access: cal.access,
    };
    summaryRows.push(row);
    if (opts.log !== false) {
      console.log(
        `✅ ${file.padEnd(22)} ${String(row.count).padStart(4)} 个事件(${countWithAlarms} 带提醒)  ${row.first} ~ ${row.last}${cal.access === 'private' ? '  🔒私密' : ''}`,
      );
    }
  }

  await fs.promises.writeFile(
    path.join(outDir, 'index.html'),
    indexHtml(eff, summaryRows, generatedAt),
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ generated_at: generatedAt, window: win, calendars: summaryRows }, null, 2),
    'utf8',
  );

  // 在线编辑器产物:data.json 写「未解析」的原始配置(不把密钥哈希发布到公开产物);
  // editor/auth.json 用解析后的生效值(环境变量优先);
  // yaml-dump.js 为独立脚本(带 esbuild keepNames 兼容垫片),index.html 通过 <script src> 引入。
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
      enabled: !!eff.editor_auth?.key_sha256,
      sha256: eff.editor_auth?.key_sha256 ?? '',
      hint: eff.editor_auth?.hint ?? '',
    }),
    'utf8',
  );
  await fs.promises.writeFile(
    path.join(edDir, 'yaml-dump.js'),
    '// 自动生成于构建期:与 Node 端完全一致的 YAML 序列化器(勿手改)\n' +
      'const __name = (fn) => fn; // 兼容 tsx/esbuild keepNames 注入的名称保留辅助\n' +
      dumpYaml.toString() +
      '\n',
    'utf8',
  );
  const tpl = await fs.promises.readFile(path.join(HERE, 'editor-page.html'), 'utf8');
  await fs.promises.writeFile(path.join(edDir, 'index.html'), tpl, 'utf8');

  if (opts.log !== false) {
    console.log(`\n🎉 完成:${cfg.calendars.length} 个日历 → ${path.basename(outDir)}(含 index.html、manifest.json、editor/)`);
    console.log(
      `🔗 生效配置 → 站点地址: ${eff.site_base_url || '(空,订阅按钮将置灰)'} | 编辑器门禁: ${eff.editor_auth?.key_sha256 ? '开启' : '关闭'}`,
    );
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
