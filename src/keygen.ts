/**
 * 生成在线编辑器的访问密钥:
 *   pnpm cal:key            → 随机生成一个 UUID 并显示其 SHA-256
 *   pnpm cal:key <uuid>     → 为你指定的 UUID 计算哈希(找回时重新生成同值)
 *
 * UUID 本身自行保存、绝不入库;仓库里只放哈希。
 */
import { createHash, randomUUID } from 'node:crypto';

const arg = process.argv[2];
const uuid =
  arg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)
    ? arg.toLowerCase()
    : randomUUID();

const hash = createHash('sha256').update(uuid.trim()).digest('hex');

console.log(`
🔑 你的访问密钥(UUID,请妥善自存,不要提交到任何仓库/网页):

   ${uuid}

线上启用(推荐):把下面的哈希配置为仓库的 Actions Secret
  GitHub → Settings → Secrets and variables → Actions → New repository secret
  Name:  CAL_EDITOR_KEY_SHA256
  Value: ${hash}

本地启用(可选):写进 calendars.yaml 的 editor_auth.key_sha256。
忘记密钥?重新 pnpm cal:key 并更新 Secret 即可。
`);
