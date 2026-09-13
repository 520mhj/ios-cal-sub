/**
 * 私密订阅令牌派生 —— 本地构建和 Cloudflare Worker 共用
 * 基于 Web Crypto API,无 node:crypto 依赖。
 */
import { sha256Hex } from './crypto-utils.js';

/**
 * 私密日历的订阅令牌:
 *   token = sha256( 访问密钥的SHA-256十六进制 + '|' + calId ) 前 32 位
 * 双重派生的原因:构建端手里是密钥的哈希,编辑页浏览器端从 UUID 出发同样先算哈希即可得到同一材料。
 * 每个日历独立令牌:泄露一个链接不影响其他日历;轮换密钥则全部私密链接失效。
 */
export async function privateSubscribeToken(keySha256Hex: string, calId: string): Promise<string> {
  const full = await sha256Hex(`${keySha256Hex}|${calId}`);
  return full.slice(0, 32);
}
