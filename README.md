# 📅 ios-cal-sub · iOS 日历订阅服务

一套运行在 **Cloudflare Workers + KV** 上的动态 `.ics` 日历订阅服务:
Fork 代码 → 部署到 Workers → 在线编辑器配置私人日历,iPhone 系统日历即可订阅
「中国节假日调休补班、农历生日纪念日、二十四节气、自定义循环事项」。

**核心特性:私人日历配置存在 Cloudflare KV 中,不进公开仓库。**
Fork 者拿到的代码只含公开的中国节假日日历,你的生日、纪念日、打卡内容等私人信息完全隔离。

| Apple 日历的痛点 | 本工具的方案 |
|---|---|
| 节假日日历**不显示调休补班**,也看不出哪天过节 | `holidays-cn` 源:「🧨 春节 · 假期第1天」+「💼 调休补班(上班)」 |
| 元宵、七夕、寒衣等**传统节日** Apple 日历根本没有 | `lunar-festival` 源:内置 17 个节日,按农历/节气计算,不依赖国务院公告 |
| 农历生日/纪念日要手动换算公历 | `lunar` 源:自动换算、逐年展开、可显示虚岁 |
| 还款日、排班等循环事项无处安放 | `rule` / `solar` / `solar-term` 源:周/月/年/单次/节气锚定 |
| 私人配置写在公开仓库里不安全 | 私人日历存在 Cloudflare KV,公开仓库只有空壳+公开示例 |

---

## 🏗 架构概览

```
┌─────────────────────────────────────────────────────┐
│  公开仓库(GitHub)                                     │
│  ├── src/          Worker 代码(含内置 cn-holidays)  │
│  ├── public/       静态资源(编辑器页面、二维码库)    │
│  ├── wrangler.toml Workers 配置(KV binding 占位)    │
│  └── calendars.yaml 公开示例配置(仅本地构建用)       │
└─────────────────────────────────────────────────────┘
                    │ 部署
                    ▼
┌─────────────────────────────────────────────────────┐
│  Cloudflare Workers(你的账号)                        │
│  ├── Worker 动态生成 .ics(无需构建步骤)             │
│  ├── KV Namespace(CAL_KV)存私人日历配置             │
│  └── Secret(EDITOR_KEY)UUID 访问密钥(加密存储)        │
└─────────────────────────────────────────────────────┘
```

- **公开日历**(cn-holidays):内置在 Worker 代码中,所有人可访问
- **私人日历**:通过在线编辑器写入 KV,只有持有 UUID 密钥的人能管理
- **.ics 动态生成**:每次请求实时计算,无需 CI 构建,修改即时生效

---

## 🚀 快速开始(从 Fork 到手机响铃,约 5 分钟)

### 第 1 步 · Fork 仓库

点本仓库右上角 **Fork**,复制到你自己的账号。

### 第 2 步 · Cloudflare 连接 Git 一键部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **创建应用**
2. 选 **Workers** 标签 → **连接到 Git**
3. 授权 GitHub,选择你 Fork 的 `ios-cal-sub` 仓库
4. 部署设置:
   - **生产分支**: `main`
   - **构建命令**: 留空(静态资源已内联到 `src/assets.generated.ts`,无需构建)
   - **构建输出目录**: 留空
   - **部署命令**: `npx wrangler deploy`(或 `pnpm wrangler deploy`)
5. 点 **保存并部署**,等待 ~30 秒部署完成

部署成功后,你的服务地址是 `https://ios-cal-sub.<你的子域>.workers.dev`。

> 也可以绑定自定义域名:Worker → Settings → Domains & Routes → Add。

### 第 3 步 · 添加 KV Binding(存储私人日历)

1. Worker → **Settings** → **Bindings** → **Add binding** → 选 **KV**
2. **Variable name**: `CAL_KV`(必须 exactly 这个名字)
3. **KV namespace**: 点下拉框 → **Create a namespace** → 名称随意(如 `ios-cal-sub-private`)→ 创建
4. 点 **保存**

> KV 用于存储你的私人日历配置(生日、纪念日、打卡内容等),不进公开仓库。
> 不添加 KV 也能使用公开日历(cn-holidays),但私人日历和编辑器不可用。

### 第 4 步 · 设置访问密钥(UUID)

1. 生成一个 UUID:[uuidgenerator.dev](https://uuidgenerator.dev/) 或本地 `pnpm cal:key`
2. Worker → **Settings** → **Variables and Secrets** → **Add** → 选 **Secret**
   - **Variable name**: `EDITOR_KEY`
   - **Value**: 上一步生成的 UUID(原样粘贴,不需要算哈希)
3. 点 **保存**

> 这个 UUID 用于:① 解锁在线编辑器;② 派生私密订阅令牌。Secret 在 Cloudflare 加密存储,
> Worker 运行时才能读取,不进代码、不进仓库、不暴露在任何公开页面。

### 第 5 步 · 重新部署(使 KV 和 Secret 生效)

Worker 页面右上角点 **重新部署**(或 push 任意改动触发自动部署)。

### 第 6 步 · 在线编辑器:配置你自己的私人日历

浏览器打开 `https://你的域名/editor/`:

1. **解锁**:输入第 4 步的 UUID
2. **编辑**:左侧切换日历,添加/修改事件源(农历生日、节气打卡、循环事项…);
   每个日历可切「🌐 公开 / 🔒 私密」——私密日历不在订阅页显示,
   专属链接在编辑页该日历区域复制
3. **💾 保存到云端** → 配置写入 KV,**立即生效**

### 第 7 步 · iPhone 订阅

打开订阅页 `https://你的域名/`,任选其一:

- **扫一扫(推荐给家人朋友)**:点日历卡片上的 **「🔳 扫码订阅」**,对方 iPhone 相机对准二维码 → 点链接 → 自动弹出「订阅日历」;
- 点日历卡片上的 **「📲 订阅(webcal)」** 按钮;
- 或复制地址,在 iPhone **设置 → 应用 → 日历 → 日历账户 → 添加订阅日历** 里粘贴。
- 🔒 私密日历:回编辑页该日历区域,链接旁同样有二维码(⚠️ 含专属令牌,只私下发给家人朋友)。

### 第 8 步 · 开启提醒(重要,务必设置)

文件内已按标准写入每条事件的提醒指令,但 **iOS 对"订阅式日历"整体忽略文件内提醒**。一次设置解决:

```
iPhone 设置 → 应用 → 日历 → 默认提醒时间
├─ 「日程」改为 → 日程开始时        ← 关键一步
└─ 「全天事件」建议 → 前一天 21:00(或按习惯)
```

---

## 🔧 配置类型详解

在线编辑器覆盖日常增删改;想深度定制时看这节。

### 事件源类型

| type | 说明 | 必填字段 |
|---|---|---|
| `holidays-cn` | 中国法定节假日+调休补班(内置数据) | — |
| `lunar` | 农历事件(生日/纪念日) | `title` `lunar_month` `lunar_day` |
| `solar` | 固定公历日期(每年) | `title` `month` `day` |
| `rule` | 周期规则(周/月/年/单次) | `title` `freq`(+ 对应日期字段) |
| `solar-term` | 单个节气锚定 | `title` `term`(二十四节气名) |
| `lunar-festival` | 农历传统节日(内置 17 个) | `festival` |
| `solar-terms` | 二十四节气全部(一条配置展开) | — |

### 公共可选字段

`note`(进描述)、`time`(HH:mm 定时)、`alarms`(ISO8601 负时长)、`alarm_days_before`(提前 N 天)。

### 示例

```yaml
- type: lunar
  title: 妈妈·生日
  lunar_month: 8
  lunar_day: 15
  birth_year: 1965
  kind: birthday
  alarm_days_before: [1]

- type: rule
  title: 信用卡还款日
  freq: monthly
  day: 25
  time: "09:00"
  alarms: ["-P1D", "-PT1H"]

- type: solar-term
  title: 春分打卡
  term: 春分
  offset_days: 0
  days: 90
  time: "16:00"
```

---

## 💻 本地开发

```bash
pnpm install

# 生成静态资源内联模块(修改 public/ 中的文件后需重新运行)
pnpm build:assets

# 本地构建(用 calendars.yaml 生成 dist/,用于离线验证)
pnpm cal:build
pnpm cal:verify

# 本地启动 Worker(KV 可选,未配置时仅公开日历可用)
pnpm dev          # wrangler dev,本地 http://localhost:8787

# 生成访问密钥
pnpm cal:key

# 拉取最新节假日数据(更新 src/holiday-data.ts)
pnpm cal:fetch
```

本地开发时,`wrangler dev` 会用本地 Miniflare 模拟 KV,无需真实 Cloudflare 账号。

---

## 🔐 隐私与安全

- **私人日历配置**存在 Cloudflare KV 中,**不进 Git 仓库**,Fork 者看不到
- **访问密钥**以 Secret 形式加密存储在 Cloudflare,原始 UUID 只在你浏览器的 sessionStorage 中
- **私密订阅链接**含派生令牌,每个日历独立;泄露一个链接不影响其他日历
- **轮换密钥**:重新设置 `EDITOR_KEY` 会使所有旧私密链接失效,需重新复制
- `calendars.private.yaml`(迁移用)已加入 `.gitignore`,不会误提交

---

## 📐 设计要点

- **动态生成,零构建**:Worker 收到请求时实时计算 .ics,修改配置即时生效
- **稳定 UID**:`sha1(日历ID+逻辑键+日期)`,重复生成 UID 不漂移,订阅端只"修改"不"重复"
- **Web Crypto 兼容**:UID 哈希和令牌派生均用 Web Crypto API,同时兼容 Workers 和 Node.js
- **内置节假日数据**:2025/2026 年节假日数据内置在 `src/holiday-data.ts`,零外部依赖
- **RRULE 与逐日物化按语义选型**:循环事项用单条 RRULE;节气多天序列逐日物化保留进度标题;农历无法用 RRULE 表达,必须物化
- **RFC 5545 合规**:CRLF、75 八字节折行、TEXT 转义、全天排他 DTEND、TZID+VTIMEZONE

---

## ❓ 常见问题

**Q:为什么没有明年春节?**
公告未发布(每年 11~12 月公布)。更新 `src/holiday-data.ts` 并重新部署即可。

**Q:订阅的事件到点不响铃?**
iOS 忽略订阅源的文件内提醒。按「第 7 步」设置默认提醒时间即可。

**Q:固定循环日历里怎么只有一条事件?**
周/月/年循环以单条 RRULE 定义写入,iPhone 自动展开每次发生,这是特性不是丢失。

**Q:私密订阅的链接忘了复制?**
编辑页解锁后进入对应日历即可随时查看。

**Q:能从旧版(GitHub Pages)迁移吗?**
可以。把旧 `calendars.yaml` 中的私人日历部分保存为 `calendars.private.yaml`,
部署后通过编辑器手动添加,或用 API 一次性导入(见 `calendars.private.yaml` 头部注释)。

---

## 🗂 目录结构

```
ios-cal-sub/
├── wrangler.toml          # ★ Workers 配置(KV binding 可选、compatibility_date)
├── calendars.yaml          # 公开示例配置(仅本地构建用,私人日历不写这里)
├── calendars.private.yaml  # 私人日历迁移文件(.gitignore,不入库)
├── public/                 # 静态资源源文件(编辑器页面、二维码库、yaml-dump.js)
│   ├── qrcode.min.js
│   └── editor/
│       ├── index.html      # 在线编辑器
│       └── yaml-dump.js
├── src/
│   ├── worker.ts           # ★ Worker 入口(路由、KV 读写、鉴权、动态生成 .ics)
│   ├── assets.generated.ts # 自动生成的静态资源内联模块(pnpm build:assets 生成)
│   ├── types.ts            # zod 配置校验 schema
│   ├── dates.ts            # 日期工具(纯 UTC 语义)
│   ├── ics.ts              # 极简 RFC 5545 ICS 写入器
│   ├── sources.ts          # 七类事件源展开(async,Web Crypto)
│   ├── crypto-utils.ts     # Web Crypto 封装(sha1/sha256,兼容 Workers+Node)
│   ├── holiday-data.ts     # 内置节假日数据(2025/2026)
│   ├── holiday-data-fs.ts  # 文件系统加载节假日(仅本地构建用)
│   ├── private-token.ts    # 私密订阅令牌派生
│   ├── render-html.ts      # 首页渲染(Worker+本地构建共用)
│   ├── yaml-dump.ts        # 零依赖 YAML 序列化
│   ├── generate.ts         # 本地构建入口(配置 → dist/*.ics)
│   ├── keygen.ts           # cal:key:生成访问密钥 UUID
│   └── editor-page.html    # 编辑器源文件(复制到 public/)
├── scripts/
│   ├── build-assets.ts     # 静态资源内联构建脚本(pnpm build:assets)
│   └── fetch-holidays.ts   # 拉取 holiday-cn 官方数据
├── verify/verify.ts        # 验证套件
├── data/holiday-cn/*.json  # 节假日数据缓存(入库保证可复现)
└── dist/                   # 本地构建产物(不入库)
```

---

## 📄 License

[MIT](LICENSE) — 自由使用、修改、分发,保留版权声明即可。
