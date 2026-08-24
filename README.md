# 📅 ios-cal-sub · iOS 日历订阅生成器

自己动手,补齐 Apple 日历的缺失:一套**配置驱动**的静态 `.ics` 日历生成器,
部署到任意静态托管(GitHub Pages / 对象存储)后,iPhone 用系统日历直接订阅 URL,零服务器成本。

> 📚 踩坑结论与设计规约见 [docs/KNOWLEDGE-BASE.md](docs/KNOWLEDGE-BASE.md)(排障后请随手更新)。

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
- ✅ **内置验证**(`pnpm cal:verify`):物理格式检查 + ts-ics 第三方回读解析 + 天文事实抽查
  + 配置↔产物定义级比对(UID 双向 diff、RRULE 规则体逐条核对、VALARM 总数精确相等)
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

### 首次启用(Fork 后一次配好)

1. **生成访问密钥**:本地运行 `pnpm cal:key` → 得到一个 UUID,妥善自存
2. **把 UUID 原样存入仓库 Secret**(零提交,下次构建即生效):
   GitHub 仓库 → Settings → Secrets and variables → Actions → **Secrets** 标签 →
   New repository secret → Name 填 `CAL_EDITOR_KEY`,Value 填那个 UUID
3. 打开 `/editor/`,锁屏输入该 UUID 解锁

> 构建时自动把 UUID 算成 SHA-256 写入站点校验文件——UUID 本身不进仓库、不出现在任何公开页面。

### 获取 GitHub Token(PAT)——编辑器保存修改用

订阅日历是只读看板,想把网页里的修改保存回仓库,需要一个你自己签发的 Token:

```
GitHub 右上角头像 → Settings
→ 左栏最底 Developer settings
→ Personal access tokens → Fine-grained tokens → Generate new token
├─ Token name        : ios-cal-sub-editor(随意)
├─ Expiration        : 建议 90 days(到期换新的贴回编辑器即可)
├─ Resource owner    : 你的用户名
├─ Repository access : Only select repositories → 勾选 fork 出来的这个仓库
├─ Permissions → Repository permissions → Contents → Read and write
└─ Generate token → 立刻复制 github_pat_ 开头的长串(只显示这一次!)
```

回到编辑器:右上角 **🔑 GitHub 设置** → Owner/Repo/分支会自动识别,
粘贴 Token → 勾选「在本机记住」→ 确定。之后:**加/改事件 → 🚀 保存到 GitHub → 等 CI 绿勾 → iPhone 刷新订阅**。

> Token 只存在你浏览器的 localStorage;泄露随时去 Developer settings 里 Delete。
> 忘记访问密钥(UUID)?重新 `pnpm cal:key` 换一个,更新 Secret 即可,无需任何提交。

### 安全模型(重要)

| 层 | 机制 | 说明 |
|---|---|---|
| 编辑页门禁 | UUID 比对(UUID 存 Secret,站点只有其 SHA-256) | 只防"偷看"编辑界面;UUID 本身不进 git 历史也不出现在公开产物(UUID v4 有 122 位熵,不可暴力) |
| 真正的写权限 | GitHub Fine-grained PAT | 只授予这一个仓库的 Contents 读写;Token 仅存于你浏览器的 localStorage |
| 数据公开边界 | `data.json` 与 `.ics` 本身公开 | 能订阅就能看内容;高度敏感内容请配合下方的订阅地址保护,或勿用公开 Pages |

- 忘记 UUID:重新 `pnpm cal:key`,把新哈希更新到 Secret 即可(无需任何提交)
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

## 🔔 让提醒真正响铃(重要,务必设置)

文件内已按 RFC 5545 写入每条事件的提醒指令(VALARM),但 **iOS 对"订阅式日历"
会整体忽略文件内的提醒**——事件详情里的「提醒」显示为"无"。这不是生成缺陷,
换任何 .ics 订阅源都一样(Google 日历等客户端则会正常生效)。

**解决办法(一次设置,全局生效)**:

```
iPhone 设置 → 应用 → 日历 → 默认提醒时间
├─ 「日程」改为 → 日程开始时        ← 关键一步
└─ 「全天事件」建议 → 前一天 21:00(或按习惯)
```

- 设置后,所有没有本地提醒的订阅事件都会套用默认策略响铃;
- 定时事件在**开始时刻**触发(本工具生成的定时事件时长固定 30 分钟,
  如 9:30 的事件在 9:30–10:00 这个区间内提醒);
- 全天事件(节假日/生日)按你给「全天事件」配的时间触发。

## 配置参考(calendars.yaml)

```yaml
# 线上站点地址/编辑器密钥走仓库 Variables & Secrets(CAL_SITE_BASE_URL 等),
# 此字段仅作本地构建的可选兜底:
site_base_url: ""
defaults:
  timezone: Asia/Shanghai
  years_ahead: 2             # 生成窗口 = 当年1月1日 ~ 今年+N 年的12月31日

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

      - type: solar-term      # 节气锚定(每年节气日自动发生)
        title: 明天春分·扳指见龙脊
        term: 春分            # 二十四节气名(如 处暑/冬至/春分…)
        offset_days: -1      # 相对节气日偏移:前一天=-1,最多 ±183,默认 0
        days: 90             # 从锚点日起连续展开 N 天(1~366,默认 1);>1 时标题带 (n/N) 进度
        time: "16:00"        # 可选:定时事件;省略则为全天
        alarms: ["-PT10M"]
```

### 各类型字段速查

| type | 必填 | 可选 |
|---|---|---|
| `holidays-cn` | — | `include_rest_days`(默认 true)、`include_workdays`(默认 true,**这是 Apple 缺失的部分**) |
| `lunar` | `title` `lunar_month` `lunar_day` | `birth_year` `kind` `note` `time` `alarms` `alarm_days_before` |
| `solar` | `title` `month` `day` | 同上公共字段 |
| `rule` | `title` `freq`(+ 按 freq:`weekday`/`day`/`month+day`/`date`) | `start` `end` 及公共字段 |
| `solar-term` | `title` `term`(二十四节气名) | `offset_days`(默认 0,±183)、`days`(默认 1,1~366)及公共字段 |

公共可选字段(除 holidays-cn 外通用):`note`(进描述)、`time`(HH:mm,定时事件,时长固定 30 分钟)、
`alarms`(ISO8601 负时长,如 `-P1D`)、`alarm_days_before`(提前 N 天)。

> 写入形态:`rule` 的 weekly/monthly(day≤28)/yearly(非 2·29)以**单条 RRULE** 写入,
> iPhone 自动展开每次发生;月末钳制(day>28、2·29)与节气多天序列自动回退为逐日物化。

## 部署到 GitHub Pages(Fork 即用,推荐)

1. **Fork 本项目**到你的 GitHub 账号(右上角 Fork 按钮)
2. 仓库 **Settings → Pages → Build and deployment → Source 选 GitHub Actions**
3. 按下表配好 Variables / Secrets(都在 Settings → Secrets and variables → Actions):
4. Actions 页选 "Build & Deploy Calendars" → **Run workflow** 手动跑第一次(此后 push 与每日 09:00 自动构建)

| 类型 | Name | 值 | 必填 |
|---|---|---|---|
| Variable | `CAL_SITE_BASE_URL` | `https://你的用户名.github.io/仓库名` | 推荐 |
| Secret | `CAL_EDITOR_KEY` | `pnpm cal:key` 生成的 UUID 原样 | 用在线编辑器则必填 |
| Variable | `CAL_EDITOR_HINT` | 锁屏提示语 | 可选 |
| Variable | `CAL_SUBSCRIBE_KEY` | 订阅保护密钥(≥8 位) | 可选,**配置即开启保护** |

### 🔐 订阅地址保护(可选开关)

静态托管无法做服务端鉴权,本工具用「能力地址」实现:

- **关闭**(默认):不配置 `CAL_SUBSCRIBE_KEY`,知道订阅地址即可使用;
- **开启**:配置该变量后重新构建,`.ics` 会移入不可猜测的
  `/s/<令牌>/日历名.ics` 路径(根目录不留副本),首页的订阅按钮变为
  🔒 状态——在页面输入密钥后才生成专属链接。密钥只在浏览器本地计算,
  不发送到任何服务器。
- 每个日历的令牌独立派生(`sha256(密钥|日历ID)`),泄露一个日历的链接
  不影响其他日历;轮换密钥 = 改变量重跑构建,iPhone 删除旧订阅重新添加即可。
- iPhone 使用:打开首页 → 输入密钥 → 点生成的「📲 订阅」按钮。

### 自动更新机制

- 国务院通常每年 11~12 月发布次年放假安排 → holiday-cn 当天收录 →
  下一次定时构建自动拉取并重新生成 → 你的 iPhone 订阅**无需任何操作**即可看到新一年安排
- 在公告发布前,未来年份的数据文件是空占位(`days: []`),构建时会明确提示,属正常现象
- 在线编辑器保存、或本地改完 `calendars.yaml` push,都会立即触发重建

## 目录结构

```
ios-cal-sub/
├── calendars.yaml            # ★ 你唯一需要编辑的文件
├── src/
│   ├── types.ts              # zod 配置校验 schema
│   ├── dates.ts              # 日期工具(纯 UTC 语义)
│   ├── ics.ts                # 极简 RFC 5545 ICS 写入器(折行/转义/VTIMEZONE/VALARM/RRULE)
│   ├── sources.ts            # 五类事件源展开(holidays-cn/lunar/solar/rule/solar-term)
│   └── generate.ts           # 主入口:配置 → dist/*.ics + index.html + manifest.json
├── scripts/fetch-holidays.ts # 拉取 holiday-cn 官方数据(带缓存,离线可用)
│   list-terms.ts             # 小工具:列出某年二十四节气的公历日期
├── src/web/
│   ├── server.ts             # 局域网编辑器服务(可选,零框架依赖)
│   └── editor.html           # 局域网单页编辑器
├── src/editor-page.html      # ★ 在线编辑器源模板(构建时生成 editor/yaml-dump.js)
├── src/yaml-dump.ts          # 零依赖 YAML 序列化(Node/浏览器通用,往返已验证)
├── src/keygen.ts             # cal:key:生成访问密钥 UUID + SHA-256
├── verify/verify.ts          # 验证套件(格式/回读/事实抽查/配置↔产物定义级比对)
├── docs/KNOWLEDGE-BASE.md    # 排障结论与设计规约(随手更新)
├── data/holiday-cn/*.json    # 节假日数据缓存(提交入库,保证构建可复现)
├── dist/                     # 生成产物:*.ics + index.html + manifest.json + editor/
└── .github/workflows/deploy.yml
```

## 设计要点(为什么这样做)

- **RRULE 与逐日物化按语义选型**(判定表见 docs/KNOWLEDGE-BASE.md §12):
  周/月/年循环 = 单条 `RRULE:FREQ=...;UNTIL=...`,iPhone 自动展开;
  节气多天序列物化为逐日独立事件——单条 RRULE 的标题无法逐日变化,
  `(n/N)` 进度后缀需要独立事件承载;农历无法用任何 RRULE 表达,必须物化
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
本工具生成的窗口是「当年 1 月 1 日 ~ 今年+N 年年末」(N = `years_ahead`,默认 2),
过去部分用于回顾全年序列。Apple 对超大文件的实测限制未公开,2 年余量足够日常使用。

**Q:订阅的事件到点不响铃 / 事件详情里"提醒"显示"无"?**
iOS 会忽略订阅源文件内的提醒指令(所有 .ics 订阅都一样)。
解决:设置 → 应用 → 日历 → **默认提醒时间** → 「日程」改为「日程开始时」,
详见上文「🔔 让提醒真正响铃」。重要事项也可以点开单条事件手动设提醒(本地保存有效)。

**Q:固定循环日历里怎么只有一条事件?**
周/月/年循环以单条 RFC 5545 RRULE 定义写入,iPhone 自动展开为每次发生——
这是特性不是丢失。少数形态(day>28 的月末钳制、2 月 29 日)会退回逐日展开。

**Q:能加节气/节日(如母亲节"五月的第二个星期日")吗?**
节气锚定用 `solar-term` 源;母亲节这类"第 N 个星期几"规则暂未内置,
可先用近似日期,或欢迎扩展 `rule` 类型。
