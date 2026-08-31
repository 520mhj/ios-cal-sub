/**
 * 本地 Web 编辑器服务:
 *   GET  /            → 编辑器页面(src/web/editor.html)
 *   GET  /api/state   → 当前配置(JSON,zod 校验后)
 *   POST /api/state   → 保存新配置:校验 → 重写 calendars.yaml → 立即重建 dist/
 *   GET  /dist/<file> → 提供生成的日历文件(手机同网段可直接订阅)
 *
 * 环境变量:
 *   PORT=5188 HOST=127.0.0.1
 *   CAL_CONFIG_PATH / CAL_DIST_DIR(测试与多实例用)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { configSchema } from '../types.js';
import { buildCalendars } from '../generate.js';
import { stripNullValues } from '../yaml-dump.js';

const PORT = Number(process.env.PORT ?? 5188);
const HOST = process.env.HOST ?? '127.0.0.1';
const CONFIG_PATH = path.resolve(process.env.CAL_CONFIG_PATH ?? 'calendars.yaml');
const DIST_DIR = path.resolve(process.env.CAL_DIST_DIR ?? 'dist');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function readConfig(): unknown {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  return parseYaml(text);
}

function json(res: http.ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) throw new Error('请求体为空');
  return JSON.parse(raw);
}

async function handleSave(body: unknown): Promise<
  | { ok: true; summary: Awaited<ReturnType<typeof buildCalendars>>['rows'] }
  | { ok: false; issues: { path: string; message: string }[] }
> {
  const parsed = configSchema.safeParse(stripNullValues(body));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  // 备份当前配置(保留一次历史,防止误操作)
  try {
    const prev = fs.readFileSync(CONFIG_PATH, 'utf8');
    fs.writeFileSync(`${CONFIG_PATH}.bak`, prev, 'utf8');
  } catch { /* 首次无文件可备份 */ }

  const header =
    '# ============================================================\n' +
    '# iOS 日历订阅生成器 · 配置文件\n' +
    '# 本文件可由 Web 编辑器(http://localhost:' + PORT + ')管理,保存即重建\n' +
    '# 手动编辑后运行 pnpm cal:build 同样生效\n' +
    '# ============================================================\n\n';
  fs.writeFileSync(CONFIG_PATH, header + stringifyYaml(parsed.data), 'utf8');

  const result = await buildCalendars({
    config: parsed.data,
    distDir: DIST_DIR,
    log: false,
  });
  return { ok: true, summary: result.rows };
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      serveFile(res, path.join(HERE, 'editor.html'));
      return;
    }
    if (req.method === 'GET' && pathname === '/qrcode.min.js') {
      serveFile(res, path.join(HERE, 'qrcode.min.js'));
      return;
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      json(res, 200, { ok: true, configPath: CONFIG_PATH, config: readConfig() });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/state') {
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (e) {
        json(res, 400, { ok: false, issues: [{ path: '', message: `JSON 解析失败:${(e as Error).message}` }] });
        return;
      }
      json(res, 200, await handleSave(body));
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/dist/')) {
      const rel = pathname.slice('/dist/'.length);
      const target = path.resolve(DIST_DIR, rel);
      if (!target.startsWith(DIST_DIR + path.sep) && target !== DIST_DIR) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        serveFile(res, target);
        return;
      }
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  } catch (e) {
    json(res, 500, { ok: false, issues: [{ path: '', message: (e as Error).message }] });
  }
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === '0.0.0.0' ? '<本机局域网IP>' : HOST;
  console.log(`📅 ios-cal-sub 编辑器已启动:`);
  console.log(`   本机编辑   http://localhost:${PORT}/`);
  if (HOST === '0.0.0.0') {
    console.log(`   手机订阅   http://<本机局域网IP>:${PORT}/dist/<日历id>.ics(同一 Wi-Fi 下)`);
  }
  void shownHost;
  console.log(`   配置文件   ${CONFIG_PATH}`);
  console.log(`   输出目录   ${DIST_DIR}`);
});
