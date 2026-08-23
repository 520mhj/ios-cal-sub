/**
 * 零依赖 YAML 序列化器(浏览器/Node 通用)。
 * 策略:字符串一律双引号并转义,保证任意内容(emoji、逗号、冒号)都安全;
 * 键顺序按对象插入序,输出稳定可 diff。
 * 注意:必须保持自包含 —— generate.ts 会用 fn.toString() 把它整体注入编辑器页面。
 */
export function dumpYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const scalar = (v: unknown): string | null => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') {
      const s = v
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      return `"${s}"`;
    }
    return null;
  };

  const isEmptyContainer = (v: unknown): boolean =>
    Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        const sc = scalar(item);
        if (sc !== null) return `${pad}- ${sc}`;
        const inner = dumpYaml(item, indent + 1);
        const lines = inner.split('\n');
        return `${pad}- ${lines[0]!.trimStart()}${lines.length > 1 ? '\n' + lines.slice(1).join('\n') : ''}`;
      })
      .join('\n');
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      // 跳过空值键:undefined/null 在配置语义里等于"未设置",
      // 输出成 `key: null` 会撞上 zod 的 optional 校验(expected string, received null)
      .filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([k, v]) => {
        const sc = scalar(v);
        if (sc !== null) return `${pad}${k}: ${sc}`;
        if (isEmptyContainer(v)) return `${pad}${k}: ${Array.isArray(v) ? '[]' : '{}'}`;
        return `${pad}${k}:\n${dumpYaml(v, indent + 1)}`;
      })
      .join('\n');
  }

  return String(value);
}

/**
 * 深度清除对象树里的 null 值键(改为删除该键)。
 * 用于配置入口的统一清洗:让历史上已被写成 `key: null` 的 YAML 自愈,
 * 通过 zod 的 optional 校验。数组内的 null 保留原样(配置中不存在此形态)。
 */
export function stripNullValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripNullValues(v)) as unknown as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNullValues(v);
    }
    return out as unknown as T;
  }
  return value;
}
