/**
 * 私密订阅令牌派生 —— 本地构建和 Cloudflare Worker 共用
 * 基于 Web Crypto API,无 node:crypto 依赖。
 */
import { sha256Hex } from './crypto-utils.js';

/**
 * 私密日历的订阅令牌:
 *   token = sha256( sha256(UUID)hex + '|' + calId ) 前 32 位
 *
 * 双重派生的原因:UUID 不直接出现在令牌材料中;编辑页浏览器端从 UUID 出发
 * 同样先算哈希即可得到同一材料。每个日历独立令牌:泄露一个链接不影响其他日历;
 * 轮换密钥则全部私密链接失效。
 *
 * @param editorKey 访问密钥 UUID(原样,非哈希)
 * @param calId 日历 ID
 */
export async function privateSubscribeToken(editorKey: string, calId: string): Promise<string> {
  const keySha256Hex = await sha256Hex(editorKey);
  const full = await sha256Hex(`${keySha256Hex}|${calId}`);
  return full.slice(0, 32);
}
