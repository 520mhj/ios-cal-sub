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

function indexHtml(
  cfg: AppConfig,
  rows: BuildSummaryRow[],
  generatedAt: string,
  prot: SubscribeProtection,
): string {
  const base = cfg.site_base_url?.replace(/\/+$/, '') ?? '';
  const host = base.replace(/^https?:\/\//, '');

  // 受保护模式:卡片不直接给出链接,页面底部输入密钥后本地计算令牌再生成
  const subscribeBtn = (r: { id: string; file: string }) => {
    if (prot.on) {
      return `<span id="sl-${escapeHtml(r.id)}"><span class="btn disabled">🔒 输入密钥后显示</span></span>`;
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
    <p>${subscribeBtn(r)}</p>
    <code id="cu-${escapeHtml(r.id)}">${escapeHtml(prot.on ? '🔒 已保护' : base ? `${base}/${r.file}` : r.file)}</code>
  </div>`,
    )
    .join('\n');

  const unlockBlock = prot.on
    ? `<div class="card" data-subscribe-protected>
    <h2>🔒 本站已开启订阅保护</h2>
    <p class="meta">输入订阅密钥后,下方为每个日历生成专属订阅链接(密钥只在本机使用,不会发送)。</p>
    <p><input id="subkey" type="password" placeholder="订阅密钥" style="padding:8px;border-radius:9px;border:1px solid #8886">
       <button class="btn" style="border:0;cursor:pointer" onclick="unlock()">显示订阅链接</button></p>
  </div>
  <script data-subscribe-protected>
  async function subTok(key,id){
    const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+'|'+id));
    return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
  }
  async function unlock(){
    const k=(document.getElementById('subkey').value||'').trim();
    if(!k){alert('请输入订阅密钥');return}
    try{sessionStorage.setItem('subKey',k)}catch(e){}
    const ids=${JSON.stringify(rows.map((r) => r.id))};
    for(const id of ids){
      const t=await subTok(k,id);
      const rel='s/'+t+'/'+id+'.ics';
      const url='${host}'?'webcal://${host}/'+rel:rel;
      const el=document.getElementById('sl-'+id);
      if(el)el.innerHTML='<a class="btn" href="'+url+'">📲 订阅(webcal)</a>';
      const cu=document.getElementById('cu-'+id);
      if(cu)cu.textContent='${host}'?'https://${host}/'+rel:rel;
    }
  }
  (function(){try{if(sessionStorage.getItem('subKey')){document.getElementById('subkey').value=sessionStorage.getItem('subKey');unlock()}}catch(e){}})();
  </script>`
    : '';

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
${unlockBlock}
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

/** ---------- 订阅地址保护(capability URL) ---------- */

export interface SubscribeProtection {
  /** true 时 *.ics 写入不可猜测的 /s/<token>/ 路径,根目录不留副本 */
  on: boolean;
  key: string;
}

/** 订阅令牌:按日历独立派生,泄露单个日历链接不影响其他日历 */
export function subscribeToken(key: string, calId: string): string {
  return createHash('sha256').update(`${key}|${calId}`).digest('hex').slice(0, 32);
}

/**
 * 开关 = 是否配置了 Variable `CAL_SUBSCRIBE_KEY`:
 *   不配置 → 关闭,订阅地址即全部凭据;
 *   配置(≥8 位)→ 开启,.ics 移入 /s/<令牌>/ 路径,首页需输入密钥才显示链接。
 */
export function readSubscribeProtection(): SubscribeProtection {
  const key = (process.env.CAL_SUBSCRIBE_KEY ?? '').trim();
  if (!key) return { on: false, key: '' };
  if (key.length < 8) {
    console.warn('⚠️ CAL_SUBSCRIBE_KEY 少于 8 位,强度不足,已忽略(不开启保护)');
    return { on: false, key: '' };
  }
  return { on: true, key };
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
  const prot = readSubscribeProtection();

  // 开启订阅保护时,清理根目录可能残留的明文 .ics(上次未开保护时生成的)
  if (prot.on) {
    for (const f of await fs.promises.readdir(outDir)) {
      if (f.endsWith('.ics')) await fs.promises.unlink(path.join(outDir, f));
    }
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
    let file = `${cal.id}.ics`;
    const icsPath = prot.on
      ? path.join(outDir, 's', subscribeToken(prot.key, cal.id), `${cal.id}.ics`)
      : path.join(outDir, file);
    if (prot.on) file = `s/${subscribeToken(prot.key, cal.id)}/${cal.id}.ics`;
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
    indexHtml(eff, summaryRows, generatedAt, prot),
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
