/**
 * 构建脚本:把 public/ 目录中的静态资源生成 src/assets.generated.ts
 * 这样 Worker 可以内联返回静态资源,不依赖 wrangler 的 [assets] 功能,
 * 兼容 wrangler 3.x 和 4.x,以及 Cloudflare Git 集成部署。
 *
 * 用法: pnpm build:assets
 * 在 Cloudflare Git 集成中,把"构建命令"设为 pnpm build:assets
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, 'src', 'assets.generated.ts');

interface AssetDef {
  route: string;
  file: string;
  contentType: string;
  varName: string;
}

const ASSETS: AssetDef[] = [
  {
    route: '/qrcode.min.js',
    file: 'qrcode.min.js',
    contentType: 'application/javascript; charset=utf-8',
    varName: 'QRCODE_JS',
  },
  {
    route: '/editor/',
    file: 'editor/index.html',
    contentType: 'text/html; charset=utf-8',
    varName: 'EDITOR_HTML',
  },
  {
    route: '/editor/index.html',
    file: 'editor/index.html',
    contentType: 'text/html; charset=utf-8',
    varName: 'EDITOR_HTML',
  },
  {
    route: '/editor/yaml-dump.js',
    file: 'editor/yaml-dump.js',
    contentType: 'application/javascript; charset=utf-8',
    varName: 'YAML_DUMP_JS',
  },
];

function escapeForTs(content: string): string {
  // 用 JSON.stringify 安全转义,然后去掉首尾引号
  return JSON.stringify(content).slice(1, -1);
}

function main(): void {
  const lines: string[] = [
    '/**',
    ' * 自动生成的静态资源模块 — 请勿手动编辑!',
    ' * 由 scripts/build-assets.ts 生成,运行 pnpm build:assets 更新。',
    ' */',
    '',
  ];

  const routeMap: Array<{ route: string; varName: string; contentType: string }> = [];
  const seenVars = new Set<string>();

  for (const asset of ASSETS) {
    const filePath = path.join(PUBLIC_DIR, asset.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  跳过不存在的文件: ${asset.file}`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const escaped = escapeForTs(content);

    if (!seenVars.has(asset.varName)) {
      lines.push(`export const ${asset.varName}: string = "${escaped}";`);
      lines.push('');
      seenVars.add(asset.varName);
    }

    routeMap.push({ route: asset.route, varName: asset.varName, contentType: asset.contentType });
  }

  lines.push('export interface StaticAsset {');
  lines.push('  route: string;');
  lines.push('  contentType: string;');
  lines.push('  content: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const STATIC_ASSETS: StaticAsset[] = [');
  for (const r of routeMap) {
    lines.push(`  { route: ${JSON.stringify(r.route)}, contentType: ${JSON.stringify(r.contentType)}, content: ${r.varName} },`);
  }
  lines.push('];');
  lines.push('');

  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
  console.log(`✅ 已生成 ${OUTPUT}`);
  console.log(`   包含 ${routeMap.length} 个路由,${seenVars.size} 个资源文件`);
}

main();
