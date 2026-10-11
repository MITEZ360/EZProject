# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **类型说明**：`Added` 新增 · `Changed` 变更 · `Deprecated` 弃用 · `Removed` 移除 · `Fixed` 修复 · `Security` 安全

---

## [Unreleased]

### Changed
- **存储层抽出方言无关共享层**（`schema/tables.ts`）：表结构声明、结构注册表、行映射共用；值编解码（JSON/布尔/大整数）由驱动注入 `ValueCodec` 各自吸收
- **search 模块改为策略表**（按方言查表）：未实现的方言优雅降级（不注册能力 + 明确警告），不再阻断启动
- **存储契约 v2.1**：`StorageTx.exec` 支持参数绑定；新增 `StorageTx.query<T>`（原生查询，边界限模块私有表与 QuerySpec 表达不了的方言特性，如 FTS5 `MATCH`）
- **缓存/媒体模块术语归正**：策略选择字段由 `dialect` 改名 `provider`（"方言"专指数据库方言，避免混淆），并改为**策略表驱动**（与 storage factory 同构，模块内无 if/else）
- **依赖分类修正**：`better-sqlite3` 归入 dependencies（运行时依赖）；移除未使用的 `drizzle-orm`；react/antd/dayjs 归入 devDependencies（构建期依赖）
- **管理端归位**：`scenarios/blog/admin` → `scenarios/generic-cms/admin`（通用 CMS 管理端）；内容视图按类型定义动态渲染（零写死字段），App 壳零业务词汇；博客场景复用通用 admin、仅保留类型种子
- **PG 全文检索策略落地**（`modules/search/internal/postgres-fts.ts`）：PG **内置** tsvector + GIN + ts_rank（零扩展依赖，不用 pg_trgm）；`<->` 与 FTS5 phrase 语义经探针实测对齐（相邻命中 / 不相邻不命中 / 逆序不命中），故 search 契约测试参数化跑两方言
- **search 切分层重构**：`tokenize.ts` 只负责切分（导出 `tokenizeList`），查询语法（`"a b"` / `a <-> b`）下沉到各自策略；新增方言无关共享层 `modules/search/internal/document.ts`（索引内容 / 可过滤列白名单 / payload 读回）
- **存储契约 v2.2：声明式建表**（`StorageDriver.createTable(TableDef)`）——模块私有表**不再手写 DDL**，物理类型由存储层按方言落地。新增 `PortableColumnType` / `ColumnDef` / `IndexDef` / `TableDef`；新增方言无关的 DDL 生成器（列名走白名单、默认值只收字面量）。`columns.ts` 的「逻辑类型 × 方言」策略表**首次接入生产路径**，成为建表物理类型的唯一来源
- **6 张模块私有表改声明式**：`audit_logs`、`auth_users`、`auth_roles`、`auth_refresh_tokens`、`assets`、`settings`；`bool` 列在 PG 落原生 `BOOLEAN`（原 codec 把 boolean 转 0/1，等于迁就了错误的列类型），JSON 列 PG 侧统一 `TEXT`（与驱动内置表一致）

### Fixed
- **内容列表"删除"一点即删，无二次确认**：删除是不可逆操作，而"删除"与"编辑"在表格里紧挨着，手滑点到的概率不低。现包裹 Popconfirm 二次确认，并在提示里指向版本历史作为退路
- **component 嵌套项的排序/删除按钮无可访问名称**：只有图标没有文字，屏幕阅读器读不出这是什么按钮。现在每个按钮带 `aria-label`（"上移第 N 项"等）
- **备份/恢复在同一秒内连续执行必然失败**：`VACUUM INTO` 拒绝写已存在文件，而两个脚本的时间戳只精确到秒。定时任务重试、脚本连跑两次、备份+恢复紧挨着——都会直接报错。现在时间戳改为毫秒 + 序号兜底
- **`media` 目录恢复失败**（恢复脚本首次实现时）：`cpSync` 缺 `recursive: true`，媒体恢复路径必然抛 `Recursive option not enabled`
- **损坏的备份快照能覆盖生产库**（严重）：原先只跑 `integrity_check`，而页内容损坏时它仍返回 ok——真正的崩溃发生在覆盖之后读数据时，那时生产库已被毁。现在校验会**逐表真读一遍**，且快照打不开 / `integrity_check` 抛错 / 恢复后库打不开三种情况都收敛为友好提示 + 明确回退指引，并保证目标库分毫未动
- **`update` 只合并 `data`，顶层 `slug` / `status` 永远改不动**：`ContentService.update` 此前把输入全部塞进 `data`（`{...current.data, ...input.data}`），于是顶层保留列既不更新、`data` 里还多出同名字段——与 `create` 行为不一致，表现为"改完 slug 但 URL 不变"。现从输入中提取保留键、更新顶层列并从 `data` 删除
- **`Entity` 原语遗漏顶层保留字段 `slug`**：内核内容原语的顶层字段清单缺 `slug`，与实际建表列不一致（模块按契约拼顶层字段时会漏掉它）
- **模块私有表在 PG 上因物理类型溢出而完全不可用**（6 处 / 5 张表）：`INTEGER` 在 SQLite 是 64 位动态类型、在 PG 只有 32 位，epoch 毫秒直接溢出 → `audit` / `authz`（用户、角色、刷新令牌）/ `media` / `settings` 的写入全部失败。**根因（模块手写物理类型）已由声明式建表从机制上消除**
- **`auth_roles.builtin` 在 PG 上被拒**：JS `boolean` 赋给整数列，PG 强类型报错（SQLite 会静默转 0/1）。现该列声明为 `bool`，PG 落原生 `BOOLEAN`，落库侧不再需要 0/1 转换
- **超长 token 在 PG 上的静默错误**：>2046 字节的 token 被 PG 静默忽略，且落在短语中间会改变距离（`b <-> 超长 <-> c` 退化为 `b <2> c`）——查询语义被悄悄改变却仍"成功"。改为在切分层统一丢弃（`MAX_TOKEN_BYTES`），保证两方言行为一致
- **管理端认证门形同虚设**（安全）：`App.tsx` 的 `probe()` 中 `setAuthed(true)` 写在 `hasSession()` 判断**之外**，导致 healthz 一通就放行——未登录也能进入后台界面（数据接口各自 401，但门本身失守）。改为无会话直接停在登录页。**该缺陷由浏览器真机验证发现，typecheck 与 build 均无法暴露**
- **管理端页面标题**：由"博客后台 · Headless CMS"（博客时代遗留文案）更正为"内容管理后台 · Headless CMS"
- **SQLite 数据文件父目录不存在时启动失败**：驱动现在自动创建父目录。原先抛的是英文原生错误 `Cannot open database because the directory does not exist`，与"解压即用"的定位不符（实测踩到：清空 `data/` 后服务直接起不来）

### Added
- **管理端组件级测试（此前为零）**：新增 `vitest.admin.config.ts`（jsdom，与后端 node 环境分开，避免全局污染）+ `test/admin/`，共 **34 项**覆盖 App 认证门、FieldControl 11 种调色板类型与递归嵌套、SearchView、ContentView 保存链路
  - **认证门用例是回归防线**：原缺陷（`setAuthed(true)` 写在 `hasSession()` 判断之外，未登录也能进后台）能一路通过 typecheck / lint / build——所有静态检查都对一个死掉的门视而不见。现在"healthz 通过但无会话"必须停在登录页
  - **ContentView 保存链路锁死**：改的 slug/status 必须真随请求发出、且不重复塞进 `data`。服务端 `update` 曾只合并 `data`，表现为"保存成功但 URL 不变"
  - **SearchView**：搜索请求固定带 `status=all`（否则管理端搜不到草稿）；相关度用 `toPrecision` 不能显示成 `0.000`
- **jsdom 环境补齐集中在 `test/admin/setup.ts`**：matchMedia / ResizeObserver / IntersectionObserver / scrollTo —— 每个 shim 都在记录组件对浏览器 API 的真实隐性依赖，而不是散落在各用例里
- **`scripts/restore.mjs`（备份恢复）**：`--list` / `--inspect` / `--dry-run` 三种只读模式先看再动；恢复前**自动留底** `pre-restore-<时间戳>.db`（回退路径永远存在）；恢复后逐表比对行数与清单并显式报出差异；媒体经临时目录换名式替换（中断不留半截文件）；非交互环境必须显式 `--yes`，不会静默覆盖
- **`scripts/backup-rotate.mjs`（保留策略）**：GFS 保留法（默认小时 24 / 天 14 / 周 8 / 月 12，约 58 份），**最新一份永不删除**；逐档按时间桶占槽而非"距今 N 天"（备份断档时不会连带删掉该窗口唯一一份可用备份）；支持 `--dry-run` 预演与 `KEEP_*` 环境变量调参
- **`scripts/backup-cron.mjs`（定时入口）**：备份 + 轮转绑成一个原子步骤——拆成两条 cron 命令意味着两者可能只成功一半（备份成了但轮转没跑会占满磁盘；轮转跑了但备份没成功等于净损失）。退出码非 0 让 cron/监控能发现
- **运维手册 `docs/operations.md`**：数据风险地图（点明媒体文件只存引用 ID、不在 DB 备份内）、备份/恢复/发版全流程、定期演练要求、监控清单、常见故障表
- **定时备份文档 `docs/backup-schedule.md`**：crontab 与 systemd timer 两种装法、错开整点的理由、保留策略调参与告警建议
- **Makefile 运维目标**：`backup-list` / `backup-inspect` / `restore-dry` / `restore` / `backup-rotate` / `backup-cron`
- **发版流水线 `.github/workflows/release.yml`**：tag 触发，校验 tag 与 `package.json` 版本一致（不一致直接拒绝发布，避免下载到版本号对不上内容的产物）→ `verify-full` → `make package` → 隔离目录解压自检 → 附 sha256 校验和创建 GitHub Release；也支持手动触发
- **`test/e2e/backup.test.ts`**：13 项端到端测试真跑脚本（快照可独立打开且大整数未被截断、`--inspect` 无副作用、dry-run 不落盘、恢复回到备份时刻的值、恢复前留底可回退、坏快照被拒且目标库未动、轮转淘汰与最新必留、同一秒内连续备份不撞名）
- **`modules/revision`（版本历史 / 回滚）**：新增内核契约 `RevisionService`（`list/get/rollback`）；订阅内容变更事件保存**完整 `data` 快照**（回滚无歧义，不做增量 diff），含操作者、时间与变更来源；管理 API `/api/manage/v1/entries/:type/:id/revisions`（列表 / 详情 / 回滚）；表结构走声明式建表
- **`modules/scheduler`（定时发布）**：新增内核契约 `ScheduleService`（`schedule/cancel/get/list`）；模块只负责**计划管理**，到期执行由轮询侧完成（无额外常驻进程，横向扩容天然安全）；目标条目已删除时到期不报错、计划照常清理（不卡死重试）；管理 API `/api/manage/v1/schedules`
- **Content API 支持 `?fields=a,b` 字段裁剪**：只投影 `data` 里的指定字段（顶层结构列 id/slug/status/时间不参与裁剪，否则调用方无法定位条目）；未知字段名忽略（不报错也不凭空造键）；缓存键含完整 query，不同裁剪各自成条目、互不串味。列表、详情、搜索三处一致生效
- **后台搜索视图**：消费 `/api/v1/search`（固定 `status=all` 以覆盖草稿），支持关键词 + 类型筛选；结果行可"打开"，跳到内容视图并直接弹出该条目编辑框（含 component 嵌套值完整回填）
- **管理端字段编辑体验**：relation 改**内容选择器**（按标题搜索目标条目，不再手输 UUID）、component 改**递归嵌套表单**（repeatable 支持增删与上下移）、media 改**媒体库选择器**（缩略图 + 文件名 + 就地上传并自动选中）；新增可测的纯逻辑层 `lib/entry-format.ts`（标题探测 / 递归空值 / 存量数据规整），为此前零测试的 admin 补上 14 条单测
- **`modules/media`（媒体资产）**：AssetStore 策略（local 文件系统已实现，s3 预留）；防路径穿越；公开下载 + 长缓存；内容只存 asset id
- **`modules/cache`（缓存）**：CacheProvider 策略（memory/none 已实现，redis 预留）；Content API 读路径接入 + 写操作事件驱动失效
- **多语言回退**：实体级 locale，指定语言无结果回退 default
- **PT → HTML 渲染器**（`modules/content/render`）：结构 + 行内 marks + 全量转义（XSS 安全）
- **博客前台**（`scenarios/blog/front`）：SSR 列表/详情页，渲染产物不落库；`make build-blog` 产出前台+API+后台一体交付物
- **后台管理页**：用户管理、角色权限（资源×动作×字段级 scope）、媒体上传（共 7 个视图）
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

### Added
- **`modules/search`（全文检索，唯一空置契约落地）**：SQLite FTS5 策略（零新依赖）；**中文单字切分**（实测选定：默认分词器搜不到中文子串，单字切分索引仅增 51% 即全覆盖）；订阅内容事件做增量索引（事件总线 await → **强一致**）；启动时空索引自动全量构建；`GET /api/v1/search?q=&type=`（可见性同预览门：匿名只搜 published）
- **内容预览门**：Content API 的非 published 读取（草稿 / `status=all`）必须带凭证；预览响应 `private, no-store` 且绕过共享缓存
- **限流**（`modules/http`）：内存固定窗口策略（**有界**：maxKeys + 过期清扫 + 最旧淘汰），按 IP 作用于 `/api/v1/*`（默认 120/窗口）与登录端点（默认 10/窗口，防爆破）；429 + `Retry-After`；可 `enabled: false` 关闭
- **CI 流水线**（`.github/workflows/ci.yml`）：`verify` 档（双 tsconfig 类型检查 + eslint + 内核词汇/方言分支扫描 + 契约快照 + 单测）与 `full` 档（加启动/交付测试 + 构建产物），兑现 design 第 10 章的"机器把关"承诺；契约快照从 verify-full 挪进日常 lint

### Fixed
- **Content API 草稿泄漏**（真实缺口，三处）：`?status=all`/`?status=draft` 匿名可读全部草稿；详情按 slug 可读草稿；**详情按 UUID 时完全不过滤 status** → 现统一由预览门拦截（匿名仅 published，非 published 详情返回 404 不泄漏存在性）
- **方言扫描器漏检**：`check-no-dialect.mjs` 只匹配 `dialect ===`，漏掉 `!==`（`modules/media` 的 `dialect !== 'local'` 长期逃检）→ 已补齐
- **内存缓存改有界 LRU**：原无上限 `Map` 可被外部撑爆（缓存 key 含完整 query string，`?offset=N` 等可产生无限 key）→ 条数上限（默认 1000）+ 近似字节上限（默认 8 MiB）+ LRU 淘汰；命中保鲜、覆盖写不重复计容、纯 LRU 覆盖过期回收（无热路径全表扫）
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
