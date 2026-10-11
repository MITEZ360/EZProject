# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **类型说明**：`Added` 新增 · `Changed` 变更 · `Deprecated` 弃用 · `Removed` 移除 · `Fixed` 修复 · `Security` 安全

---

## [Unreleased]

（空）

## [0.3.0] - 2026-10-11 · React 管理后台

### Added
- **`scenarios/blog/admin`**：React 19 + Ant Design 6 + Vite 管理后台
  - Token 登录门（MANAGE_TOKEN）、文章列表（Table）、新建/编辑（Form + Markdown 输入）
  - Markdown → Portable Text 写入归一（`markdownToPt`）+ 编辑回填（`ptToMarkdown`）——**铁律不破：入库永远是 PT 结构**
- **`modules/http` `staticDir` 选项**：Hono 托管后台静态资源 + SPA 兜底；`/api/*` 未匹配路径回 404 JSON（回归测试锁定）
- **Makefile**：`build-admin` 目标；`package` 自包含包携带后台（解压即得 API + 后台）
- **双 tsconfig**：根（后端）/ `tsconfig.admin.json`（JSX+DOM）

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
