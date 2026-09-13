/**
 * 首页(index.html)渲染 —— 本地构建和 Cloudflare Worker 共用
 * 纯函数,无文件系统依赖,可在任意 JS 运行时使用。
 */

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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function indexHtml(
  siteBaseUrl: string,
  rows: BuildSummaryRow[],
  generatedAt: string,
): string {
  const base = siteBaseUrl?.replace(/\/+$/, '') ?? '';
  const host = base.replace(/^https?:\/\//, '');
  // 统一用 webcals://(安全协议,转 https://),避免 iOS 提示不安全连接
  const webcalProto = 'webcals://';

  const subscribeArea = (r: BuildSummaryRow) => {
    if (r.access === 'private') {
      return `<span class="btn disabled" title="私密订阅 · 链接在编辑页该日历区域查看">🔒 私密订阅</span>`;
    }
    if (!base) return `<span class="btn disabled" title="部署后可订阅">📲 部署后可订阅</span>`;
    const subscribeUrl = `${webcalProto}${host}/${r.file}`;
    const qrUrl = `${base}/${r.file}`; // 二维码用 https://,兼容性更好(部分手机扫码器不识别 webcals://)
    return `<a class="btn" href="${subscribeUrl}">📲 订阅(webcal)</a>` +
      `<button type="button" class="btn ghost" data-qr="${qrUrl}" data-name="${escapeHtml(r.name)}">🔳 扫码订阅</button>`;
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
  .btn { display: inline-block; padding: 8px 14px; border-radius: 9px; background: #0a84ff; color: #fff; text-decoration: none; font-size: 14px; margin-right: 8px; border: 0; cursor: pointer; }
  .btn.ghost { background: transparent; color: inherit; border: 1px solid #8886; }
  .btn.disabled { background: #8884; color: inherit; cursor: default; }
  code { display: block; margin-top: 10px; font-size: 12px; opacity: .7; word-break: break-all; }
  .qr-overlay { position: fixed; inset: 0; background: #000a; display: flex; align-items: center; justify-content: center; z-index: 99; }
  .qr-overlay[hidden] { display: none; }
  .qr-box { background: #fff; color: #111; border-radius: 16px; padding: 24px; max-width: 92vw; text-align: center; box-shadow: 0 10px 40px #0006; }
  .qr-box h3 { margin: 0 0 12px; font-size: 17px; }
  .qr-tip { font-size: 12px; color: #666; line-height: 1.6; margin: 12px 0; max-width: 280px; }
  .qr-box input { width: 100%; box-sizing: border-box; font-size: 12px; padding: 8px; border: 1px solid #8886; border-radius: 8px; color: #333; background: #fafafa; }
  .qr-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: center; }
  footer { color: #888; font-size: 12px; margin-top: 32px; line-height: 1.7; }
</style>
</head>
<body>
<h1>📅 iOS 日历订阅 <a href="/editor/" style="font-size:14px;font-weight:normal;opacity:.6;margin-left:12px">⚙️ 编辑器</a></h1>
<p>在 iPhone 上打开本页,点「订阅(webcal)」即可;或在 <b>设置 → 应用 → 日历 → 日历账户 → 添加订阅日历</b> 中粘贴下方链接。</p>
${cards}
<footer>由 ios-cal-sub 生成于 ${escapeHtml(generatedAt)}。数据来源:<a href="https://github.com/NateScarlet/holiday-cn">NateScarlet/holiday-cn</a>(国务院公告自动化解析)。</footer>
<div class="qr-overlay" id="qrModal" hidden>
  <div class="qr-box">
    <h3 id="qrTitle">扫码订阅</h3>
    <div id="qrSvg"></div>
    <p class="qr-tip">手机相机对准二维码 → 点链接打开浏览器 → 自动下载 .ics 文件 → 点击文件即可导入日历。也可复制下方链接,在「设置 → 日历 → 添加订阅日历」中粘贴。</p>
    <input readonly id="qrLink" onclick="this.select()">
    <div class="qr-actions">
      <button type="button" class="btn" id="qrCopy">📋 复制链接</button>
      <button type="button" class="btn ghost" id="qrClose">关闭</button>
    </div>
  </div>
</div>
<script src="qrcode.min.js"></script>
<script>
  document.querySelectorAll('[data-qr]').forEach((b) =>
    b.addEventListener('click', () => {
      const url = b.dataset.qr, name = b.dataset.name;
      document.getElementById('qrTitle').textContent = '扫码订阅 · ' + name;
      document.getElementById('qrLink').value = url;
      try {
        if (typeof qrcode !== 'function') throw new Error('qrcode 库未加载,请检查 qrcode.min.js 是否可访问');
        const qr = qrcode(0, 'M');
        qr.addData(url, 'Byte');
        qr.make();
        const n = qr.getModuleCount();
        let svg = '<svg viewBox="0 0 ' + n + ' ' + n + '" style="width:232px;height:232px" shape-rendering="crispEdges">';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) svg += '<rect x="' + c + '" y="' + r + '" width="1" height="1"/>';
        svg += '</svg>';
        document.getElementById('qrSvg').innerHTML = svg;
      } catch (e) {
        document.getElementById('qrSvg').innerHTML = '<p style="color:#d33;font-size:13px">二维码生成失败: ' + (e.message || e) + '</p>';
        console.error('QR generation failed:', e, 'url:', url);
      }
      document.getElementById('qrModal').hidden = false;
    }),
  );
  const closeQr = () => { document.getElementById('qrModal').hidden = true; };
  document.getElementById('qrModal').addEventListener('click', (e) => {
    if (e.target.id === 'qrModal' || e.target.id === 'qrClose') closeQr();
  });
  document.getElementById('qrCopy').addEventListener('click', () => {
    const v = document.getElementById('qrLink').value, b = document.getElementById('qrCopy');
    const ok = () => { b.textContent = '✅ 已复制'; setTimeout(() => { b.textContent = '📋 复制链接'; }, 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(v).then(ok, () => { document.getElementById('qrLink').select(); });
    else { document.getElementById('qrLink').select(); }
  });
</script>
</body>
</html>`;
}
