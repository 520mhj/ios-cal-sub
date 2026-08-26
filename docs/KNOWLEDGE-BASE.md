# 📚 项目知识库

> 本文档沉淀开发/运维过程中踩过的坑与最终结论,按主题分类。
> 每条格式:**现象 → 根因 → 修复 → 规约**(以后必须怎么做)。
> 新结论请追加到对应章节,保持倒序(最新在上)。

---

## 一、依赖与构建环境

### 1. pnpm v11 拒绝未批准的构建脚本
- **现象**:`pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: esbuild`,本地和 CI 都挂;esbuild 未装 postinstall 导致 tsx 无法运行。
- **根因**:pnpm v11 把「未批准构建脚本」从警告升级为硬错误;旧键 `onlyBuiltDependencies` 在 v11 中**被忽略**。
- **修复**:`pnpm-workspace.yaml` 写新键:
  ```yaml
  allowBuilds:
    esbuild: true
  ```
- **规约**:升级依赖后若 install 报 IGNORED_BUILDS,往 `allowBuilds` 里加对应包名,不要用旧键。

### 2. tsx(esbuild)的 keepNames 会污染函数源码字符串
- **现象**:在线编辑器保存时报 `❌ __name is not defined`。
- **根因**:tsx 默认 `keepNames: true`,编译时在函数体内的辅助函数上注入 `__name(fn,"名")` 调用;用 `fn.toString()` 把函数注入浏览器后,这些调用引用了不存在的辅助 → ReferenceError。之前的验证只检查「注入存在」没「真正执行」,漏网。
- **修复**:序列化器改为独立产物 `dist/editor/yaml-dump.js`,文件头部带垫片 `const __name = (fn) => fn;`;页面用 `<script src>` 引入;验证套件用 `new Function(src + ';return dumpYaml;')()` **真实执行**并与 Node 端输出逐字符比对。
- **规约**:任何要 `toString()` 注入网页的函数——①保持自包含(不引外部变量);②假设编译器会改名/注入辅助,要么垫片兼容,要么读原始文件而非编译产物;③验证必须**执行**注入代码,不能只查存在。

---

## 二、配置与序列化

### 3. 可选字段清空后会序列化出 `key: null`
- **现象**:CI 构建报 `路径 calendars.3.description: Invalid input: expected string, received null`。
- **根因**:编辑器清空描述时代码写 `obj.description = value || undefined` —— 键还在、值是 undefined;自研 YAML 序列化器的 `scalar()` 对 undefined 输出了字面量 `null`;zod 的 `.optional()` 只接受「键不存在」或「字符串」,显式 null 直接拒绝。
- **修复**(三层防御):
  1. 序列化器对象级**跳过** `undefined/null` 值的键;
  2. 新增 `stripNullValues()` 深度清洗,应用在**每一个配置入口**(CLI loadConfig、局域网服务器保存、verify 的 data.json 与 calendars.yaml 读取)→ 历史上已写入的 null 自愈;
  3. 两套编辑器改为规范的 `delete obj.key`。
- **规约**:清空可选字段一律 `delete`;凡是从外部进来的配置树(YAML/JSON/API body),过 zod 前先 `stripNullValues()`。

### 4. schema 数值上限不要拍脑袋
- **现象**:用户把节气「连续展开天数」设为 90,被 `days ≤15` 的上限拒绝,CI 红。
- **根因**:防手滑的上限设得太紧,挡住了合理场景;且在线编辑器提交前没有校验,非法值先进仓库、CI 才发现。
- **修复**:上限放宽(days ≤366、偏移 ±183);Pages 编辑器新增 `validateCfg()` 镜像服务端关键约束,**提交前在浏览器拦截**并列出问题明细;表单 min/max 同步。
- **规约**:①数值边界=产品决策,放宽前想清楚最坏体积(事件数×字节),放宽后同步所有表单与文档;②凡是「浏览器直接提交、CI 兜底校验」的链路,客户端必须先跑一遍镜像校验,否则错误反馈延迟一个 CI 周期。

---

## 三、GitHub Actions / Pages 部署

### 5. Secrets/Variables 只在构建时注入,改了不会自动生效
- **现象**:配好仓库 Variable/Secret 后页面没变化,以为代码没读到。
- **根因**:`vars/secrets` 是运行时注入,修改它们不触发任何工作流。
- **规约**:改完配置必须触发一次新构建——推荐 Actions 页 **Run workflow**(workflow_dispatch);定时任务(每日 09:00 北京时间)也会自动带上最新值。

### 6. 「Re-run all jobs」用的是旧提交的旧工作流定义 ⚠️ 高频坑
- **现象**:重跑了最近一次构建,但新的 env 映射死活不生效。
- **根因**:Re-run 复现**原始那次 run 的 commit**,工作流文件也取自该 commit——对旧 run 重跑拿不到刚推的新 workflow 定义。(Secrets/Variables 的**值**倒是取当前最新的。)
- **规约**:改过 deploy.yml 之后,想让它生效必须 **Run workflow 新起任务或 push 新提交**,别 Re-run 旧 run。

### 7. 配置上移到 Variables/Secrets 的设计不变量
- **映射**:`CAL_SITE_BASE_URL`(Variable)、`CAL_EDITOR_KEY_SHA256`(Secret)、`CAL_EDITOR_HINT`(Variable,可选)。yaml 同名字段仅作本地兜底,env 优先(`resolveConfig()`)。
- **三条不变量**(改动时不可破坏):
  1. **data.json 写「未解析」的原始 yaml 配置** —— 密钥哈希不得出现在任何公开产物;
  2. **auth.json / index.html 用解析后的生效值**(env 优先);
  3. **verify 必须与 build 在同一 env 下跑**(工作流里用 job 级 env,两个 step 都可见),auth.json 与 `resolveConfig(yaml)` 比对。
- **诊断技巧**:工作流里加诊断步骤打印 `[${{ vars.X }}]`(Variable 明文可见);Secret 判断是否设置用 `[ -n "${{ secrets.X }}" ]` 输出 SET/EMPTY(GitHub 会自动打码值)。

---

## 四、在线编辑器的安全模型

### 8. UUID 是钥匙,SHA-256 是锁芯 —— 别填反了
- **现象**:把 UUID 本身填进 Secret,报「不是 64 位十六进制,已忽略该覆盖」。
- **关系**:UUID(36 位连字符)= 用户自存、解锁时输入;SHA-256(UUID)(64 位十六进制)= 放 Secret,构建期写进 auth.json 供比对。
- **规约**:哈希入口统一做归一化(trim + toLowerCase,keygen 与浏览器端一致);换钥匙 = 重新 `pnpm cal:key` → 更新 Secret,**零 git 提交**。

### 9. 两层凭证缺一不可
- UUID 门禁 = 防陌生人**偷看**编辑界面(Pages 纯静态,无服务器会话);
- Fine-grained PAT(单仓库、仅 Contents RW)= **写回仓库**的唯一授权,浏览器经 GitHub Contents API 提交,Token 只存 localStorage。
- 规约:PAT 过期(默认 90 天)表现为保存时报 401/403,重新生成贴入即可;泄露立即 revoke。

### 10. 冲突处理:用户的网页端提交是事实源
- **现象**:本地推送被拒(remote ahead),远端多了若干 `chore(calendars): update via web editor` 提交。
- **规约**:rebase 后 calendars.yaml 冲突**以远端(用户网页版)为准** `git checkout --theirs calendars.yaml`;本地只保留工具链改动。另:`git rebase --continue` 会开交互编辑器卡住超时,脚本化场景用 `$env:GIT_EDITOR='true'`。

---

## 五、验证套件设计

### 11. 验证必须是「内容无关」的
- **现象**:用户把示例标题「处暑晨跑」改名,CI 报 `处暑晨跑展开天数不足:0`。
- **根因**:断言里写死了示例字符串。
- **修复后的结构**(现行 verify.ts):
  - 物理格式(CRLF/75 字节/UID 唯一)+ manifest 计数 —— 通用;
  - 节假日覆盖:动态遍历缓存 JSON 的每个条目查 dist —— 通用;
  - 天文已知事实(农历换算、节气日期 vs 公开资料)—— **唯一允许的字面量**,因为它们测的是纯函数;
  - **配置 ↔ 产物定义级一致性**:从 data.json 读真实配置 → 用生成器同款展开逻辑推导期望定义集 → UID 双向 diff + RRULE 规则体逐条核对 + 首发生日抽查 + VALARM 总数精确相等。
- **规约**:永远不为示例数据写内容断言;用户改任何标题/时间/天数,CI 只回答一个问题——**产物是否忠实于配置**。

---

## 五点五、ICS 重复事件的设计决策(RRULE vs 物化)

### 12. 能用 RRULE 的用 RRULE,不能用的一律物化 —— 判定表

| 数据源 | 方式 | 原因 |
|---|---|---|
| 节气连续场景(days>1) | **物化为逐日事件(最终裁定)** | 曾改每年一条 `RRULE:FREQ=DAILY;COUNT=N`,但单条定义的 SUMMARY 固定,逐日 `(n/N)` 进度后缀消失;用户裁定进度数字优先 → 回退物化。UID 按日期稳定,iPhone 更新不重复 |
| rule 周/月/年循环 | 单条 `FREQ=...;UNTIL=...` | 天然机械重复、标题静态;UNTIL 类型必须与 DTSTART 一致(定时→UTC 日期时间,全天→日期) |
| monthly day>28、yearly 2·29 | **回退物化** | RFC 的 BYMONTHDAY=31 在短月是"跳过"而非"钳到月末",语义不等价;2·29 同理 |
| lunar 农历纪念日 | 物化 | **RFC 5545 没有农历概念**,任何 RRULE 都表达不了;虚岁等逐年变化的描述也需要独立事件承载 |
| solar 公历纪念日 | 物化(保持现状) | 与农历共用展示逻辑;量极小 |
| holidays-cn | 物化 | 数据本身就是逐条公告,一年拉取一次 |

- **核心约束**:RRULE 的 SUMMARY/DESCRIPTION 对所有发生日相同——**"逐日不同的标题"与"单条重复定义"互斥**,选型前先问用户要哪个。

### 13. 生成窗口 = 当年 1 月 1 日起
- 曾用 `[今天−14天, +N年]`,年中订阅的用户看不到年初已过去的节日序列(表现为"事件从年中被截断"),被误判为苹果限制。改为 `[当年1月1日, 当年+N年的12月31]`。**窗口外日期不写入 .ics 是"看不见"的唯一原因——苹果端从不隐藏数据。**

### 14. 苹果忽略订阅源 VALARM —— 用系统「默认提醒时间」兜底
- **现象**:订阅事件详情「提醒:无」,文件内 VALARM(`-P1D`/`-PT1H` 等)被整体忽略;同文件在 Google 日历等标准客户端正常生效。
- **根因**:iOS 把订阅式日历当只读公告栏,导入时丢弃 VALARM;属平台策略,**无法用文件格式绕过**(用户裁定不引入服务器推送方案,见 f82fc94 的 revert)。
- **解法(用户实测有效)**:iPhone 设置 → 应用 → 日历 → 默认提醒时间 → 「日程」改为「日程开始时」(「全天事件」按需另配)。此后所有无本地提醒的订阅事件套用默认策略响铃;定时事件时长固定 30 分钟,触发落在 [开始时刻, 开始+30min] 区间。
- **备选**:单条事件手动设提醒(本地保存,对订阅事件有效);快捷指令自动化把当日事件转提醒事项。
- **规约**:README 必须保留此设置说明;新提醒类需求先确认是否撞上这层平台策略再动手。

### 15. 订阅保护:全局开关 → 按日历公开/私密(capability URL)
- **演进**:第一版是全局 Variable 开关(CAL_SUBSCRIBE_KEY,开=全部日历进 keyed 路径+首页密钥输入框);用户裁定改为**编辑页内按日历切换 公开/私密**,私密链接在编辑页对应日历区域查看复制——管理入口与使用场景更贴合。
- **派生公式**(两端一致的关键):`token = sha256( hex(sha256(UUID)) + '|' + calId ) 前 32 位`。构建端只有 UUID 的哈希(eff.editor_auth.key_sha256),浏览器端从 UUID 先算一次哈希即得到同一材料——**以哈希为公共材料,明文永不过网**。
- **行为**:私密的 `.ics` 写入 `dist/s/<token>/<id>.ics`,根目录不留副本(构建前清空根目录 *.ics 与 /s/,防"公开→私密"切换后旧明文残留泄露);订阅页对私密只显示 🔒 徽标。
- **前置校验**:设了私密但无访问密钥 → 构建直接失败并给出可读指引(fail loud),不静默降级。
- **规约**:新增可见性/保护类功能时,先明确"凭据是什么、谁持有、泄露半径多大";令牌按最小单元(此处按日历)独立派生。

### 16. 节假日数据源决策与呈现(holiday-cn + 内置传统节日)
- **数据源分工**:国务院公告(NateScarlet/holiday-cn)只管「哪天放假/调休补班」;**传统节日的"是哪天"按农历/节气计算,不依赖公告**。教训:2027 公告未发布时 holiday-cn 是空占位,最初内置预设又漏了春节/清明/端午/中秋这四个法定节日 → 用户发现 2027 端午凭空消失。修正后预设含全部 17 个(春节🧨 正月初一、清明节🌸 节气锚定、端午节🐉 五月初五、中秋节🥮 八月十五等),任何年份稳定显示。
- **假期呈现**:连续同名休息日分组;组内解析出"真节日当天"(春节=初一、清明=节气日、端午=初五、中秋=十五,合并黄金周用名称正则集合多解)独立亮出「🌿 清明节」,其余天显示进度「…假期 2/3」;描述带区间与总天数。UID 按日期稳定,刷新原地更新。
- **冬至/清明的节气锚定**:lunar-festival 预设支持 `{term}` 锚定(复用节气表),区别于农历 `{m,d}` 锚定;除夕 `d:'last'` 用 LunarMonth.getDayCount() 判廿九/三十。
- **枚举改名必须带别名**:预设改名(小年→小年北方/南方)后,网页端已保存的旧值会炸 CI 构建(zod enum 校验)。规约:**枚举值收敛进 types.ts 单一事实源 + LUNAR_FESTIVAL_ALIASES 兼容旧名 + 展示名自动升级为规范名(仅当 title 是旧名或同名时)**。

---

## 六、开发环境备注(本机)

- PowerShell 5.1:无 `-SkipHttpErrorCheck`;stderr 易被包成 NativeCommandError(无害,看 exit code)。
- 长命令输出偶发被劫持显示旧文本:用 `cmd /c "... > log 2>&1"` 落盘再 Read;PS5.1 的 `>` 是 UTF-16LE。
- 直接调 `.bin\*.cmd` shim(tsc/tsx)可用;避免 `pnpm exec`(会触发坏的自安装路径)。
- `node_modules` 被锁删不掉时用 `cmd /c "rmdir /s /q node_modules"`。

---

*维护约定:每次排障结束后,把新结论按「现象→根因→修复→规约」追加到对应章节并随代码一起提交。*
