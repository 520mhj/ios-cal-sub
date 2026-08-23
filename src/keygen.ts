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

把它对应的哈希写进 calendars.yaml(已为你生成好粘贴内容):

editor_auth:
  key_sha256: "${hash}"

然后 pnpm cal:build / git push 生效。编辑页输入上面的 UUID 即可解锁。
忘记密钥?换一个新的:pnpm cal:key(用新哈希覆盖旧配置即可)。
`);
