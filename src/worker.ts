/// <reference types="@cloudflare/workers-types" />

/**
 * ios-cal-sub · Cloudflare Worker 入口
 *
 * 架构:
 *   - 公开日历配置内置在代码中(cn-holidays),fork 者即拿即用
 *   - 私人日历配置存在 Cloudflare KV(CAL_KV),不进公开仓库
 *   - 所有 .ics 动态生成,无需构建步骤
 *   - 编辑器通过 /api/config 读写 KV,UUID 密钥鉴权
 *
 * 路由:
 *   GET  /                  → 订阅页(动态生成)
 *   GET  /<id>.ics          → 公开日历 .ics
 *   GET  /s/<token>/<id>.ics → 私密日历 .ics
 *   GET  /editor/           → 在线编辑器(静态资源)
 *   GET  /api/config        → 读取全部配置(需鉴权)
 *   POST /api/config        → 保存私人日历配置到 KV(需鉴权)
 *   GET  /qrcode.min.js     → 二维码库(静态资源)
 */

import { buildIcs } from './ics.js';
import { buildWindow, expandSource } from './sources.js';
import {
  configSchema,
  type AppConfig,
  type CalendarDef,
  type Occurrence,
} from './types.js';
import { HOLIDAY_DATA } from './holiday-data.js';
import { sha256Hex } from './crypto-utils.js';
import { privateSubscribeToken } from './private-token.js';
import { indexHtml, type BuildSummaryRow } from './render-html.js';
import { stripNullValues } from './yaml-dump.js';
import { STATIC_ASSETS } from './assets.generated.js';

// ============================================================
// 环境变量与 KV 绑定类型
// ============================================================
interface Env {
  /** KV 命名空间(可选):存储私人日历配置。未配置时仅公开日历可用。 */
  CAL_KV?: KVNamespace;
  /** UUID 密钥的 SHA-256 十六进制(64位小写),在 Dashboard Variables and Secrets 中设置 */
  EDITOR_KEY?: string;
  /** 站点公开地址,如 https://ios-cal-sub.workers.dev */
  SITE_BASE_URL?: string;
  SITE_NAME?: string;
}

// ============================================================
// 内置公开配置 —— fork 者拿到代码即有一个可用的中国节假日日历
// ============================================================
const PUBLIC_CALENDARS: CalendarDef[] = [
  {
    id: 'cn-holidays',
    name: '🇨🇳 中国节假日与调休',
    description: '法定节假日休息日 + 调休补班提醒 + 传统节日 + 二十四节气',
    access: 'public',
    sources: [
      { type: 'holidays-cn', include_rest_days: true, include_workdays: true },
      { type: 'lunar-festival', festival: '春节' },
      { type: 'lunar-festival', festival: '元宵节' },
      { type: 'lunar-festival', festival: '龙抬头' },
      { type: 'lunar-festival', festival: '上巳节' },
      { type: 'lunar-festival', festival: '端午节' },
      { type: 'lunar-festival', festival: '七夕节' },
      { type: 'lunar-festival', festival: '中元节' },
      { type: 'lunar-festival', festival: '中秋节' },
      { type: 'lunar-festival', festival: '重阳节' },
      { type: 'lunar-festival', festival: '寒衣节' },
      { type: 'lunar-festival', festival: '下元节' },
      { type: 'lunar-festival', festival: '腊八节' },
      { type: 'lunar-festival', festival: '小年(北方)' },
      { type: 'lunar-festival', festival: '小年(南方)' },
      { type: 'lunar-festival', festival: '除夕' },
      { type: 'solar-terms' },
    ],
  },
];

const DEFAULTS = {
  timezone: 'Asia/Shanghai',
  years_ahead: 2,
};

const KV_KEY = 'calendars:private';

// ============================================================
// 工具函数
// ============================================================

/** 从 KV 读取私人日历配置(KV 未配置时返回空数组) */
async function loadPrivateCalendars(env: Env): Promise<CalendarDef[]> {
  if (!env.CAL_KV) return [];
  try {
    const raw = await env.CAL_KV.get(KV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CalendarDef[];
  } catch {
    return [];
  }
}

/** 保存私人日历配置到 KV */
async function savePrivateCalendars(env: Env, calendars: CalendarDef[]): Promise<void> {
  if (!env.CAL_KV) throw new Error('KV namespace 未配置,请在 Cloudflare Dashboard → Bindings 中添加 CAL_KV');
  await env.CAL_KV.put(KV_KEY, JSON.stringify(calendars));
}

/** 合并内置公开配置 + KV 私人配置 */
async function getMergedConfig(env: Env): Promise<AppConfig> {
  const privateCals = await loadPrivateCalendars(env);
  const cfg: AppConfig = {
    site_base_url: env.SITE_BASE_URL ?? '',
    defaults: { ...DEFAULTS },
    calendars: [...PUBLIC_CALENDARS, ...privateCals],
  };
  return cfg;
}

/** 鉴权:请求头 X-Editor-Key 中的 UUID 是否匹配(直接比对,不存哈希) */
async function checkAuth(request: Request, env: Env): Promise<boolean> {
  const expected = env.EDITOR_KEY;
  if (!expected) return false;
  const key = request.headers.get('X-Editor-Key') ?? '';
  if (!key) return false;
  return key.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** 生成单个日历的 .ics 内容 */
async function generateIcs(
  cal: CalendarDef,
  cfg: AppConfig,
  editorKey?: string,
): Promise<{ ics: string; file: string }> {
  const win = buildWindow(cfg.defaults.years_ahead);
  const occs: Occurrence[] = [];
  for (const src of cal.sources) {
    const expanded = await expandSource(src, {
      win,
      calId: cal.id,
      holidayData: HOLIDAY_DATA,
    });
    occs.push(...expanded);
  }
  occs.sort((a, b) =>
    a.start === b.start ? a.uid.localeCompare(b.uid) : a.start < b.start ? -1 : 1,
  );

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const descParts = [cal.description, '数据与工具:ios-cal-sub(节假日数据来自 holiday-cn)'].filter(
    Boolean,
  );
  const ics = buildIcs(
    {
      name: cal.name,
      description: descParts.join(' | '),
      timezone: cfg.defaults.timezone,
      stampUtc: stamp,
    },
    occs,
  );

  let file = `${cal.id}.ics`;
  if (cal.access === 'private') {
    if (!editorKey) throw new Error(`私密日历「${cal.name}」需要访问密钥`);
    const token = await privateSubscribeToken(editorKey, cal.id);
    file = `s/${token}/${cal.id}.ics`;
  }

  return { ics, file };
}

/** 生成首页所需的摘要行 */
async function buildSummaryRows(cfg: AppConfig, editorKey?: string): Promise<BuildSummaryRow[]> {
  const rows: BuildSummaryRow[] = [];
  for (const cal of cfg.calendars) {
    const win = buildWindow(cfg.defaults.years_ahead);
    const occs: Occurrence[] = [];
    for (const src of cal.sources) {
      const expanded = await expandSource(src, {
        win,
        calId: cal.id,
        holidayData: HOLIDAY_DATA,
      });
      occs.push(...expanded);
    }
    occs.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const count = occs.length;
    const first = count > 0 ? occs[0]!.start : '-';
    const last = count > 0 ? occs[occs.length - 1]!.start : '-';
    let file = `${cal.id}.ics`;
    if (cal.access === 'private' && editorKey) {
      const token = await privateSubscribeToken(editorKey, cal.id);
      file = `s/${token}/${cal.id}.ics`;
    }
    rows.push({ id: cal.id, name: cal.name, file, count, first, last, access: cal.access });
  }
  return rows;
}

// ============================================================
// JSON 响应辅助
// ============================================================
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ============================================================
// Worker 入口
// ============================================================
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---- API: 读取配置 ----
    if (path === '/api/config' && method === 'GET') {
      if (!(await checkAuth(request, env))) {
        return jsonResponse({ ok: false, error: '未授权:请在请求头 X-Editor-Key 中提供 UUID' }, 401);
      }
      const cfg = await getMergedConfig(env);
      const privateCals = await loadPrivateCalendars(env);
      return jsonResponse({
        ok: true,
        config: cfg,
        privateCalendars: privateCals,
        publicCalendars: PUBLIC_CALENDARS,
      });
    }

    // ---- API: 保存私人日历配置 ----
    if (path === '/api/config' && method === 'POST') {
      if (!(await checkAuth(request, env))) {
        return jsonResponse({ ok: false, error: '未授权' }, 401);
      }
      if (!env.CAL_KV) {
        return jsonResponse({
          ok: false,
          error: 'KV namespace 未配置。请在 Cloudflare Dashboard → Worker → Settings → Bindings → Add binding → KV,Variable name 填 CAL_KV,可新建 namespace。',
        }, 503);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
      }
      // body 应该是私人日历数组
      if (!Array.isArray(body)) {
        return jsonResponse({ ok: false, error: '请求体必须是日历配置数组' }, 400);
      }
      // 用完整配置(公开+私人)过 zod 校验
      const fullCfg: AppConfig = {
        site_base_url: env.SITE_BASE_URL ?? '',
        defaults: { ...DEFAULTS },
        calendars: [...PUBLIC_CALENDARS, ...(body as CalendarDef[])],
      };
      const parsed = configSchema.safeParse(stripNullValues(fullCfg));
      if (!parsed.success) {
        return jsonResponse({
          ok: false,
          error: '配置校验失败',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }, 400);
      }
      // 只保存私人部分(公开部分内置在代码中)
      const privateCals = parsed.data.calendars.filter(
        (c) => !PUBLIC_CALENDARS.some((p) => p.id === c.id),
      );
      await savePrivateCalendars(env, privateCals);
      return jsonResponse({ ok: true, saved: privateCals.length });
    }

    // ---- API: 编辑器门禁状态 ----
    if (path === '/editor/auth.json' && method === 'GET') {
      // 返回 UUID 的 SHA-256 供前端比对(不直接返回 UUID,避免泄露)
      const keySha256 = env.EDITOR_KEY ? await sha256Hex(env.EDITOR_KEY) : '';
      return jsonResponse({
        enabled: !!env.EDITOR_KEY,
        sha256: keySha256,
        hint: '',
      });
    }

    // ---- 私密日历 .ics ----
    const privateMatch = path.match(/^\/s\/([a-f0-9]{32})\/([a-z0-9][a-z0-9-]{0,62})\.ics$/);
    if (privateMatch) {
      const [, token, calId] = privateMatch;
      const cfg = await getMergedConfig(env);
      const cal = cfg.calendars.find((c) => c.id === calId);
      if (!cal || cal.access !== 'private') {
        return new Response('Not Found', { status: 404 });
      }
      // 验证令牌
      if (!env.EDITOR_KEY) return new Response('Service Unavailable', { status: 503 });
      const expectedToken = await privateSubscribeToken(env.EDITOR_KEY, calId);
      if (token !== expectedToken) {
        return new Response('Forbidden', { status: 403 });
      }
      const { ics } = await generateIcs(cal, cfg, env.EDITOR_KEY);
      return new Response(ics, {
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
      });
    }

    // ---- 公开日历 .ics ----
    const publicMatch = path.match(/^\/([a-z0-9][a-z0-9-]{0,62})\.ics$/);
    if (publicMatch) {
      const [, calId] = publicMatch;
      const cfg = await getMergedConfig(env);
      const cal = cfg.calendars.find((c) => c.id === calId);
      if (!cal || cal.access !== 'public') {
        return new Response('Not Found', { status: 404 });
      }
      const { ics } = await generateIcs(cal, cfg);
      return new Response(ics, {
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
      });
    }

    // ---- 首页 ----
    if (path === '/' || path === '/index.html') {
      const cfg = await getMergedConfig(env);
      const rows = await buildSummaryRows(cfg, env.EDITOR_KEY);
      // 首页只展示公开日历
      const publicRows = rows.filter((r) => r.access === 'public');
      const html = indexHtml(
        env.SITE_BASE_URL ?? '',
        publicRows,
        new Date().toISOString().replace('T', ' ').slice(0, 19),
      );
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // ---- 健康检查 ----
    if (path === '/health') {
      return jsonResponse({ ok: true, calendars: PUBLIC_CALENDARS.length, kv: !!env.CAL_KV });
    }

    // ---- 静态资源(内联,不依赖 wrangler assets 功能) ----
    const staticAsset = STATIC_ASSETS.find((a) => a.route === path);
    if (staticAsset) {
      return new Response(staticAsset.content, {
        headers: { 'content-type': staticAsset.contentType },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
