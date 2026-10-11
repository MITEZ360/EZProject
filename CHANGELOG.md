# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **类型说明**：`Added` 新增 · `Changed` 变更 · `Deprecated` 弃用 · `Removed` 移除 · `Fixed` 修复 · `Security` 安全

---

## [Unreleased]

### Changed
- **管理端归位**：`scenarios/blog/admin` → `scenarios/generic-cms/admin`（通用 CMS 管理端）；内容视图按类型定义动态渲染（零写死字段），App 壳零业务词汇；博客场景复用通用 admin、仅保留类型种子

### Added
- **`modules/authz`（身份与权限）**：JWT 访问令牌（HMAC-SHA256，零依赖）+ **可撤销/轮换刷新令牌**（重放触发全量撤销）；RBAC（角色→权限点，`*` 通配）+ scope（字段级 `deniedFields` 剥离）；用户/角色管理；scrypt 口令哈希 + 恒定时间比较
- **HTTP 认证**：`/auth/login|refresh|logout|bootstrap|me`；守卫链 JWT → 引导令牌 → 场景守卫；写操作鉴权（403）
- **admin**：邮箱密码登录 + 令牌自动刷新
- **Content API 过滤查询**：`?filter[字段][操作]=值`（eq/ne/gt/gte/lt/lte/in/contains；非保留字段自动落 `data.*`，对外不暴露存储形状）；`ContentQuery.filters` 契约；find/count 同一套条件
- **`scenarios/generic-cms` 通用 CMS 场景**：storage+content(无内建类型)+http+audit+settings；Makefile 交付物切换至通用 CMS
- **后台**：审计日志页（事件筛选）+ 系统设置页（KV 编辑）
- **通用管理模块首批**：`modules/audit`（订阅领域事件落审计日志，宪法三正用）+ `modules/settings`（per-tenant KV）；content 发布 `content.entry.*` 领域事件；HTTP 新增 `/api/manage/v1/audit-logs` 与 `/settings`（惰性解析，模块加载顺序无关）
- **存储契约 v2**：`QueryFilter`（JSON 字段点路径，eq/ne/gt/gte/lt/lte/in/contains，SQLite json_extract 落地）+ `StorageTx.exec`（模块私有表 DDL）+ `StorageDriver.registerTable`
- **决策 #26 第三步落地**：后台"类型管理"视图——类型列表/新建/编辑（字段动态增删 + 11 种调色板下拉），消费 `/api/manage/v1/types`；类型定义复用内核原语
- **决策 #26 第二步落地**：`defineType` 落库（逻辑 Schema：类型定义是数据，更新不迁移旧数据）+ `listTypes`/`getType` 契约 + 类型管理 API（`POST/GET /api/manage/v1/types`）+ 跨重启持久化验证

### Fixed
- **驱动布尔落库**：按契约 6.5 转 INTEGER（原直接绑定布尔报错）
- **UUIDv7 同毫秒单调递增**：原实现同毫秒尾部随机导致按 id 排序不稳定（审计 tie-break 偶发失败）；改为 48位时间戳+12位同毫秒序号+62位随机
- **SQLite 驱动事务并发缺陷**：单连接上并发 `transaction()` 调用（如 `Promise.all`）交错污染事务（`no such savepoint`）→ 外层调用排队互斥、嵌套调用放行（SAVEPOINT 语义不受影响）
- **决策 #26 第一步落地**：`FieldDef` 契约演进（11 种调色板 + 通用选项）+ 校验器全类型实现（component 递归 ≤3、未知字段拒绝、dateOnly UTC 零点）；契约快照更新（core/field-type-palette → kernel → main）
- **决策 #26（定稿）**：内容字段类型集 v1——11 种调色板（text/longText/number/boolean/date/select/richText/component/relation/media/json）+ 通用选项 + 明示取舍（字段级唯一软校验、实体级多语言）+ 查询效率三层保障（顶层列 / JSON 查询经策略表 / 物化字段后手）；逻辑 Schema 路线（类型定义是数据，不跑 DDL）（engineering-spec 4.2.1 + design 6.7）

## [0.3.0] - 2026-10-11 · React 管理后台

### Added
- **`scenarios/blog/admin`**：React 19 + Ant Design 6 + Vite 管理后台
  - Token 登录门（MANAGE_TOKEN）、文章列表（Table）、新建/编辑（Form + Markdown 输入）
  - Markdown → Portable Text 写入归一（`markdownToPt`）+ 编辑回填（`ptToMarkdown`）——**铁律不破：入库永远是 PT 结构**
- **`modules/http` `staticDir` 选项**：Hono 托管后台静态资源 + SPA 兜底；`/api/*` 未匹配路径回 404 JSON（回归测试锁定）
- **Makefile**：`build-admin` 目标；`package` 自包含包携带后台（解压即得 API + 后台）
- **双 tsconfig**：根（后端）/ `tsconfig.admin.json`（JSX+DOM）

### Changed
- **PT 归一逻辑归位模块层**：`markdownToPt`/`ptToMarkdown` 移至 `modules/content/editor/normalize.ts`（对齐 engineering-spec 4.2），admin 仅调用；Vite/tsconfig 打通 `@modules` 别名

### Verified
- 全套测试 65/65；端到端冒烟：后台页面/静态资源/SPA 兜底/API 404 边界全过

## [0.2.0] - 2026-10-11 · HTTP 层（Content API + Management API）

### Added
- **`modules/http`**：可插拔 HTTP 模块（`dependsOn: ['content']`）
  - Content API `/api/v1/*`：只读、匿名、`Cache-Control: public`（CDN 可缓存）、默认只出 published、分页 + slug/id 取单篇
  - Management API `/api/manage/v1/*`：POST/PUT/DELETE + 守卫中间件（401）
  - **鉴权守卫策略**（`RequestGuard`）：默认 Bearer Token（`MANAGE_TOKEN`），authz 模块落地后可插拔替换
  - 错误码 → HTTP 状态码映射（400/404/409），内部细节不外漏
- **博客场景**：接入 `@hono/node-server` 真实 HTTP 服务（Node 兼容）；`--selfcheck` 自检即退模式
- **依赖**：`hono`、`@hono/node-server`
- README：HTTP API 快速开始示例

### Fixed
- **存储层健壮性**（`core/fix-storage-robustness`，探针实测确认后修复）：
  - 事务**可重入**：嵌套 `transaction()` 加入当前事务（SAVEPOINT），不再报 `within a transaction`（契约 v1.1 语义）
  - `find` 计数改 `tx.count()` 且与分页数据**同一事务视图**（原：两次事务 + 全量取回取 length）
  - content service 方法去除 `this` 依赖（解构/传回调安全）
  - 驱动错误收敛为 `StorageError(E_CONFLICT/E_STORAGE)`，`SqliteError` 码不外漏
  - JSON 列**显式声明**解析，废除"像 JSON 就 parse"启发式（防正文静默损坏）
  - `:memory:` 跳过无效的 WAL 配置

- **决策 #25（规划）**：运行时作为策略表第二维度（SQLite 驱动按运行时分两份实现，Bun 侧解锁真单二进制；排期后续）

### Changed
- 交付测试改用 `node app.mjs --selfcheck`（服务现为常驻模式，自检模式用于装配验证）

### Verified
- 全套测试 58/58；真实冒烟（Node + curl）8/8；内核零改动


## [0.1.0] - 2026-10-11 · 内核骨架跑通

### Added
- **内核**：`kernel/` 原语（result / id[UUIDv7+租户短id] / entity / principal / portable-text+Zod）、事件总线、契约（storage / content / module / authz / search）、注册表、bootstrap（模块子集可启动）、唯一出口
- **存储模块**：二维策略表（逻辑类型×方言）、SQLite 策略（`better-sqlite3`）、策略工厂（唯一选择点）
- **内容模块**：写入强制 Portable Text 校验（铁律）、软删除、类型定义驱动
- **博客场景**：数据驱动类型定义 + 可运行入口 + 启动自检日志
- **工程链**：tsconfig(strict+别名)、eslint 边界规则、CI 扫描（内核词汇 / 方言分支 / 契约快照）、Makefile、vitest
- **测试**：单元 28 + 启动 9（可拔插/切方言/内容铁律）+ 交付 2（压缩包隔离运行）
- **交付**：`make package` 出自包含压缩包（解压即用，不依赖目标机器环境）

### Changed
- 运行时策略：**验证链与运行走 Node；Bun 仅用于 install/build**（`better-sqlite3` 原生模块在 Bun 下不可用）

### 验证（机器判定，全绿）
- `make verify`：typecheck + lint + 扫描 + 单测
- `make verify-full`：+ 启动测试 + 契约快照 + 交付测试

### Changed
- 富文本格式表述：由"兼容 Portable Text"改为**"严格遵循 Portable Text 规范"**
- 定位表述：约束由"部署极简/资源占用低"改为"**交付自包含、依赖少、方便直观**"；清除各处"极致单文件/极致省空间"措辞
- **交付形态放宽**：由"单二进制（写死）"改为"**自包含（单二进制/压缩包/容器均可）**"；新增 `make package` 压缩包形式
- 跨方言约定：时间由"UTC ISO 字符串"改为 **epoch 毫秒整数**（含 `Entity`/`DomainEvent` 字段）
- 设计文档章节重排：第 7 章新增 ID 策略（7.2）、软删除与唯一约束（7.4），修正 8.x 编号

### Removed
- **移除对 Payload CMS 的依赖**，内核完全自研

---

## [0.0.1] - 2026-10-11 · 设计定稿

### Added
- **架构定稿**：三层洋葱（内核 / 能力模块 / 场景产品）+ 单向依赖 + 事件驱动解耦
- **四条宪法**：① 依赖单向向内 ② 内核只定义契约 ③ 模块间只发订事件 ④ 内核无业务词汇
- **技术栈定稿**：TypeScript + Bun（兼容 Node）+ Hono + Drizzle
- **多数据库支持设计**：SQLite（默认）/ PostgreSQL / MySQL，策略模式切换
- **内容层设计**：富文本严格遵循 Portable Text；渲染产物仅作缓存；双编辑器归一
- **数据模型设计**：内容类型 Schema 驱动、多租户 `tenant_id` 预留、RBAC + 字段级权限
- **工程规范**：目录结构、契约代码骨架、CI 检查清单、可拔插测试

### Changed
- 架构演进：Payload 由"内核"降级为"内容能力模块"，最终**完全弃用**
- 运行时选型：评估 Go 后**确定采用 TypeScript**

### Decisions（重大设计决策存档）
- 采用**策略模式**解耦所有"多实现"场景（数据库、搜索、缓存、存储、认证）
- 数据库**默认 SQLite**（部署简单直观，非为极致省空间），预留 PG 迁移路径
- 交付形态：**自包含**（目标机器零环境依赖）——`bun --compile` 单二进制为首选，压缩包/容器为可选

---

## 版本规划（Roadmap）

| 版本 | 目标 | 内容 |
|------|------|------|
| v0.1.0 | 内核骨架 | 契约 + 事件总线 + 注册表 + 存储策略（SQLite） |
| v0.2.0 | 内容能力 | 内容模块 + Portable Text + Zod + Content API |
| v0.3.0 | 管理后台 | React 后台 + Management API |
| v0.4.0 | 自包含交付 | 单二进制 / 压缩包打包 |
| v0.5.0 | 多端增强 | 缓存策略、API 版本化、多语言、媒体处理 |
| v1.0.0 | 稳定 | 第一个场景产品（博客）完整跑通 |
| v2.0.0 | 多租户 | SaaS 能力（视需求） |

---
