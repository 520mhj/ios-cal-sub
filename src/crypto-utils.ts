/**
 * 哈希工具:同时兼容 Cloudflare Workers (Web Crypto API) 和 Node.js 20+ (globalThis.crypto)
 *
 * 注意:Web Crypto 的 digest 是异步的,因此所有哈希函数均为 async。
 * 调用方需要在 async 函数中 await。
 */

async function digest(algorithm: 'SHA-1' | 'SHA-256', data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return globalThis.crypto.subtle.digest(algorithm, encoder.encode(data));
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-1 十六进制(40 位小写) */
export async function sha1Hex(data: string): Promise<string> {
  return bufToHex(await digest('SHA-1', data));
}

/** SHA-256 十六进制(64 位小写) */
export async function sha256Hex(data: string): Promise<string> {
  return bufToHex(await digest('SHA-256', data));
}
