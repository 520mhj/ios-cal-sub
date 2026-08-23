# 📅 ios-cal-sub · iOS 日历订阅生成器

自己动手,补齐 Apple 日历的缺失:一套**配置驱动**的静态 `.ics` 日历生成器,
部署到任意静态托管(GitHub Pages / 对象存储)后,iPhone 用系统日历直接订阅 URL,零服务器成本。

## 解决什么问题

| 痛点 | 本工具的方案 |
|---|---|
| Apple 自带中国节假日日历**不显示调休补班**,容易忘记上班 | `holidays-cn` 源:每个补班日生成醒目的「💼 调休补班(上班)」事件,并提前一晚提醒 |
| 农历生日/纪念日 Apple 提醒很弱,还要手动换算公历 | `lunar` 源:农历自动换算公历、逐年展开、可显示虚岁 |
| 还款日、排班、年检等自定义循环事件无处安放 | `rule` / `solar` 源:每周/每月/每年/单次 + 定时提醒 |

## 特性

- 🔒 **稳定 UID**:同一逻辑事件的 UID 永不变化,数据更新后订阅端是"修改"而不是"重复新增"
- 📄 **RFC 5545 合规**:CRLF、75 字节折行(UTF-8 安全)、TEXT 转义、全天事件排他 DTEND
- 🌏 时区正确处理:定时事件带 `TZID=Asia/Shanghai` + VTIMEZONE;节假日/生日为全天事件
- ✅ **内置验证**(`pnpm cal:verify`):物理格式检查 + ts-ics 第三方回读解析 + 已知日期事实抽查
- ♻️ 数据来源 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)(自动解析国务院公告,社区最权威)

```bash
pnpm install
pnpm cal:fetch    # 拉取节假日官方数据到 data/holiday-cn/(去年~今年+2 年)
pnpm cal:build    # 读取 calendars.yaml → 生成 dist/*.ics + index.html + editor/
pnpm cal:verify   # 验证生成的日历(格式合规、回读解析、关键日期抽查)
pnpm cal:key      # (可选)生成在线编辑器的访问密钥 UUID + 哈希
```

然后编辑 `calendars.yaml`,把示例里的生日、纪念日、循环事项换成你自己的。

## 🌐 在线编辑器(部署在 GitHub Pages 上,浏览器直接改)

部署后打开 `https://你的用户名.github.io/仓库名/editor/`,手机/电脑浏览器里
点选式增删改事件,**保存直接提交回仓库**,CI 自动重建发布(约 1 分钟后订阅端可见)。

### 首次启用三步

1. **生成访问密钥**:`pnpm cal:key` → 得到一个 UUID(自行保管)和它的 SHA-256,
   按提示把 `editor_auth.key_sha256` 粘进 `calendars.yaml`
2. push 部署后,打开 `/editor/` 会看到 🔐 锁屏,输入 UUID 解锁
3. 点右上角 **🔑 GitHub 设置**:填 Owner/Repo/分支(从 github.io 地址自动识别)+
   **Fine-grained PAT**(仅授予该仓库 Contents 读写)

之后日常就是:解锁 → 加/改事件 → 「🚀 保存到 GitHub」→ 等 CI 绿勾 → iPhone 刷新订阅。

### 安全模型(重要)

| 层 | 机制 | 说明 |
|---|---|---|
| 编辑页门禁 | UUID 的 SHA-256 校验 | 只防"偷看"编辑界面;哈希公开但 UUID 不在库里(UUID v4 有 122 位熵,不可暴力) |
| 真正的写权限 | GitHub Fine-grained PAT | 只授予这一个仓库的 Contents 读写;Token 仅存于你浏览器的 localStorage(可勾选不记住) |
| 数据公开边界 | `data.json` 与 `.ics` 本身公开 | 能订阅就能看内容;若生日等高度敏感,请勿使用公开 Pages,或接受"知道 URL 即可订阅"的现实 |

- 忘记 UUID:重新 `pnpm cal:key` 覆盖配置提交即可
- Token 泄露:GitHub → Settings → Developer settings 里立即 revoke

### 工作原理

```
iPhone 订阅 ← dist/*.ics ← GitHub Actions(CI 自动构建)← calendars.yaml ←┐
                                                                        │ PUT Contents API(PAT)
浏览器 /editor/(UUID 门禁 → 读 data.json → 表单编辑 → dumpYaml 序列化)────┘
```

编辑页读写的是**最后一次部署**的配置;保存后页面会给出 Actions 进度链接。

## 📶 局域网本地编辑器(可选,离线场景)

`HOST=0.0.0.0 pnpm cal:web` → 同一 Wi-Fi 手机访问 `http://电脑IP:5188`,
保存即时重建本机 dist/,适合在家直连订阅、或没有 GitHub 的场景。

## iPhone 订阅步骤

1. 把 `dist/` 部署到任意静态托管(推荐 GitHub Pages,见下文),得到类似
   `https://你的用户名.github.io/仓库名/cn-holidays.ics` 的地址
2. 在 iPhone 上二选一:
   - **设置 → 应用 → 日历 → 日历账户 → 添加订阅日历**,粘贴 URL
   - 或用 Safari 打开部署页 `index.html`,点「📲 订阅(webcal)」按钮
3. 打开系统日历 App,订阅的日历会出现在账户列表里,可随时显示/隐藏

> 💡 订阅日历是**只读**的。iOS 会周期性自动刷新(通常几小时一次);
> 想立即刷新:设置 → 应用 → 日历 → 日历账户 → 对应订阅 → 强制刷新(或删除重加)。

## 配置参考(calendars.yaml)

```yaml
site_base_url: ""            # 部署后的站点地址,用于 index.html 的 webcal 链接;本地预览留空
defaults:
  timezone: Asia/Shanghai
  years_ahead: 2             # 向未来展开几年

calendars:
  - id: cn-holidays          # 输出文件名 cn-holidays.ics(id 只能小写字母数字连字符)
    name: 🇨🇳 中国节假日与调休   # 订阅后在 iOS 里显示的名字(X-WR-CALNAME)
    description: 可选描述
    sources:                 # 一个日历可以混合多种事件源
      - type: holidays-cn
        include_rest_days: true
        include_workdays: true

      - type: lunar          # 农历事件(生日/纪念日)
        title: 妈妈·生日
        lunar_month: 8       # 农历月 1-12
        lunar_day: 15        # 初一 = 1
        birth_year: 1965     # 可选:显示虚岁
        kind: birthday       # birthday | memorial
        alarm_days_before: [1]           # 提前 N 天的全天提醒
        alarms: ["-PT9H"]                # 或自由组合 ISO8601 负时长提醒

      - type: solar          # 固定公历日期(每年)
        title: 结婚纪念日
        month: 10
        day: 2

      - type: rule           # 周期规则
        title: 信用卡还款日
        freq: monthly        # weekly | monthly | yearly | once
        day: 25              # monthly: 每月几号;31 号在不足月份自动贴到月末
        weekday: thu         # weekly: mon/tue/wed/thu/fri/sat/sun(与 day 二选一按 freq)
        month: 6             # yearly: 几月
        date: "2026-03-15"   # once: 具体日期
        time: "09:00"        # 可选:定时事件(默认全天);时区取 defaults.timezone
        start: "2026-01-01"  # 可选:限定区间
        end: "2028-12-31"
        alarms: ["-P1D", "-PT1H"]
```

### 各类型字段速查

| type | 必填 | 可选 |
|---|---|---|
| `holidays-cn` | — | `include_rest_days`(默认 true)、`include_workdays`(默认 true,**这是 Apple 缺失的部分**) |
| `lunar` | `title` `lunar_month` `lunar_day` | `birth_year` `kind` `note` `time` `alarms` `alarm_days_before` |
| `solar` | `title` `month` `day` | 同上公共字段 |
| `rule` | `title` `freq`(+ 按 freq:`weekday`/`day`/`month+day`/`date`) | `start` `end` 及公共字段 |

公共可选字段(除 holidays-cn 外通用):`note`(进描述)、`time`(HH:mm,定时事件)、
`alarms`(ISO8601 负时长,如 `-P1D`)、`alarm_days_before`(提前 N 天)。

## 部署到 GitHub Pages(推荐)

1. 在 GitHub 新建仓库(或 private→public,GitHub Pages 免费版需公开仓库),push 本项目
2. 仓库 **Settings → Pages → Build and deployment → Source 选 GitHub Actions**
3. 推送到 `main` 即触发首次部署;此后**每天北京时间 09:00 自动重建**
4. 部署完成后把 `https://用户名.github.io/仓库名` 填入 `calendars.yaml` 的 `site_base_url`

### 自动更新机制

- 国务院通常每年 11~12 月发布次年放假安排 → holiday-cn 当天收录 →
  下一次定时构建自动拉取并重新生成 → 你的 iPhone 订阅**无需任何操作**即可看到新一年安排
- 在公告发布前,未来年份的数据文件是空占位(`days: []`),构建时会明确提示,属正常现象
- 改了 `calendars.yaml` 后 push 即生效;本地改完也可以手动跑 `pnpm cal:all`

## 目录结构

```
ios-cal-sub/
├── calendars.yaml            # ★ 你唯一需要编辑的文件
├── src/
│   ├── types.ts              # zod 配置校验 schema
│   ├── dates.ts              # 日期工具(纯 UTC 语义)
│   ├── ics.ts                # 极简 RFC 5545 ICS 写入器(折行/转义/VTIMEZONE/VALARM)
│   ├── sources.ts            # 四类事件源展开(holidays-cn/lunar/solar/rule)
│   └── generate.ts           # 主入口:配置 → dist/*.ics + index.html + manifest.json
├── scripts/fetch-holidays.ts # 拉取 holiday-cn 官方数据(带缓存,离线可用)
│   list-terms.ts             # 小工具:列出某年二十四节气的公历日期
├── src/web/
│   ├── server.ts             # 局域网编辑器服务(可选,零框架依赖)
│   └── editor.html           # 局域网单页编辑器
├── src/editor-page.html      # ★ 在线编辑器源模板(构建时注入 dumpYaml → dist/editor/)
├── src/yaml-dump.ts          # 零依赖 YAML 序列化(Node/浏览器通用,往返已验证)
├── src/keygen.ts             # cal:key:生成访问密钥 UUID + SHA-256
├── verify/verify.ts          # 验证套件(格式/回读/事实抽查/编辑器产物)
├── data/holiday-cn/*.json    # 节假日数据缓存(提交入库,保证构建可复现)
├── dist/                     # 生成产物:*.ics + index.html + manifest.json
└── .github/workflows/deploy.yml
```

## 设计要点(为什么这样做)

- **逐日展开而非 RRULE**:iOS 对订阅日历的 RRULE 支持有限,且农历根本无法用 RRULE 表达;
  展开成具体日期最稳,配合稳定 UID 更新无副作用
- **UID = sha1(日历ID+逻辑键+日期)**:确定性生成,重复构建不漂移
- **DTSTAMP 按小时取整**(或用 `SOURCE_DATE_EPOCH` 固定):减少 git 无意义抖动
- **验证脚本独立于生成器**:用第三方库(ts-ics)回读解析,避免"自己写自己验"的盲区;
  并内置已知事实断言(如 2000 年中秋 = 2000-09-12)

## 常见问题

**Q:为什么我的日历里没有明年春节?**
公告未发布。每年 11~12 月国务院公布后,holiday-cn 收录,CI 定时任务次日自动补上。

**Q:农历三十出生的家人,遇到只有廿九的年份怎么办?**
自动贴到当月最后一天(廿九过)。闰月默认按平月过(更符合习惯)。

**Q:补班提醒几点响?**
默认 `-PT19H`(当天 00:00 往前 19 小时 ≈ 前一天早上 5 点,"今天要上班")。
想改成前一天晚上,可在 calendars.yaml 给 holidays-cn 加不了(该源不支持 per-source alarms),
可自行修改 `src/sources.ts` 中 `expandHolidaysCn` 的 alarms 值。

**Q:iOS 会同步多久以后的事件?**
Apple 未公开窗口长度,实测约一年内可靠。本工具默认展开 `years_ahead: 2` 年以留足余量。

**Q:能加节气/节日(如母亲节"五月的第二个星期日")吗?**
目前未内置"第 N 个星期几"规则,可先用近似日期,或欢迎扩展 `rule` 类型。
