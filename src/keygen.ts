/**
 * 生成访问密钥(UUID):
 *   pnpm cal:key            → 随机生成一个 UUID
 *   pnpm cal:key <uuid>     → 使用你指定的 UUID(找回时保持不变)
 *
 * UUID 原样存入仓库 Secret CAL_EDITOR_KEY(仅自己可见);
 * 构建时自动计算其 SHA-256 写入公开产物——UUID 本身绝不入库、不出现在任何页面。
 */
import { randomUUID } from 'node:crypto';

const arg = process.argv[2];
const uuid =
  arg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)
    ? arg.toLowerCase()
    : randomUUID();

console.log(`
🔑 你的访问密钥(UUID,请妥善自存,不要提交到任何仓库/网页):

   ${uuid}

启用(推荐):把上面的 UUID 原样配置为仓库的 Actions Secret
  GitHub → Settings → Secrets and variables → Actions → New repository secret
  Name:  CAL_EDITOR_KEY
  Value: ${uuid}

解锁在线编辑器时输入这个 UUID 即可;忘记密钥?重新生成并更新 Secret。
`);
