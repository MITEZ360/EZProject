# 开发记录（Dev Log）

> **用途**：按时间顺序记录开发过程——**做了什么、为什么这么做、遇到什么、怎么解决**。
> **与 CHANGELOG 的区别**：这里是"过程与思考"（流水账 + 决策理由），CHANGELOG 是"结果与版本"（对外变更）。
> **写法**：每个开发时段或每个任务追加一条，倒序排列（最新的在最上面）。

---

## 模板

```markdown
## YYYY-MM-DD · 标题

**目标**：这次要达成什么。

**做了什么**：
- ...

**关键决策**：做了哪些决定，为什么。

**遇到的问题 / 解决**：
- 问题 → 解决方式

**遗留 / 下一步**：
- ...
```

---

## 2026-10-11 · 项目启动：方案设计与架构定稿

**目标**：为一个自研无头 CMS 平台确定架构、技术栈与工程规范。

**做了什么**：
- 完成需求澄清、架构设计、技术选型、内容层设计。
- 产出两份核心文档：`docs/design.md`（设计）、`docs/engineering-spec.md`（工程规范）。
- 建立文档体系（README / dev-log / changelog / cookbook）。
- **初始化本地 git 仓库**，完成首次提交（`7d7e0c4`）。
- **确立分支策略**：默认分支由 `master` 更名为 **`main`**，新建长期分支 **`kernel`**（内核唯一演进线）；策略见 `docs/git-workflow.md`。
- **补充 vibe-cookbook**：新增"给 AI 定框架的元方法"章节，精简冗余条目。
- **重构 vibe-cookbook 结构**：分为「通用准则（G）」与「本项目准则（P）」两部分——
  方法论与项目约定分离，通用部分可复用到其他项目。
- **测试策略**：确立分层（日常单测 / 里程碑启动测试 / 发版前集成测试）。

**关键决策（按讨论顺序）**：

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 1 | 架构 | **三层洋葱**（内核/模块/场景）+ 单向依赖 | 实现"一个核心延伸多产品" |
| 2 | Payload 定位 | 曾定为"内核"→ 改为"能力模块"→ **最终完全不用** | 内核必须对场景无知且可拔掉 |
| 3 | 解耦方式 | **抽象 + 策略模式** | 客户明确要求；多数据库等场景需要 |
| 4 | 语言/运行时 | TS + Bun（**兼容 Node**） | 前后端类型共享；Bun 省内存、依赖少 |
| 5 | Go 方案 | **否决** | 本项目本质是"管理复杂度的平台"，非"追求极致性能"；Go 会导致前后端类型断层 |
| 6 | 数据库 | **SQLite 默认**，策略模式支持 PG/MySQL | 部署简单直观；SaaS 时间表未定 |
| 7 | 多数据库 | 一个交付包含全部驱动，配置切换 | 策略模式；非多版本 |
| 8 | 富文本格式 | **严格遵循 Portable Text 规范** | 内容与呈现分离；验证过的设计；公开规范 |
| 9 | 编辑器 | Markdown + 块编辑器双模式，**归一为同一结构** | 兼顾技术与非技术编辑，避免数据分裂 |
| 10 | 内容铁律 | **渲染产物仅作缓存，永不作为数据源** | 吸取早期博客"Markdown→HTML 入库"的教训 |
| 11 | 验证方式 | **不做人工复核 diff，一切交给机器（测试 + 日志 + CI）** | 时间有限；能自动判定的绝不靠人 |
| 12 | 测试分层 | **日常只跑单元测试；启动/集成测试不常用（仅关键节点）** | 慢测试拖垮迭代节奏，要保开发效率 |
| 13 | ID 策略 | **租户短 id（8 字符 base62，不可改）+ 其他实体 UUIDv7 + 租户表映射** | 租户 id 高频出现在 URL/日志，需短可读；v7 时间有序利于索引 |
| 14 | 时间格式 | **统一 epoch 毫秒整数** | 跨方言无时区歧义，排序/索引天然有序 |
| 15 | 软删除 | **`deleted_at` 哨兵值法**（活跃=0）+ 三列复合唯一 | 避免 `NULL` 不等导致重复活跃行的 bug；三方言写法一致 |
| 16 | 存储/发布定位 | **单二进制为"部署方便"，非"极致省空间"**；方便直观 > 抠体积 | 项目定位是"管理复杂度的平台"，不为省空间牺牲可读/可调试性 |
| 17 | 交付理念 | 目标是**"自包含（目标机器零环境依赖）"**；**单二进制只是首选实现，压缩包/容器同样可选** | 不苛求"必须是一个文件"——形式服务于"不用装环境"这一目的 |
| 18 | 分支策略 | **kernel / main 双长期分支** + 前缀式短分支；**`main` 永不直接改 `kernel/`**；内核走 `kernel` 分支并额外把关（短分支用 `core/` 前缀，避开 git ref 冲突） | 内核是"多年不动的稳定层"，物理分线防止产品需求顺手改坏内核 |

**遇到的问题 / 解决**：
- **问题**：最初误将 Payload CMS 当作架构"内核"。
  → **解决**：用"内核必须可拔掉、对场景无知"四条标准检验，Payload 均不满足；改自研薄内核。
- **问题**：内容层设计一度缺失，只有数据模型。
  → **解决**：新增独立章节，把"存什么格式"作为地基级决策提前定死。
- **问题**："兼容 Portable Text"表述模糊。
  → **解决**：改为"严格遵循规范"，消除中间态。
- **问题**：文档里出现"策略表"一词但从未定义。
  → **解决**：在 design.md / engineering-spec / cookbook 三处补充定义并互链。
- **问题**：软删除唯一约束直觉上用 `UNIQUE(tenant_id, slug, deleted_at)`，但 `NULL` 互不相等会导致重复活跃行。
  → **解决**：改用哨兵值法（活跃 `deleted_at=0`），三方言行为一致。
- **问题**：内核与产品若在同一条分支上开发，内核极易被"顺手改坏"。
  → **解决**：新建 `docs/git-workflow.md`——`kernel` 与 `main` 双长期分支，内核改动集中一条线并额外把关。

**经验教训（已记入 cookbook）**：
- 内容系统必须存"中性结构"，不能存渲染产物（HTML）。
- 架构讨论要敢于推翻前一版结论（Payload 从内核→模块→弃用）。
- **`better-sqlite3` 与 Bun 不兼容**：Bun 无法加载该原生模块（`bun --compile` 出的二进制亦不可用），
  Bun 仅可用于 install/build；**运行与测试链必须走 Node**。这印证了"代码兼容 Node"的策略价值。

**遗留 / 下一步**：
- [ ] 搭最小可运行骨架（工程规范第 10 章第 1~4 步）
- [ ] 验证两个架构分水岭：拔掉模块能启动、切方言能生效
- [ ] 实现内容模块 + Portable Text 原语 + Zod 校验
- [ ] React 后台 + React Content/Management API
- [ ] 产出**自包含交付物**（单二进制 / 压缩包，二选一），在干净机器验证

---

## 2026-10-11 · 内核骨架落地（工程规范第 10 章第 1~4 步）

**目标**：把设计/规范落成可运行的骨架，验证两个架构分水岭。

**做了什么**（分支 `core/scaffold`，从 `kernel` 切出）：
- **工程骨架**：tsconfig（strict + 路径别名）、eslint 边界规则、CI 扫描脚本（内核词汇 / 方言分支 / 契约快照）、Makefile、vitest。
- **内核（第 1 步）**：primitives（result / id / entity / principal / portable-text + Zod）、events（types + bus）、contracts（storage / content / module / authz / search）、registry、bootstrap、唯一出口 index。
- **存储策略（第 2 步）**：`columns.ts` 二维策略表、`sqlite.driver.ts`（实现 StorageDriver）、`factory.ts`（唯一选择点）、storageModule。
- **内容模块 + 场景（第 3 步）**：content 模块（写入强制 PT 校验、软删除）、博客场景（数据驱动类型 + 可运行入口）、启动自检日志。
- **交付（第 4 步）**：`make package` 出自包含压缩包，隔离目录解压即跑。

**关键决策**：

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 19 | 运行/测试运行时 | **验证链与运行走 Node；Bun 只做 install/build** | `better-sqlite3` 原生模块在 Bun 下不可用（含编译产物） |
| 20 | 交付形态落地 | **自包含压缩包**（app.mjs + node_modules + 说明），原生模块保持 external | Bun 无法打包原生模块；压缩包解压即用，符合"自包含≠单文件" |
| 21 | 驱动依赖 | 驱动**直连 better-sqlite3**（不引入 Drizzle 运行时） | 契约已 ORM 无关；`drizzle-orm` 仅作多方言预留，避免过度依赖 |

**遇到的问题 / 解决**：
- **问题**：内核词汇扫描把 `const order`（排序义）误判为业务词"订单"。
  → **解决**：高歧义词（order/post/tag）移出黑名单，交给人工与契约快照把关。
- **问题**：`bun --compile` 编译出的二进制运行时报 `Could not find module root` / 找不到 `.node`。
  → **解决**：确认 Bun 不支持原生模块 ⇒ 改走"自包含压缩包 + Node 运行时"；打包时 `--external better-sqlite3`。
- **问题**：工厂里 `builders[dialect];` 空表达式触发 lint。
  → **解决**：改为显式 `IMPLEMENTED` 集合。

**验证结果（机器判定）**：
- `make verify`：typecheck + lint + 内核词汇/方言扫描 + **28 个单测** 全绿。
- `make verify-full`：+ **9 个启动测试**（可拔插/切方言/内容铁律）+ **契约快照一致** + **2 个交付测试**（压缩包隔离运行）。
- 启动日志：`[kernel] 已挂载模块: storage/content` + `[selfcheck] OK`。

**遗留 / 下一步**：
- [ ] 合并 `core/scaffold` → `kernel`（内核把关）→ 再反向同步到 `main`
- [ ] Content API / Management API（HTTP 层，Hono）+ React 后台
- [ ] 按需加 `authz` / `search` 模块
- [ ] 真实 PG/MySQL 驱动（阶段三）

---

## 2026-10-11 · 存储层健壮性修复（分支 `core/fix-storage-robustness`）

**背景**：对首版 SQLite 集成做审查，用探针脚本实测确认了 3 个高危问题 + 若干隐患。结论：**能跑，但属于"契约语义没想清楚就写实现"，不应出现**。

**实测确认的问题**（探针证据）：
1. **事务不可重入**：`BEGIN` 包异步回调的写法，嵌套 `transaction()` 直接报 `cannot start a transaction within a transaction`——模块化组合的必然场景，目前没炸只是因为只有一个模块。
2. **find 计数非原子且全量取回**：`total` 用第二次事务 `find` 全量取回取 `length`，与 `items` 不同视图；5000 行实测 4.4ms + 390KB（`COUNT(*)` 仅 0.3ms）。
3. **`this` 依赖**：`update`/`remove` 用 `this.findOne`，方法被解构即失效。
4. 隐患：`fromRow` JSON 启发式可静默损坏正文；`:memory:` 下 WAL 配置无效（假配置）；方言错误码裸泄漏。

**关键决策**：

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 22 | 事务重入语义 | **进契约**：`transaction()` 可重入（SAVEPOINT 实现），最外层决定提交 | 这是跨方言契约语义，不是实现细节；不定死则每个驱动各发明一套 |
| 23 | JSON 列解析 | **废除启发式**，驱动内 `TABLE_SCHEMAS.jsonColumns` 显式声明；声明列解析失败即炸 | 启发式会静默改变正文数据；显式声明才符合"方便直观、可控"的项目定位 |
| 24 | 驱动错误边界 | 驱动层收敛为 `StorageError(E_CONFLICT/E_STORAGE)`，方言错误码进 `details` | 宪法一：上层不应知道 SQLite；PG/MySQL 接入时错误语义已就位 |

**改动清单**：
- `kernel/contracts/storage.contract.ts`：文件头事务语义四条 + `StorageTx.count()`（契约快照已更新）
- `modules/storage/drivers/sqlite.driver.ts`：事务深度计数 + SAVEPOINT 重入；`StorageError` 收敛；类型化 `toRow`/`fromRow`；`:memory:` 跳过 WAL；`count` 实现；未声明表结构直接报错
- `modules/content/internal/service.ts`：`find` 单事务内 find+count；`svc` 闭包自引用替代 `this`
- 测试：新增 6 个单测（重入×3 / 错误收敛 / count / 表结构声明）+ 2 个启动回归（解构安全 / total 同视图）

**验证结果（机器判定）**：
- `make verify`：34 个单测全绿；启动测试 11 个全绿；契约快照 / 内核词汇 / 方言分支三扫描通过。

**遗留 / 下一步**：
- [ ] 合并 `core/fix-storage-robustness` → `kernel` → 反向同步 `main`
- [ ] Content API / Management API（HTTP 层，Hono）+ React 后台

---
## 2026-10-11 · 决策 #25：运行时作为策略表第二维度（规划，排期 HTTP 层后）

**背景**：讨论"Bun 集成 SQLite 的问题"时提出——对无法自动兼容的场景（better-sqlite3 原生模块在 Bun 下不可加载），可否用平台相关组件（`bun:sqlite`）并在打包时按目标自动集成。

**决策**：**方向采纳，排期 HTTP 层之后**。

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 25 | 运行时维度策略化 | SQLite 驱动按运行时分两份（Node=better-sqlite3 / Bun=bun:sqlite），工厂按目标运行时选择，打包时自动集成 | 契约对运行时无知，架构零阻力；Bun 侧解锁 `bun --compile` 真单二进制（bun:sqlite 内置、零原生模块），比 Node 压缩包更彻底地达成"自包含" |

**不现在做的原因**：当前压缩包交付已满足"零环境依赖"，Bun 单二进制是优化不是缺口；HTTP 层会确定真实部署形态，届时再决定是否维护 Bun 交付线。

**届时配套**（已写入 design 8.1）：`drivers/node/`+`drivers/bun/`+`shared/` 目录规划、CI 扫描窄豁免、bun:sqlite 动态加载隔离、同一契约测试×两驱动、`package-node`/`package-bun` 双打包线。

---
## 2026-10-11 · HTTP 层落地（分支 `module/http-api`）

**目标**：阶段一收尾——Content API + Management API（设计文档 2.4 的双层 API），内核零改动。

**做了什么**：
- **`modules/http`**（新模块，`dependsOn: ['content']`，经注册表按契约取 ContentService）：
  - **Content API**（`/api/v1/*`）：只读、匿名、`Cache-Control: public, max-age=60`（可进 CDN）；
    默认只出 `published`，`?status=all` 供预览类消费方；列表分页 + 按 slug/id 取单篇。
  - **Management API**（`/api/manage/v1/*`）：POST/PUT/DELETE，守卫中间件解析主体（401 拒绝）。
  - **鉴权守卫做成策略**（`RequestGuard`）：默认 `bearerTokenGuard`（MANAGE_TOKEN）；
    authz 模块落地后由场景注入新守卫，HTTP 模块不改——策略模式第三处落地。
  - **错误映射**：服务层 `E_*` 错误码 → HTTP 状态码（400/404/409），方言/内部细节不外漏。
- **博客场景**：`createBlogApp` 支持 `http` 配置；`main.ts` 经 `@hono/node-server` 起服务
  （Node 兼容运行时），`--selfcheck` 参数支持装配自检后退出（交付测试用）。
- **依赖**：新增 `hono` + `@hono/node-server`（模块层允许依赖 HTTP 框架；内核仍零依赖）。

**遇到的问题 / 解决**：
- **问题**：交付测试 `node app.mjs` 超时——main.ts 起服务后常驻不退出。
  → **解决**：入口支持 `--selfcheck`（自检即退），交付测试改用；常驻模式才是真实运行形态。

**验证结果（机器判定）**：
- 全套测试 **58/58**（新增 HTTP 11 个：Content 只读/缓存头/404/预览、Management 401/201/PUT/DELETE/铁律 400/非法 JSON、可拔插×2）。
- `make verify-full` 全绿（含交付测试）。
- **真实冒烟（Node 起 dist/app.mjs + curl）8/8**：健康检查、401、创建、匿名读、slug 读、缓存头、HTML 拒绝 400、draft 不可见。
- 内核零改动（无契约快照变化）；边界扫描全过。

**遗留 / 下一步**：
- [x] 合并 `module/http-api` → `main`
- [ ] React 后台（列表 + 编辑，消费 Management API）
- [ ] authz 模块（RBAC，替换 Bearer Token 守卫）
- [ ] 字段裁剪 / API 版本化 / 限流（阶段二）

---
## 2026-10-11 · React 后台落地（分支 `scenario/blog-admin`）

**目标**：阶段一最后一块——React + Vite + Ant Design 5 管理后台，消费 Management API。

**做了什么**：
- **`scenarios/blog/admin`**：React 19 + antd 6 + Vite；无路由库（状态切视图，最小依赖）。
  - **Token 登录门**：MANAGE_TOKEN 存 localStorage；
  - **文章列表**：Table（标题/slug/状态/更新时间），`GET /api/v1/posts?status=all`；
  - **编辑/新建**：Form（title/slug/status）+ Markdown textarea——保存时经
    `markdownToPt()` 归一为 Portable Text（**铁律不破：入库永远是 PT 结构**）；
    编辑回填经 `ptToMarkdown()` 反向转换；
- **`modules/http` 扩展**：`staticDir` 选项——Hono 托管后台静态资源 + SPA 兜底到 index.html；
  **边界守死**：未匹配的 `/api/*` 路径回 404 JSON，绝不被 SPA 兜底吞掉（新增回归测试锁定）。
- **Makefile**：`build-admin`（tsc admin 配置 + vite build → dist/admin）；`package` 打包时携带
  `dist/admin`（解压即得完整"API + 后台"自包含包）。
- **双 tsconfig**：根（后端，strict + node types）/ `tsconfig.admin.json`（JSX + DOM），互不污染。

**遇到的问题 / 解决**：
- **问题**：SPA 兜底中间件把未匹配的 API 路径也返回了 index.html（200）。
  → **解决**：兜底前加守卫——`/api/*` 与 `/healthz` 未匹配时直接 404 JSON；补回归测试。
- **问题**：Vite `outDir` 相对路径按 4 级上跳算出了项目根之外。
  → **解决**：修正为 `../../../dist/admin`；冒烟时以 `ls` 验证产物位置。

**验证结果（机器判定）**：
- 全套测试 **65/65**（新增 PT 归一/往返 6 个 + SPA 边界 1 个）。
- 端到端冒烟：`/admin` 返回后台 HTML、静态资源 200、SPA 深路由兜底 200、
  `/api/unknown` → 404 JSON、`/api/manage/v1/*` 未带凭证 401、管理 API 建文 201。

**遗留 / 下一步**：
- [x] 合并 `scenario/blog-admin` → `main`
- [ ] 块编辑器（Portable Text 可视化编辑，阶段二；当前 Markdown 模式够用）
- [ ] authz 模块（RBAC）替换 Bearer Token 守卫

---

## 2026-10-11 · 修正：PT 归一逻辑归位模块层（分支 `fix/pt-normalize-location`）

**背景**：用户复核指出——`markdownToPt`/`ptToMarkdown` 放在 `scenarios/blog/admin/src/lib/` 位置错误；
engineering-spec 4.2 本就规定编辑器双模式归一在 `modules/content/editor/normalize.ts`（模块层共享）。
场景层私有化会让其他场景后台（知识中台/SaaS）无法复用。

**修正**：
- `git mv` 至 `modules/content/editor/normalize.ts`（git 识别为 rename，历史保留）
- admin 经 `@modules/...` 别名调用：Vite `resolve.alias` + `tsconfig.admin.json paths` 打通
- 测试 import 同步更新（用例不变，6 个全过）

**澄清**（"是否违反不做端侧渲染"）：不违反。归一是**输入数据形态转换**（Markdown 文本 → PT 结构），
浏览器内无任何 HTML 渲染；铁律"存结构不存 HTML、渲染产物仅作缓存"未破。

**验证**：65/65 全绿；双 tsconfig 类型检查过；vite build 正常；全仓 lint 过。

---

## 2026-10-11 · 决策 #26：内容字段类型集定稿（讨论产出，未实现）

**背景**：明确产品愿景——平台既能组装"通用 CMS"（适用多业务，有舍有得），也能组装"专用 CMS"（如博客）；
通用 CMS 要求**动态数据 schema**。讨论确认：与 Strapi 同构 = "封闭原子类型集 + 动态组合"；
存储走**逻辑 Schema**（类型定义是数据，不跑 DDL）——对文件存储同样成立，是混合存储愿景的技术前提。

**决策**（engineering-spec 4.2.1 / design 6.7）：
- 调色板 11 种：text / longText / number / boolean / date / select / richText(PT) / component(递归≤3) / relation / media / json
- 通用选项：required / default / pattern / min / max
- 明示取舍：字段级唯一=软校验（强唯一走顶层 slug 物理索引）；多语言=实体级 locale 列
- **查询效率三层保障**：顶层物理列优先 → JSON 字段等值/范围/包含查询（策略表落方言）→ 物化字段后手（`materialized`，写入双写，通用默认关、专用按需开）

**实现顺序**（未开工）：字段类型集（Zod 校验器扩展）→ defineType 落库 → 类型 CRUD API → 后台类型编辑器 → JSON 查询契约扩展（core/ 分支）。

---

## 2026-10-11 · 字段类型集 v1 落地（分支 `core/field-type-palette`，决策 #26 第一步）

**做了什么**：
- **内核契约演进**（快照已更新，走 core/ 分支把关）：
  - `FieldType` 定稿 11 种（text/longText/number/boolean/date/select/richText/component/relation/media/json）
  - `FieldDef` 扩展通用选项：default/pattern/min/max/integer/dateOnly/multiple/options/repeatable/targetType；`materialized` 占位（物化字段后手）
  - 旧名依定稿更名：`relationTo`→`targetType`、`many`→`multiple`（无使用点，干净替换）
- **校验器全类型实现**（modules/content/internal/validate.ts）：
  - 每类型独立校验；`pattern` 优先于 range；`dateOnly` 强制 UTC 零点毫秒
  - `component` 递归校验子字段，**深度 ≤3**；子对象多余键同样拒绝
  - **未知字段拒绝**（拼错字段名写入时即暴露），保留键 `status`/`slug` 白名单放行（映射顶层物理列）
- **测试**：+14 调色板单测（每类型 + 递归 + 未知字段 + 保留键）

**分支说明**：本分支从 `kernel` 切出，故不含 main 上的 HTTP/admin 代码（main→kernel 禁止）；
合并后 main 全套 79/79 全绿，契约快照一致。

**遗留（#26 后续实现顺序）**：
- [ ] `defineType` 落库（content_types 表已预留）
- [ ] 类型 CRUD Management API
- [ ] 后台类型编辑器
- [ ] JSON 字段查询契约扩展（QuerySpec，走 core/ 分支）

---

## 2026-10-11 · defineType 落库 + 类型管理 API（分支 `feature/content-types-persist`，决策 #26 第二步）

**做了什么**：
- **契约演进**（`core/define-type-contract` → kernel → main）：`defineType(def, actor)` + 新增 `listTypes(tenantId)` / `getType(slug, tenantId)`
- **服务层**：类型定义落 `content_types`（upsert，不迁移旧数据——逻辑 Schema）；类型解析经驱动读库（精确租户 → `'*'` 通配）；`validateTypeDef` 校验定义本身（slug 格式/字段名/保留键/select options/component 深度）
- **contentModule**：内建类型以 `systemPrincipal('*')` 种子落库（幂等）——类型定义从"内存 Map"变"数据"
- **HTTP**：`POST/GET /api/manage/v1/types`（注册在 `/:type` 通配路由之前，防吞）
- **重要修正**：`blogTypes` 的 `slug` 字段声明移除——`slug`/`status` 是保留键（顶层物理列），不是 data 字段（校验器正确拦截了这一点，纪律生效）
- **驱动修复（并发缺陷）**：`Promise.all` 并发发起两个事务在单连接上交错污染（实测 `no such savepoint`）→ 事务**排队互斥**（外层串行、嵌套放行防死锁）

**验证**：全套 **86/86**（新增 7 个类型落库测试，含**跨重启持久化**）；tsc/lint/边界扫描全绿。

**遗留（#26 后续）**：
- [ ] 后台类型编辑器 UI
- [ ] JSON 字段查询契约扩展（QuerySpec，走 core/ 分支）
- [ ] 通用管理模块路线（已定：authz / audit(事件总线) / settings 服务能力 + 通用 admin 壳）

---

## 2026-10-11 · 后台类型编辑器 UI（分支 `feature/admin-type-editor`，决策 #26 第三步）

**做了什么**：
- blog admin 新增"**类型管理**"视图（侧边栏切换）：
  - 类型列表（slug + 字段标签，含类型中文名）
  - 新建/编辑表单：slug 输入（编辑态锁定）、**字段动态增删**、11 种调色板下拉、必填开关、select 选项编辑
  - 界面明示"更新定义不迁移旧数据"（逻辑 Schema 语义）
- 类型定义直接 **import 内核原语**（`@kernel/primitives/entity.js`）——单一事实来源，不复制（吸取上次复核教训）
- 依赖：`@ant-design/icons`

**验证**：
- admin 双检查（tsc admin 配置 + eslint）过；vite build 过；全套 86/86
- 端到端冒烟 5/5：`/admin` 200、API 动态定义 `products` 类型（含 number/select多选/media 字段）、
  用新类型建条目 201、违反枚举 400、类型列表含动态+内建类型

**遗留（#26 后续）**：
- [ ] component 字段的可视化编辑（当前 UI 支持扁平字段；嵌套结构走 API 定义）
- [ ] JSON 字段查询契约扩展（QuerySpec，走 core/ 分支）
- [ ] 通用管理模块（authz / audit / settings + 通用 admin 壳）

---

## 2026-10-11 · 管理端归位：blog admin → 通用 CMS admin（分支 `feature/generic-admin`）

**背景**：用户复核指出架构偏差——通用管理能力（登录壳/类型管理/内容编辑）不该放在
`scenarios/blog/admin`；按既定决策（"通用 admin 壳 + 模块贡献页面"）与自查原则
（"两个场景都会用的能力不进场景目录"），博客这类具体场景应该最后做、复用通用件。

**重构**：
- `scenarios/blog/admin` → **`scenarios/generic-cms/admin`**（git mv，历史保留）
- **App 壳通用化**：登录门 + 菜单（内容/类型管理），零业务词汇；未来 authz/audit/settings 页面在此壳下扩展
- **内容视图动态化**：选类型 → 列表列按类型定义前 3 个字段生成 → 编辑表单**按调色板逐类型渲染控件**
  （text/longText/number/boolean/date(DatePicker→epoch ms)/select(单多选)/richText(Markdown 归一)/
  relation/media(ID)/json/component(JSON 文本)）——**零写死字段**
- API 客户端通用化：`listEntries(type)` 等，类型只是路径参数
- 构建配置同步（vite root / 双 tsconfig include/exclude）；博客场景保留 posts 类型种子，复用本壳

**验证**：
- 双 tsc + eslint + vite build + 全套 86/86 全绿
- 冒烟：同一 admin 下动态定义 `products`（date/boolean 字段）与内建 `posts` 各建条目成功，类型列表两者齐现——
  证明壳确实类型无关

**沉淀**：通用能力归位模块层/通用场景；具体场景 = 类型种子 + 前台展示（待做）+ 场景特有配置。

---

## 2026-10-11 · 通用管理模块 + JSON 字段查询（分支 `feature/generic-admin-modules`）

**做了什么**（决策 #26 第四步 + 通用管理模块首批）：
- **存储契约 v2**（`core/storage-contract-v2` → kernel → main）：
  - `QueryFilter`：eq/ne/gt/gte/lt/lte/in/contains，字段支持点路径（`data.price`）——决策 #26 的 JSON 查询承诺兑现
  - `StorageTx.exec`：仅限模块私有表 DDL；`StorageDriver.registerTable`：私有表结构登记（防拼错表名防护保留）
- **content 发布领域事件**：`content.entry.created/updated/deleted`（宪法三启用）；`remove` 补齐一直缺失的 `actor` 参数
- **modules/audit**：订阅事件落私有表 audit_logs（**宪法三正用**：只听事件、不知道 content）；排序 occurredAt + UUIDv7 次级（同毫秒稳定）
- **modules/settings**：per-tenant KV（值任意 JSON），upsert，键格式校验
- **HTTP 惰性解析**：`/api/manage/v1/audit-logs` 与 `/settings` 路由恒挂载、请求时从注册表解析能力——模块加载顺序无关，未挂载返回 404 JSON
- **JSON 列序列化修正**：字符串值也 stringify（否则读回解析炸）

**过程中发现的架构缺口与修正**：
- HTTP 最初在 setup 时快照 audit/settings → 模块顺序依赖（audit 排在 http 后就失效）→ 改惰性解析
- 驱动 `TABLE_SCHEMAS` 白名单挡住了模块私有表 → registerTable 契约
- **纪律修正**：core 分支误提交了模块实现 → 已从 kernel 分支移除（kernel 只装 kernel/ 目录）

**验证**：全套 **98/98**（新增 filters 5 + admin-modules 7）；三扫描全绿。

**遗留**：
- [ ] authz 模块（用户/权限/登录态）——涉及 token/session 设计，单独讨论后做
- [ ] JSON 查询的 API 层透出（Content API query 参数 → QueryFilter）
- [ ] 后台"审计日志/系统设置"页面（消费新端点）

---
