# 📅 ios-cal-sub · iOS 日历订阅生成器

一套**配置驱动**的静态 `.ics` 日历生成器:Fork 到自己的 GitHub,改改配置,
就能让 iPhone 系统日历订阅「中国节假日调休补班、农历生日纪念日(含虚岁)、
二十四节气连续打卡、自定义循环事项」——纯静态托管,零服务器成本。

| Apple 日历的痛点 | 本工具的方案 |
|---|---|
| 节假日日历**不显示调休补班**,也看不出哪天过节 | `holidays-cn` 源:「🧨 春节 · 假期第1天 / 春节假期 2/9」+「💼 调休补班(上班)」 |
| 元宵、七夕、寒衣等**传统节日** Apple 日历根本没有 | `lunar-festival` 源:内置 12 个农历节日(除夕自动落腊月末) |
| 农历生日/纪念日要手动换算公历 | `lunar` 源:自动换算、逐年展开、可显示虚岁 |
| 还款日、排班等循环事项无处安放 | `rule` / `solar` / `solar-term` 源:周/月/年/单次/节气锚定 |

> 📚 踩坑结论与设计规约:[docs/KNOWLEDGE-BASE.md](docs/KNOWLEDGE-BASE.md)

---

## 🚀 快速开始(从 Fork 到手机响铃,约 10 分钟)

### 第 1 步 · Fork 并准备密钥

1. 点本仓库右上角 **Fork**,复制到你自己的账号
2. 准备一个「访问密钥」:打开 [uuidgenerator.dev/zh-CN](https://uuidgenerator.dev/zh-CN/)
   生成一个 UUID 并保存好;本地有 Node 环境的话也可以 `pnpm install && pnpm cal:key` 生成

> 这个 UUID 有两个用途:① 解锁在线编辑器;② 作为私密订阅令牌的派生源。
> 它只存进 GitHub Secret,不进代码、不出现在任何公开页面。

### 第 2 步 · 配置变量与密钥

仓库 → **Settings → Secrets and variables → Actions**,按下表添加:

| 类型 | Name | Value | 说明 |
|---|---|---|---|
| Variable | `CAL_SITE_BASE_URL` | `https://你的用户名.github.io/仓库名` | 订阅页的访问地址(Fork 后即可确定) |
| Secret | `CAL_EDITOR_KEY` | 第 1 步的 UUID 原样 | 解锁编辑器 + 私密订阅派生 |
| Variable | `CAL_EDITOR_HINT` | 锁屏提示语(如"找站长") | 可选 |

### 第 3 步 · 开启部署

仓库 → **Settings → Pages → Build and deployment → Source 选 GitHub Actions**

然后到 **Actions** 页选 "Build & Deploy Calendars" → **Run workflow** 手动跑第一次。
绿勾后,你的订阅页就是 `https://你的用户名.github.io/仓库名/`(此后每天北京时间 09:00 自动重建;
国务院发布新放假安排时,holiday-cn 收录后订阅端自动跟进,无需任何操作)。

### 第 4 步 · 在线编辑器:配置你自己的日历

浏览器打开 `https://你的用户名.github.io/仓库名/editor/`:

1. **解锁**:输入第 1 步的 UUID
2. **授权保存**(首次):右上角 **🔑 GitHub 设置** → Owner/Repo/分支会自动识别,
   粘贴一个 Fine-grained PAT。获取路径:
   头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token → 仅勾选这个仓库 + Contents 权限设为 Read and write →
   生成后立刻复制 `github_pat_` 长串贴进来(Token 只存你浏览器本地)
3. **编辑**:左侧切换日历,添加/修改事件源(节假日、农历生日、节气打卡、循环事项…);
   每个日历可切「🌐 公开 / 🔒 私密」订阅方式——私密的日历不在订阅页显示,
   专属链接在编辑页该日历区域复制(发给家人即订,各日历互不影响)
4. **🚀 保存到 GitHub** → 等 CI 绿勾(约 1 分钟),订阅端即生效

### 第 5 步 · iPhone 订阅

打开订阅页 `https://你的用户名.github.io/仓库名/`,二选一:

- 直接点日历卡片上的 **「📲 订阅(webcal)」** 按钮;
- 或复制地址,在 iPhone **设置 → 应用 → 日历 → 日历账户 → 添加订阅日历** 里粘贴。
- 🔒 私密日历:回编辑页该日历区域复制专属链接,同样方式粘贴。

订阅是只读的,iOS 会定期自动刷新;想立即刷新就删除订阅重新添加。

### 第 6 步 · 开启提醒(重要,务必设置)

文件内已按标准写入每条事件的提醒指令,但 **iOS 对"订阅式日历"整体忽略文件内提醒**
(事件详情里"提醒"显示"无")。一次设置解决:

```
iPhone 设置 → 应用 → 日历 → 默认提醒时间
├─ 「日程」改为 → 日程开始时        ← 关键一步
└─ 「全天事件」建议 → 前一天 21:00(或按习惯)
```

设置后所有订阅事件都会按此策略响铃:定时事件在开始时刻触发
(定时事件时长固定 30 分钟,如 9:30 的事件在 9:30–10:00 区间内提醒),
全天事件(节假日/生日)按你给「全天事件」配的时间触发。

🎉 完成。之后日常就是:编辑页改一改 → 保存 → 绿勾 → 手机自动更新。

---

## 🔧 参考:calendars.yaml 配置详解(补充理解)

在线编辑器覆盖日常增删改;想深度定制或直接改文件时看这节。

```yaml
# 站点地址/访问密钥走仓库 Variables & Secrets(见快速开始),
# 下面两个字段仅作本地构建的可选兜底:
site_base_url: ""
editor_auth:                 # 可选:本地启用编辑器门禁
  key_sha256: "<UUID 的 SHA-256>"

defaults:
  timezone: Asia/Shanghai
  years_ahead: 2             # 生成窗口 = 当年1月1日 ~ 今年+N 年的12月31日

calendars:
  - id: cn-holidays          # 输出文件名(id 只能小写字母数字连字符)
    name: 🇨🇳 中国节假日与调休   # iPhone 里显示的名字(X-WR-CALNAME)
    description: 可选描述
    access: public           # public(默认)| private
    sources:
      - type: holidays-cn
        include_rest_days: true
        include_workdays: true   # 调休补班——Apple 缺失的部分

      - type: lunar           # 农历事件(生日/纪念日)
        title: 妈妈·生日
        lunar_month: 8        # 农历月 1-12
        lunar_day: 15         # 初一 = 1
        birth_year: 1965      # 可选:显示虚岁
        kind: birthday        # birthday | memorial
        alarm_days_before: [1]
        alarms: ["-PT9H"]

      - type: solar           # 固定公历日期(每年)
        title: 结婚纪念日
        month: 10
        day: 2

      - type: rule            # 周期规则
        title: 信用卡还款日
        freq: monthly         # weekly | monthly | yearly | once
        day: 25               # monthly:几号(31 在小月自动贴月末)
        weekday: thu          # weekly:mon~sun
        month: 6              # yearly:几月
        date: "2026-03-15"    # once:具体日期
        time: "09:00"         # 可选:定时(省略=全天);时长固定 30 分钟
        start: "2026-01-01"   # 可选:限定区间
        end: "2028-12-31"
        alarms: ["-P1D", "-PT1H"]

      - type: solar-term      # 节气锚定(每年节气日自动发生)
        title: 明天春分·扳指见龙脊
        term: 春分             # 二十四节气名
        offset_days: -1      # 前一天=-1,最多 ±183,默认 0
        days: 90             # 连续展开天数(1~366);>1 时标题带 (n/N) 进度
        time: "16:00"
        alarms: ["-PT10M"]

      - type: lunar-festival  # 农历传统节日(内置计算,零外部数据)
        festival: 七夕节       # 元宵节/龙抬头/上巳节/七夕节/中元节/重阳节/寒衣节/下元节/腊八节/小年/除夕
        alarm_days_before: [0] # 标题自动取节日名;除夕自动落在腊月最后一天
```

### 各类型字段速查

| type | 必填 | 可选 |
|---|---|---|
| `holidays-cn` | — | `include_rest_days`(默认 true)、`include_workdays`(默认 true) |
| `lunar` | `title` `lunar_month` `lunar_day` | `birth_year` `kind` `note` `time` `alarms` `alarm_days_before` |
| `solar` | `title` `month` `day` | 同上公共字段 |
| `rule` | `title` `freq`(+ 按 freq:`weekday`/`day`/`month+day`/`date`) | `start` `end` 及公共字段 |
| `solar-term` | `title` `term`(二十四节气名) | `offset_days`(±183)、`days`(1~366)及公共字段 |
| `lunar-festival` | `festival`(内置节日名) | 公共字段(`title` 自动取节日名,可不填)|

公共可选字段(除 holidays-cn 外通用):`note`(进描述)、`time`(HH:mm 定时)、
`alarms`(ISO8601 负时长)、`alarm_days_before`(提前 N 天)。

> 写入形态:`rule` 的 weekly/monthly(day≤28)/yearly(非 2·29)以单条 RFC 5545 RRULE
> 写入,iPhone 自动展开每次发生;月末钳制(day>28、2·29)与节气多天序列自动回退为逐日物化。

## 💻 本地运行与局域网编辑器(可选)

```bash
pnpm install
pnpm cal:fetch    # 拉取节假日官方数据(data/holiday-cn/)
pnpm cal:build    # 生成 dist/*.ics + index.html + editor/
pnpm cal:verify   # 验证产物(格式合规、第三方库回读、配置↔产物一致性)
pnpm cal:key      # 生成访问密钥 UUID
pnpm cal:all      # fetch + build + verify 一条龙
```

`HOST=0.0.0.0 pnpm cal:web` → 同一 Wi-Fi 手机访问 `http://电脑IP:5188`,
离线场景下也能编辑(无需 GitHub Token,保存即时重建)。

## 📐 设计要点

- **稳定 UID**:`sha1(日历ID+逻辑键+日期)`,重复构建 UID 不漂移,订阅端只"修改"不"重复"
- **RRULE 与逐日物化按语义选型**(判定表见知识库 §12):循环事项用单条
  `RRULE:FREQ=...;UNTIL=...`;节气多天序列逐日物化以保留 `(n/N)` 进度标题;
  农历无法用 RRULE 表达,必须物化
- **RFC 5545 合规**:CRLF、75 八字节折行(UTF-8 安全)、TEXT 转义、全天排他 DTEND、
  `TZID=Asia/Shanghai` + VTIMEZONE
- **验证独立于生成器**:用 ts-ics 第三方回读解析,另做配置↔产物定义级比对
  (UID 双向 diff、RRULE 规则体核对、VALARM 总数精确相等)与天文事实抽查

## ❓ 常见问题

**Q:为什么没有明年春节?**
公告未发布(每年 11~12 月公布)。holiday-cn 收录后 CI 自动补上。

**Q:订阅的事件到点不响铃 / "提醒"显示"无"?**
iOS 忽略订阅源的文件内提醒。按「第 6 步」设置默认提醒时间即可;重要事项也可点开单条手动设提醒。

**Q:固定循环日历里怎么只有一条事件?**
周/月/年循环以单条 RRULE 定义写入,iPhone 自动展开每次发生,这是特性不是丢失。

**Q:农历三十出生的家人,遇到只有廿九的年份怎么办?**
自动贴到当月最后一天(廿九过)。闰月默认按平月过。

**Q:私密订阅的链接忘了复制?**
编辑页解锁后进入对应日历即可随时查看;轮换 `CAL_EDITOR_KEY` 会使旧链接失效,重抄新链即可。

**Q:能加母亲节("五月的第二个星期日")这类节日吗?**
节气锚定用 `solar-term`;暂未内置"第 N 个星期几"规则,欢迎扩展 `rule` 类型。

## 🗂 目录结构

```
ios-cal-sub/
├── calendars.yaml            # ★ 日历配置(编辑器保存的目标文件)
├── src/
│   ├── types.ts              # zod 配置校验 schema
│   ├── dates.ts              # 日期工具(纯 UTC 语义)
│   ├── ics.ts                # 极简 RFC 5545 ICS 写入器(折行/转义/VTIMEZONE/VALARM/RRULE)
│   ├── sources.ts            # 五类事件源展开(holidays-cn/lunar/solar/rule/solar-term)
│   └── generate.ts           # 主入口:配置 → dist/*.ics + index.html + manifest.json
├── scripts/fetch-holidays.ts # 拉取 holiday-cn 官方数据
├── src/web/                  # 局域网编辑器(server.ts + editor.html,可选)
├── src/editor-page.html      # ★ 在线编辑器模板(构建产出 dist/editor/)
├── src/yaml-dump.ts          # 零依赖 YAML 序列化(Node/浏览器通用)
├── src/keygen.ts             # cal:key:生成访问密钥 UUID
├── verify/verify.ts          # 验证套件
├── docs/KNOWLEDGE-BASE.md    # 排障结论与设计规约
├── data/holiday-cn/*.json    # 节假日数据缓存(入库保证可复现)
├── dist/                     # 生成产物:*.ics + index.html + manifest.json + editor/
└── .github/workflows/deploy.yml
```
