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

## 2026-10-11 · Content API 过滤 + 通用 CMS 场景 + 后台审计/设置页（分支 `feature/api-filters`）

**做了什么**：
- **契约**（`core/content-query-filters` → kernel → main）：`ContentQuery.filters?: QueryFilter[]`；服务层 find 与 count 用**同一套 filters**
- **HTTP 过滤查询**（决策 #26 查询承诺透出到 API）：
  - `?filter[字段][操作]=值`（eq/ne/gt/gte/lt/lte/in/contains），值类型推断（数字/布尔/逗号数组）
  - **非保留字段自动落 `data.*`**——对外不暴露存储形状（`filter[price][gte]=50` 而非 `filter[data.price]`）
  - 非法字段路径/操作符 → 400（不静默忽略）
- **`scenarios/generic-cms` 场景**（通用 CMS 主产品形态）：
  - 装配 storage + content（**无内建类型**）+ http + audit + settings
  - `main.ts` 入口（--selfcheck 支持）；**Makefile 交付物从 blog 切到 generic-cms**
- **后台两页**：审计日志（事件筛选）、系统设置（KV 编辑，值任意 JSON）
  - 模块未挂载时明确提示（404 → "审计模块未挂载"），不静默空白

**关键修正（测试逼出来的）**：
- **UUIDv7 同毫秒单调**（`core/uuidv7-monotonic`）：原实现同毫秒尾部随机 → 按 id 排序不稳定（审计测试偶发失败）；
  改为 48位时间戳 + **12位同毫秒序号** + 62位随机；补 200 个 id 排序稳定性测试
- 冒烟手法纠正：URL 中 `[` `]` 需转义（%5B/%5D），否则 curl 通配展开导致假失败

**验证**：全套 **104/104**；端到端冒烟 9/9（定义类型→建条目→范围过滤→数组包含→非法 400→审计→设置→后台页）。

**遗留**：
- [ ] authz 模块（用户/权限/登录态，涉及 token/session 设计——需先讨论）
- [ ] blog 场景保留为"专用 CMS 示例"（前台展示待做）

---

## 2026-10-11 · authz 模块：JWT + RBAC + scope（分支 `feature/authz-module`，按最佳实践）

**设计定稿**（写入契约 `core/authz-identity-contracts`）：
- **登录态**：JWT 访问令牌（短时效，HMAC-SHA256，零依赖自实现）+ **刷新令牌**（随机串、只存哈希、**每次刷新轮换**、可撤销）
  —— 纯无状态 JWT 无法登出，刷新令牌落库是标准解法
- **权限**：RBAC（用户→角色→权限点 `resource:action`，支持 `*` 通配）+ **scope**（`deniedFields` 字段级拒绝）
- **引导**：`MANAGE_TOKEN` 降级为**引导令牌**（kind=bootstrap，仅用于 `/auth/bootstrap` 创建首个管理员）
- **认证与授权分离**：identity.contract 与 authz.contract 两套契约、两个服务

**实现要点（安全细节）**：
- 口令：scrypt + 随机盐 + **恒定时间比较**；登录失败**不区分**"用户不存在/密码错"（防枚举）且不存在用户也走一次哈希（防时序侧信道）
- 刷新令牌**重放检测**：已撤销的 refresh 再次使用 → **撤销该用户全部会话**（泄漏响应策略）
- 改密码 / 禁用账号 → 撤销该用户全部刷新令牌
- 内置 admin 角色（`resource:'*'`, `actions:['*']`）不可删除
- 守卫链：JWT 优先 → 引导令牌 → 场景自定义守卫；公开路径（login/refresh/logout）豁免
- 写操作经 `AuthzService.can()` 判定；`deniedFields` 在写入前**剥离**（scope 生效）

**过程中修掉的问题**：
- **驱动缺陷**：布尔值落库未按契约 6.5 转 INTEGER（`builtin: true` 直接绑定报错）→ `toRow` 统一转换
- **路由顺序**：`/roles`、`/users/:id` 等被 `/:type` 通配吞掉 → 固定路径路由统一前置（第三次踩同类坑，已注释警示）
- **测试暴露**：authz 上场后原"allowAllGuard"主体无角色 → 写操作 403（**鉴权按设计生效**）；测试改为播种 admin 角色

**验证**：全套 **113/113**；冒烟 **12/12**（无凭证 401 → 引导 201 → 登录 JWT → 类型/写入 → 受限角色 403 → 刷新轮换 → 重放 401 → 审计 → 后台）。

**遗留**：
- [ ] 后台用户/角色管理页面（服务端已就绪）
- [ ] blog 场景前台展示（专用场景示例）

---

## 2026-10-11 · 阶段二收尾 + 博客前台 + 后台管理页（分支 `feature/phase2-media-cache`）

**三块内容一次做完**：

**③ 阶段二能力**
- **媒体**：内核 `asset.contract`（AssetStore 策略）+ `modules/media`（**local 文件系统策略**已实现，s3 预留）；
  文件落 `<root>/<tenantId>/<id>`、元信息落私有表；**防路径穿越**（id/tenantId 白名单正则）；
  Content API 提供公开下载（`immutable` 长缓存）；内容只存 asset id（铁律）
- **缓存**：内核 `cache.contract`（CacheProvider 策略）+ `modules/cache`（memory / none 已实现，redis 预留）；
  Content API 读路径接入（命中回 `x-cache: HIT`），**写操作事件驱动失效**（内容变更 → `invalidate('content:<tenant>')`）
- **多语言回退**：实体级 locale，`find` 在指定 locale 无结果时**回退 default**（有 zh 版本则优先 zh）

**② 博客前台（专用场景展示层）**
- `modules/content/render/pt-to-html.ts`：PT → HTML 渲染器（模块层通用工具，纯函数）；
  覆盖 h1-h3 / 引用 / 无序列表 / strong·em·code·link；**全量 HTML 转义**（XSS 测试通过）
- `scenarios/blog/front`：SSR 页面（首页列表 + 文章详情），**每次请求从结构再生**——渲染产物不落库的铁律在展示层兑现
- `Makefile build-blog`：产出 `dist/blog.mjs`（= 前台 + API + 后台，一份交付物三种消费方式）

**① 后台管理页**
- **用户管理**：列表/新建/改角色/重置密码/禁用（禁用与改密提示"会话已撤销"）
- **角色权限**：权限点编辑（资源 × 动作 × 字段级 scope），内置角色不可改
- **媒体上传**：media 字段旁直接上传，自动回填 asset id
- 后台现共 **7 个视图**：内容 / 类型 / 审计 / 用户 / 角色 / 设置 / 登录

**验证**：
- 全套 **127/127**（新增 pt-to-html 5、phase2 6、blog-front 3）
- 冒烟（`dist/blog.mjs` 单进程）：前台首页 200 → 引导 201 → 上传媒体 → 发文（含 media 引用 + PT）201 →
  **前台列表/详情渲染正确** → 缓存 MISS→HIT → 审计/设置/用户/角色/类型/资产 端点全 200 → 后台 200

**过程中的两次"设计正确性"验证**：未知字段 `cover` 被拒（类型系统生效）、博客后台缺 audit/settings（已补齐装配）。

---

## 2026-10-11 · 内存缓存改有界 LRU（分支 `feature/cache-lru`）

**背景**：复核缓存模块发现原 memory 策略是**无上限 `Map`**——且 Content API 的缓存 key 含
**完整 query string**（`content:${tenantId}:${path}?${search}`），key 基数不受调用方约束：
爬虫用 `?offset=N`、`?filter[x][eq]=任意值` 即可产生无限 key，**直接撑爆进程内存（可被外部触发的 DoS）**。

**改动**（纯模块层，`CacheProvider` 契约零改动，内核不动）：
- `createMemoryCache({ maxEntries?, maxBytes? })`：**条数上限**（默认 1000）+ **近似字节上限**
  （默认 8 MiB，按 JSON 序列化长度估算）
- LRU 借 `Map` 插入序实现（头=最旧、尾=最新）：`get` 命中移到尾部（保鲜）；`set` 超限从头部淘汰
- **不做过期全表清扫**：条目 set 后若无 get 会随新写入自然漂向头部，过期者天然排在淘汰序列最前
  ——纯 LRU 已覆盖，避免热路径 O(n)（这是本轮的实现自纠：初版在容量压力下每次 set 都全表扫）
- 覆盖写先扣旧占用（不重复计容）；无法序列化的值按 0 计（不拒绝写入）；
  单条超字节上限则被淘汰（不缓存超大对象）

**为什么不是别的组件**（讨论结论）：单机不引入独立服务（排除 Redis）；嵌入式 KV（LMDB/LevelDB）
是**原生模块**，会重蹈 Bun 加载问题（cookbook P3.3）；SQLite 持久层（L2）留作后手——
当前单机低流量下 L1 已消除最严重的、可被外部触发的那一类风险。

**验证**：
- 单测 **+12**：LRU 保鲜 / 条数上限 / 字节上限 / TTL / 前缀失效 / 覆盖写 / 10 万 key 压力 + 窗口边界
- 全套 **138/138**；tsc / lint / 三扫描全绿
- 真实冒烟：缓存 MISS→HIT 正常；**3000 个不同 query 后 RSS 仅 +4KB**（有界生效，服务健康）

**遗留**：
- [ ] L2 持久层（SQLite 缓存表，抗重启雪崩 + 单机多 worker 共享）——按需再上
- [ ] Redis 策略（阶段三 / 多服务器场景）

---

## 2026-10-11 · 接入 CI + 依赖卫生（分支 `chore/ci-pipeline`）

**背景**：design 第 10 章列了 5 类风险（抽象泄漏 / 模块耦合 / 内核污染 / Bun 独有 API / 内容铁律），
规避方式全写着"CI 扫描"——4 个 `scripts/check-*.mjs` 也早就写好了，但**仓库里没有任何 CI 配置**，
只能靠人记得手动 `make verify`。本轮补上，兑现"机器把关"。

**做了什么**：
- **`.github/workflows/ci.yml`**，两档（呼应 cookbook 测试分层）：
  - `verify`（每次 push/PR）：双 tsconfig 类型检查 + eslint + 内核词汇 + 方言分支 + **契约快照** + 单测
  - `full`（needs verify）：加启动测试、交付测试（压缩包隔离运行）、构建产物 + artifact 上传
  - 运行时一律 Node（better-sqlite3 原生模块），Bun 仅用于安装与构建；含原生模块自检步骤
- **Makefile**：`typecheck` 覆盖双 tsconfig（原来只查后端，admin 漏检）；
  **契约快照挪进 `lint`**（原来只在 verify-full，日常不查——内核把关不该等到里程碑）；verify-full 去重
- **依赖卫生**：
  - `better-sqlite3`：devDependencies → **dependencies**（运行时依赖；原位置在 `npm ci --omit=dev` 场景会崩）
  - 移除 **dead dependency `drizzle-orm`**（代码从未引用，只在注释里提到过）
  - react/antd/dayjs/@ant-design/icons → devDependencies（构建期依赖，经 Vite 打进 dist/admin）

**CI 一接上就抓出的历史违规**（证明"靠人工跑会漏"）：
1. **术语污染**：`modules/cache`、`modules/media` 用 `dialect` 命名各自的策略选择——
   但"方言"在本项目专指**数据库方言**（`storage.Dialect`）。已改名 `provider`，
   并借机改为**策略表驱动**（与 `storage/factory.ts` 同构），消灭了模块内的 if/else 分支。
2. **扫描器有洞**：`check-no-dialect.mjs` 只匹配 `dialect ===`，**漏了 `!==`**——
   `modules/media` 的 `dialect !== 'local'` 因此长期逃过检测。已补齐 `!==` / `!=`。

**验证**：`make verify-full` 全绿（81 单测 + 启动测试 + 交付测试/压缩包隔离运行）；YAML 解析通过。

**遗留**：
- [ ] 契约层 `AssetDialect` 同样属术语污染（改走 `core/` 分支）
- [ ] CI 未接自动发布（tag → release artifact）——需要时再加

---

## 2026-10-11 · 阶段二收尾：内容预览门 + 限流（分支 `feature/preview-ratelimit`）

**① 内容预览（同时修掉一个真实安全缺口）**

复核发现 Content API 的草稿保护**完全没有**，且不止一处：
1. 列表 `?status=all` / `?status=draft` → 匿名即可读全部草稿
2. 详情按 slug `?status=draft` → 匿名可读草稿
3. **详情按 UUID 时 `findOne` 完全不过滤 status** —— 拿到 id 就等于拿到草稿（最严重）

**修法**：Content API 加"预览门"——公开只读**仅限 published**，其余一律要凭证
（JWT 或引导令牌）。两条附带约束都不能省：
- 预览响应 `private, no-store`（不进 CDN）
- 预览读取**绕过共享缓存**（不读不写）——否则草稿会经缓存泄漏给匿名请求
- 详情取到非 published 且无凭证 → **404**（不泄漏"此处有草稿"）

**② 限流（design 阶段二明列，此前缺失）**

- `modules/http/internal/rate-limit.ts`：**内存固定窗口**策略（纯模块层，内核无需新契约）
- **有界**：桶由客户端 IP 决定 → 设 maxKeys + 过期清扫 + 最旧淘汰
  （吸取缓存那个无界 Map 的教训，限流器自己不能成为攻击面）
- 只作用于匿名可及的高危入口：`/api/v1/*`（默认 120/窗口）与登录端点（默认 10/窗口，防爆破）；
  静态资源与 `/healthz` 不限；被拒返回 429 + `Retry-After`
- 维度键：`X-Forwarded-For` 首段（代理后）→ `X-Real-IP` → `'local'`（直连时退化为全局额度）
- 可通过 `http.rateLimit: { enabled: false }` 关闭（入口支持 `RATE_LIMIT_DISABLED=1`）

**验证**：
- 单测/启动测试：**148**（新增 `http-hardening` 9 个：预览门 5 + 限流 4）；lint / tsc / 三扫描全绿
- 端到端冒烟（`dist/blog.mjs`）：
  - 匿名 `status=all`/`status=draft` → 403；按 slug / **按 UUID** 取草稿 → 404；默认列表只出 published
  - 带凭证 `status=all` → 200 且 `private, no-store`；已发布详情 → `public, max-age=60`
  - 限流：130 次请求 → **120×200 + 10×429**（精确命中）；另一 IP 不受影响；`RATE_LIMIT_DISABLED=1` → 全 200
  - 前台 / 后台 / 健康检查 均 200（无回归）

**文档**：design 阶段一、二清单更新为实际状态。

**遗留**：
- [ ] 字段裁剪（`?fields=`）——阶段一提过，仍未做
- [ ] 预览链接的短时 token（当前用登录凭证预览；分享式预览链接可后补）

---

## 2026-10-11 · search 模块落地（分支 `feature/search-module`，唯一空置契约）

**背景**：`kernel/contracts/search.contract.ts` 从阶段一就定好了，但 `modules/search` 一直不存在——
这是唯一"契约在、实现不在"的缺口。CMS 没有搜索是硬伤。

**关键决策：中文分词（探针实测后定，不靠猜）**

FTS5 默认的 `unicode61` 分词器**对中文基本不可用**——中文没有空格，"整词"即整句。
同一语料实测四方案（搜「你好世界，这是全文搜索测试」）：

| 方案 | 整词 | 2 字子串 | 索引体积 |
|---|---|---|---|
| unicode61（默认原文） | ✅ | ❌ | 720 KB |
| **单字切分** | ✅ | ✅ | **1088 KB（+51%）** |
| 二元切分 | ✅ | ✅ | 1628 KB（+126%） |
| trigram | ✅ | ❌（<3 字符） | — |

**采用单字切分**：中文逐字成 token、英文/数字按词保留、标点作分隔；索引仅增 51% 即换取
"任意中文子串可搜"。查询侧用 **phrase**（token 相邻）而非 AND——否则搜「世界」会命中
「世…界」这类噪声。

**契约扩展**（`core/storage-native-query` → kernel → main）：FTS5 的 `MATCH` 无法用 `QuerySpec`
表达，且原 `exec` 不支持参数绑定（搜索词必须绑参防注入）。故：
- `StorageTx.exec(sql, params?)` —— 支持参数绑定
- `StorageTx.query<T>(sql, params?)` —— 原生查询，**边界写死**：仅限模块私有表，
  且限于 `QuerySpec` 表达不了的方言特性

**实现**：
- `modules/search/internal/tokenize.ts` —— 切分（纯函数，索引与查询共用）
- `modules/search/internal/sqlite-fts.ts` —— FTS5 策略（`search_index` 私有虚拟表；
  `payload` 存文档快照避免 N+1；`bm25()` 排序取负使"分数越大越相关"）
- `modules/search/index.ts` —— 模块入口：订阅 `content.entry.*` 事件做增量索引
  （**事件总线 publish 会 await 订阅者 → 索引与内容写入强一致**）；
  启动时索引为空则自动全量构建（`SEARCH_REINDEX=1` 强制重建）
- HTTP：`GET /api/v1/search?q=&type=&limit=`——**注册在 `/:type` 之前**（否则 'search' 被当类型）；
  可见性沿用预览门：匿名只搜 published，带凭证可搜草稿且 `no-store`

**验证**：
- 测试 **163**（新增 `search.test` 10 + `search-tokenize` 5）；lint / tsc / 三扫描全绿
- 端到端冒烟 10/10：中文子串命中、PT 正文命中、英文命中、不存在词 0 条、
  草稿匿名不可见 / 凭证可见、类型过滤、空查询 400、匿名 `status=all` 403

**已知现象（记录，非缺陷）**：`kernel` 分支上残留阶段一的 `modules/{storage,content,cache}` 陈旧快照
（kernel 分支定位是"内核真相"，不应含模块实现）。已确认合并安全：这些文件在 kernel 侧自上次同步后
未变，三方合并取 main 版本，不会回退。将来若要彻底清理，需连同 main 一起处理，收益不大故暂缓。

**遗留**：
- [ ] 搜索的后台/前台 UI（服务端已就绪，纯 UI）
- [ ] 检索增强：高亮片段、同义词、拼音（当前为子串短语匹配）

---

## 2026-10-11 · 撤回容器交付（用户质疑后的方向修正）

**质疑**：用户问"为什么用到了 docker？"——这是个好问题，答案是**判断失误，已撤回**。

**为什么不该做**：项目定位一直是**单机、零环境依赖、解压即用**（用户原话："目的是不要依赖服务器上
的环境""单服务器不需要额外部署"）。而 Docker 恰恰要求目标机器上**有 Docker 运行时**——
这与定位**直接冲突**，是"用一个更大的环境依赖换一个小的"。

**我做错在哪**：我在盘点缺口时看到 design 8.1 列了 4 种交付形态（单二进制/压缩包/容器/…），
就把"容器没做"当成了缺口。但那是**可选形态清单**，不是必做清单——尤其在与核心定位冲突时该跳过。

**尝试过程中踩到的两个坑**（若将来真要做，可直接复用）：
1. `oven/bun:1-slim` 无编译工具链，`bun install` 编译 better-sqlite3 失败 → 构建阶段应 `--ignore-scripts`
2. **更关键**：原生模块必须在**运行阶段的 Node 版本下**编译，否则 ABI 不匹配
   （"compiled against a different Node.js version"）→ 生产依赖不能在构建阶段装好再拷过去
3. bun 镜像内没有 `npx`（无 npm），要用 `bunx`

**处理**：删除 Dockerfile / .dockerignore，清理构建残留；MEDIA_ROOT 环境变量保留
（它对非容器场景也有用：显式指定媒体目录便于备份迁移）。

**结论**：交付形态维持**自包含压缩包**这一条主线（`make package`），容器交付**不做**。
本轮"交付与运维"改为聚焦：数据备份/导出 + Webhook。

---

## 2026-10-11 · 单机运维：数据备份 + Webhook（分支 `feature/delivery-ops`）

**（容器交付已撤回，见上一条：与"单机零环境依赖"定位冲突。）**

**① 数据备份 / 导出（`scripts/backup.mjs` + `make backup`）**

单机 SQLite 场景下数据备份是刚需。产出 `backups/<时间戳>/`：
- `app.db` —— **DB 一致性快照**，用 `VACUUM INTO` 生成：
  **服务运行中即可安全备份**（事务内完成，不会拷到写了一半的页），比 `cp app.db` 可靠
- `dump.json` —— 全表 JSON（可读、可 diff、可迁移）
- `media/` —— 媒体文件拷贝
- `manifest.json` —— 清单（时间、各表行数、快照大小、跳过的对象）

**② Webhook（`modules/webhook`，事件总线的第二个消费者）**

- 订阅 `content.entry.created/updated/deleted` → POST 到外部 URL
- 目标来源优先级：模块选项 → 环境变量 `WEBHOOK_URL` → 租户设置 `webhook.url`
- **两条纪律**（都写进代码注释）：
  1. **投递失败绝不抛异常**——事件总线的 `publish` 会 await 订阅者，handler 抛错会**连带让内容写入失败**。
     通知不能成为主流程的单点故障（测试专门覆盖：目标 5xx / 不可达时，内容仍写入成功）
  2. 只投递 http/https（防走 `file://` 等协议）

**验证**：
- 测试 **170**（新增 `webhook` 7 个）；lint / tsc / 三扫描全绿
- 备份实测：服务运行中 `make backup` → 快照 128 KB，**打开备份库可查到 entries/assets/content_types**，
  媒体 1 个文件、14 张表 12 行均正常导出

**遗留**：
- [ ] 备份的定时化（可挂 cron：`0 3 * * * cd /app && make backup`）与保留策略（目前不自动清理）
- [ ] 从备份恢复（当前需手工：停服 → 拷 app.db → 启动）

---
