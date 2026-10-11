# 无头内容管理系统（Headless CMS）方案设计

> 面向：自建博客 / 多端内容 API / 未来 SaaS 多租户 / 企业内部中台
> 约束：**部署极简（单二进制）、依赖少、资源占用低、架构可控可延伸**
> 版本：v3.0 · 2026-10（v3：技术栈定稿 Bun+TS，多数据库策略模式，架构确认为自研内核）

---

## 0. 一句话结论

**自研薄内核 + 可插拔能力模块 + 多场景产品组装；发布为单个可执行文件。**

```
技术栈：TypeScript + Bun（兼容 Node） + Hono + Drizzle
数据库：SQLite（默认） / PostgreSQL / MySQL —— 策略模式可切换
前端：  React + Vite（与后端共享类型）
发布：  Bun --compile 单二进制（内嵌 SQLite 文件，零环境依赖）
```

**三条核心设计主线：**
1. **垂直 + 水平分层的三层洋葱架构**（内核 / 能力模块 / 场景产品），依赖单向向内。
2. **一切实现走抽象 + 策略模式解耦**（存储、搜索、鉴权等），业务代码永不接触具体实现。
3. **单一核心，延伸多产品**——内核稳定不变，通过加减模块与场景覆盖不同业务。

> **修订历史**
> - v1：误将 Payload CMS 当作架构"内核"。
> - v2：确立平台化三层架构，Payload 降级为"内容能力模块"。
> - v3：**确认自研内核**（不用 Payload 作内核）；技术栈定稿 Bun+TS（兼容 Node）；确立多数据库策略模式。
> - v4：**内容层设计定稿**（新增第 6 章）——富文本**严格遵循 Portable Text 规范**、双编辑器归一、渲染产物仅作缓存；**明确不依赖任何第三方 CMS**。

---

## 1. 需求澄清：四个场景不是一套系统

| 场景 | 核心诉求 | 真正的难点 | 属性能否复用 |
|------|---------|-----------|-------------|
| A. 个人 / 小团队博客 | 快、省、能写文章 | 几乎没有 | ✅ 基础版覆盖 |
| B. 多端产品内容 API | 稳定只读 API、缓存、多端适配、多语言 | CDN、API 版本化、灰度 | ✅ 同一引擎加缓存层 |
| C. SaaS 多租户 | 数据隔离、按量计费、租户级后台 | **隔离 + 计费 + 权限模型** | ⚠️ 叠加独立的租户层 |
| D. 企业知识中台 | 审批流、细粒度权限、审计、SSO | **组织架构 + 工作流 + 合规** | ⚠️ 叠加独立的工作流层 |

**关键判断：A 和 B 是同一套系统的不同规模；C 和 D 是在 A/B 之上叠加的独立能力层。**

> 正如客户所言：**"做一个核心，在核心上延伸出各种场景的产品。"** 这正是本方案的全部设计目标。

架构策略：**核心引擎一次做对，能力层按需叠加。** 盲目追求"一开始就全支持"，只会得到臃肿、每个场景都不好用的四不像。

---

## 2. 核心架构：垂直 + 水平分层的三层洋葱

### 2.1 为什么不是简单的"水平分层"

常见误区是把"垂直切分"和"水平分层"当同一维度混用，导致设计打架。正确理解是**两个正交维度**：

| 切分方式 | 切的是什么 | 用途 |
|---------|-----------|------|
| 水平分层（按职责） | 纵向切技术职责（接入/业务/数据） | 技术架构 |
| 垂直切分（按业务域） | 横向切业务能力（内容/权限/计费） | 模块划分 |
| **按抽象层级分层** | 切稳定性/通用性（内核/模块/场景） | **平台化的核心** |

**本方案采用"按抽象层级分层"为主干，辅以"业务域垂直切分"为模块划分。**

### 2.2 三层洋葱架构

```
┌──────────────────────────────────────────────────────────────┐
│  scenarios/  场景产品层（水平延伸 · 最外层 · 易变）             │
│  博客站 · 多端内容API · SaaS · 知识中台                          │
│  ── 只组装，不发明。允许依赖：modules/*、kernel                 │
└────────────────────────────┬─────────────────────────────────┘
                             │ 依赖单向 ↓
┌────────────────────────────▼─────────────────────────────────┐
│  modules/  能力模块层（垂直切分 · 可插拔 · 每个模块独立）        │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ 内容    │ │ 权限    │ │ 存储    │ │ 计费    │ │ 工作流  │       │
│  │content │ │ authz  │ │storage │ │billing │ │workflow│       │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
│  ── 模块间只发/订事件；拔掉任一模块平台仍能启动 ──              │
└────────────────────────────┬─────────────────────────────────┘
                             │ 依赖单向 ↓
┌────────────────────────────▼─────────────────────────────────┐
│  kernel/  内核层（最稳定 · 对场景无知 · 只定义契约）            │
│  内容原语 · 事件总线 · 扩展点契约 · 存储/身份/搜索抽象           │
│  模块注册表 · 统一 Result 类型                                  │
│  ── 不 import 任何 modules/scenarios；不出现业务词汇 ──         │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 四条宪法（平台化成败的关键）

| # | 宪法 | 违反后果 | 强制手段 |
|---|------|---------|---------|
| 1 | **依赖只能单向向内**（场景→模块→内核） | 改一处崩全部 | eslint-plugin-boundaries + CI |
| 2 | **内核只定义契约，不含实现** | 内核越来越重 | kernel 下只允许类型/接口文件 |
| 3 | **模块间只发/订事件，不直接调用** | 拔掉模块系统崩 | 禁止跨模块 import 实现 |
| 4 | **内核不出现业务词汇**（article/blog/order） | 内核被场景污染 | CI 关键词扫描 |

> **判定平台化是否成立的唯一标准**：从产品一到产品四，**内核一行都不用改**，只做"加模块、改组装"。
> 若每加一个场景都要回改内核 → 抽象层级切错了。

### 2.4 运行时分层的功能视角

```
接入层（Web / App / 小程序 / 第三方）
   │
   ├─▶ Content API   （对外 · 只读 · 可 CDN 缓存 · GET /api/v1/*）
   │
   └─▶ Management API（对内 · 写 · 强鉴权 · 后台 CRUD）

两者都依赖 ↓

内核（kernel）：契约 + 事件总线 + 注册表
   │ 加载
能力模块（modules）：content / authz / storage / ...
   │ 使用
数据层：StorageDriver 策略（SQLite / PG / MySQL 任选）
```

**为什么 API 必须分两层**：Content API 是 QPS 最高、可缓存、匿名的部分；Management API 是写操作、强鉴权、不可缓存的部分。混在一起则既无法放心挂 CDN，也无法严格防护。

---

## 3. 架构支柱：抽象 + 策略模式解耦

> 客户明确要求：**"多用抽象和策略模式解耦实现。"** 这是本方案的技术灵魂，贯穿所有可替换点。

### 3.1 反面教材（绝不这样写）

```ts
// ❌ 灾难：业务代码里 if/else 判断具体实现
async function createEntry(input) {
  if (config.dialect === 'sqlite')       await sqliteDb.insert(...);
  else if (config.dialect === 'postgres') await pgDb.insert(...);
  else if (config.dialect === 'mysql')    await mysqlDb.insert(...);
}
```
**问题**：业务代码知道了数据库的存在 → 加方言要改 N 处 → 违反开闭原则。

### 3.2 正确范式：契约（策略接口）+ 策略实现 + 工厂装配

```ts
// ① 策略接口（内核定义，业务只认它）
interface StorageDriver {
  readonly dialect: Dialect;
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

// ② 策略实现（各自独立，互不知晓）
class SqliteDriver   implements StorageDriver { /* ... */ }
class PostgresDriver implements StorageDriver { /* ... */ }
class MysqlDriver    implements StorageDriver { /* ... */ }

// ③ 工厂（唯一知道"有哪些策略"的地方）→ 把变化点收敛到一处
function createStorageDriver(cfg: StorageConfig): StorageDriver {
  switch (cfg.dialect) {
    case 'sqlite':   return new SqliteDriver(cfg);
    case 'postgres': return new PostgresDriver(cfg);
    case 'mysql':    return new MysqlDriver(cfg);
    default: throw new Error(`Unsupported dialect: ${cfg.dialect}`);
  }
}
```

**进阶：注册表替代 switch**（连工厂都不改即可扩展）
```ts
const registry = new Map<Dialect, () => StorageDriver>();
export const registerDriver = (d, f) => registry.set(d, f);
// 各驱动文件末尾自注册 → 新增方言 = 新增文件，零修改
```

### 3.3 策略模式的应用清单（所有可替换点）

| 可替换点 | 策略接口 | 策略实现 |
|---------|---------|---------|
| **数据库** | `StorageDriver` | SQLite / Postgres / MySQL |
| **全文搜索** | `SearchService` | FTS5 / tsvector / FULLTEXT |
| **缓存** | `CacheProvider` | 内存 / Redis / 无 |
| **文件存储** | `StorageProvider` | 本地磁盘 / S3 / OSS |
| **内容引擎** | `ContentService` | 自研实现 / 适配 Payload（可选） |
| **认证** | `AuthProvider` | 本地密码 / SSO / OAuth |
| **通知** | `NotificationProvider` | 邮件 / Webhook / 无 |

**原则：把"不可统一的差异"关在策略实现里，契约层只暴露统一语义。**

### 3.4 三层解耦线（缺一不可）

```
业务 ↔ 存储    ：靠 StorageDriver 契约解耦
存储 ↔ 方言    ：靠策略模式（多实现）解耦
方言差异 ↔ 代码 ：靠策略表（类型映射）解耦
```

---

## 4. 技术栈（定稿）

### 4.1 选型总表

| 层 | 选型 | 说明 |
|----|------|------|
| 语言 | **TypeScript**（strict） | 契约用 interface 表达，编译期挡越界 |
| 运行时 | **Bun**（**必须兼容 Node**） | 开发/构建用 Bun，代码不依赖 Bun 独有 API |
| HTTP 框架 | **Hono** | 核心无依赖，双端适配，可打包 |
| ORM | **Drizzle** | 多方言支持，是"多数据库"方案的核心 |
| 数据库 | **SQLite（默认）/ PostgreSQL / MySQL** | 策略模式切换，单二进制含全部驱动 |
| 驱动 | `better-sqlite3` / `pg` / `mysql2` | 均为跨 Node/Bun 可用 |
| 校验 | **Zod** | 所有写入入口校验 |
| 前端 | **React + Vite** | 与后端**共享类型** |
| 反向代理 | **Caddy** | 自动 HTTPS，配置极简 |
| 发布 | **Bun --compile 单二进制** 或 单容器 Docker | 目标机器零环境依赖 |

### 4.2 为什么选 TypeScript（而非 Go）

| 维度 | 对平台化的重要性 | TS | Go |
|------|----------------|-----|-----|
| 契约表达与演化 | ★★★★★ | 强 + 重构工具强 | 够用但重构弱 |
| 前后端类型共享 | ★★★★★ | ✅ 同一份类型 | ❌ 必然有断层 |
| 管理后台生态 | ★★★★★ | ✅ React 原生 | ⚠️ 需另写 |
| 迭代速度 | ★★★★☆ | 快 | 略啰嗦 |
| 运行占用 / 单二进制 | ★★☆☆☆ | 100~300MB / Bun 可编译 | ✅ 极低 |

**判断逻辑**：本项目的本质是"**管理复杂度的平台**"，不是"追求极致性能的服务"。
- 性能瓶颈在**缓存与索引**，不在运行时语言（运行时只影响 5~10% 的逻辑执行）。
- TS 赢在**契约演化 + 前后端类型共享**，这两条是平台化的命门。
- Go 赢的"低占用 + 单二进制"，Node 通过 **Bun --compile** 已能达到 90 分——不值得用类型断层去换。

### 4.3 为什么选 Bun，以及"兼容 Node"硬约束

**选 Bun 的真实理由（不是性能）**：
1. **省内存**（比 Node 省 30~50%）——直接呼应"占用低"。
2. **工具链整合**（内置 bundler/test/包管理）——直接呼应"依赖少"。
3. 冷启动更快、`bun install` 更快——顺带甜头。

**性能澄清（避免误判）**：
| 场景 | Bun vs Node |
|------|------------|
| 冷启动 / 内存 / 安装 | ✅ Bun 明显优 |
| **数据库 I/O 密集（本项目的场景）** | ⚖️ 基本持平 |
| CPU 密集计算 | ⚖️ Node 有时反超 |

> **结论**：性能不是选 Bun 的理由，**省内存 + 依赖少**才是。真正的性能靠缓存和索引。

**"兼容 Node" 硬约束（禁用 Bun 独有 API）**：

| ❌ 禁用（Bun 独有） | ✅ 改用（双端通用） |
|-------------------|-------------------|
| `Bun.serve()` | Hono + `@hono/node-server` |
| `bun:sqlite` | `better-sqlite3` + Drizzle |
| `Bun.file` / `Bun.write` | `node:fs/promises` |
| `bun:test` | Vitest |
| `Bun.password` | `node:crypto` (scrypt) |
| `Bun.env` | `process.env` |

> **原则**：只写标准 TS + Node 标准库 + 跨端库。**Bun 只当"更快的 runner 和包管理器"，不当"运行时特性提供者"。**
> **收益**：出问题时把启动命令从 `bun run` 换成 `node` 即可切回，业务代码零改动。

### 4.4 为什么数据库默认 SQLite

依据客户的两个决策：**"极致单文件优先" + "SaaS 时间表还不确定"**。

| 好处 | 说明 |
|------|------|
| 零独立服务 | 数据库就是一个文件，不用起容器 |
| 真·单二进制 | 二进制 + `.db` 文件，拷到哪都能跑 |
| 读性能好 | 单机读甚至快于 PG（无网络往返） |

**代价（必须知悉）**：写入串行（多租户高并发写受限）；难以水平扩展（多实例会抢同一文件）。

**结论**：**先用 SQLite，用"Postgres 思维"设计，SaaS 需求确定时再迁移。** 详见第 5 章。

---

## 5. 多数据库支持（策略模式落地）

### 5.1 架构

```
kernel/contracts/storage.contract.ts   ← 策略接口 StorageDriver
        ↑ 实现
modules/storage/
  drivers/sqlite.driver.ts             ← 策略1
  drivers/postgres.driver.ts           ← 策略2
  drivers/mysql.driver.ts              ← 策略3
  schema/columns.ts                    ← 策略表（逻辑类型 → 方言类型）
  factory.ts / registry.ts             ← 装配（唯一选择点）
        ↑ 使用
scenarios/ · 业务逻辑                  ← 只调契约，不知道方言存在
```

**一个二进制含全部驱动，靠配置切换：**
```bash
./app                                           # 默认 SQLite
DB_DIALECT=postgres DB_URL=postgres://... ./app # 切 Postgres
DB_DIALECT=mysql    DB_URL=mysql://...    ./app # 切 MySQL
```

### 5.2 Schema 组织：一份逻辑定义 + 策略表适配

> **术语：什么是"策略表"**
> 本文档所说的**"策略表"**，指**用一张二维查找表（逻辑类型 × 数据库方言）代替 if/else 堆叠**的写法。
> 它是**策略模式的轻量版**——不写 class，用对象字面量当策略容器（`strategies[type][dialect]()`）。
> **作用**：消除"同一字段在各数据库下写法不同"的分支判断，让**列定义只在实体层写一次**，加类型/加数据库只改一处。
>
> 反例（禁止）：
> ```ts
> if (type === 'uuid') { if (dialect === 'sqlite') return text(...); if (dialect === 'postgres') return uuid(...); }
> ```
> 参见 cookbook P1.1「禁止 if/else 代替策略模式」。

```ts
// modules/storage/schema/columns.ts —— 列定义写一次，方言适配交给策略表
const strategies: Record<LogicalType, ColumnStrategy> = {
  uuid: {
    sqlite:   () => text('id'),
    postgres: () => uuid('id'),
    mysql:    () => char('id', { length: 36 }),
  },
  json: {
    sqlite:   () => text('data', { mode: 'json' }),
    postgres: () => jsonb('data'),
    mysql:    () => json('data'),
  },
  timestamp: {
    sqlite:   () => integer('ts', { mode: 'timestamp' }),
    postgres: () => timestamp('ts', { withTimezone: true }),
    mysql:    () => datetime('ts'),
  },
};
export const column = (t: LogicalType, name: string, d: Dialect) => strategies[t][d](name);
```

### 5.3 跨方言差异的规避策略（迁移的关键）

| 差异点 | 统一做法（避免将来难迁） |
|--------|------------------------|
| 主键 | **应用层生成 UUID**（`crypto.randomUUID()`），不用自增 |
| JSON | Drizzle `mode:'json'`，序列化在应用层 |
| 布尔 | Drizzle `boolean()` 自动映射，不写裸 SQL |
| 时间 | **统一 UTC ISO 字符串 / epoch 整数** |
| UPSERT | Drizzle `.onConflictDoUpdate()` |
| Collation | 显式指定，不依赖默认（MySQL 默认不区分大小写） |
| 全文搜索 | 各自策略实现，契约层只暴露 `search()` |
| SQL | **全部走 Drizzle 方言无关 API，禁止裸 SQL** |

### 5.4 SQLite 必做配置

```ts
db.run(sql`PRAGMA journal_mode = WAL;`);     // 读写并发
db.run(sql`PRAGMA busy_timeout = 5000;`);    // 写冲突等待
db.run(sql`PRAGMA foreign_keys = ON;`);      // 外键约束
```

### 5.5 迁移路径（SQLite → Postgres）

| 应用层 | 迁移时要改什么 |
|--------|--------------|
| Drizzle schema | 少量（`sqliteTable`→`pgTable`，靠策略表已最小化） |
| 业务代码 | **几乎不改**（Drizzle 屏蔽差异） |
| 数据 | 写导出/导入脚本一次 |

### 5.6 关于多数据库的三条忠告

1. **别过早实现三个方言**——契约留扩展点，先做 SQLite，PG/MySQL 按需加。每多一方言，测试矩阵翻倍。
2. **契约要"最小够用"**——只暴露通用原语，别把 PG 特有的 jsonb 查询泄漏到契约里，否则抽象会破。
3. **测试必须跑多方言**——SQLite 直跑，PG/MySQL 用 Docker 起容器做 CI。

---

## 6. 内容层设计（地基规范 · 必须提前定死）

> **为什么单独成章**：内容存储格式是**地基级决策**。一旦开始写代码、灌入数据，"存什么格式"再改就是伤筋动骨。
> 本方案曾有一个真实教训：早期博客系统把 Markdown 转成 HTML 后直接入库，结果**换主题、加多端、修渲染 bug 都要重刷全库**。
> 因此本章**提前钉死**内容层的全部关键决策。

### 6.1 反面教材：存"渲染产物"是错的

```
❌ 错误做法（早期博客系统的教训）：
   Markdown ──写入时转──▶ HTML ──存入库──▶ 前端直接渲染

问题：HTML 是"面向 Web 的一种呈现"，却成了唯一数据源。
  · 换主题        → 要反解析 HTML，脏
  · 加 App 端     → HTML 绑死 Web，无法渲染成原生组件
  · 修渲染 bug    → 源 Markdown 已丢，只能重刷
  · 换富文本能力  → 从 HTML 反推结构，几乎不可能
```

### 6.2 正确模型：内容存三层，渲染永远可再生

```
✅ 正确做法：
   ┌─ ① 源格式 source      ← 用户输入的原文（Markdown / 编辑器 JSON）
   ├─ ② 结构格式 structured ← 解析后的 Portable Text（中性、可校验）
   └─ ③ 渲染格式 rendered   ← 按需生成 + 缓存的 HTML 【不是数据，是缓存】

   真相（source of truth） = ① + ②
   ③ 必须能随时从 ② 重新生成，任何以 ③ 为唯一真相的设计都是错的。
```

### 6.3 富文本结构：严格遵循 Portable Text 规范

**决策：富文本的结构格式严格遵循 Portable Text 规范，不做任何私自改动。**
（遵循其**数据格式规范**，但**不引入 Sanity 的任何代码库**——格式与实现是两回事。）

> **"严格遵循"的含义**：逐字段与规范一致（`_type`/`_key`/`children`/`marks`/`markDefs`/`asset._ref` 等）。
> 好处：任何支持 PT 的生态工具、序列化器、迁移工具都能**直接读写**我们的数据，无需转换层。
> 不采用"兼容"这种模糊表述——要么严格一致，要么明确扩展，不允许"像但不完全一样"的中间态。

Portable Text 是一种**结构化富文本**格式，本质是一个**块对象数组**：

```ts
// 结构示意（严格遵循 Portable Text 规范）
type PortableText = PortableTextBlock[];

type PortableTextBlock =
  | { _type: 'block'; _key: string; style: 'h1'|'h2'|'h3'|'normal'|'blockquote';
      listItem?: 'bullet'|'number'; level?: number;
      children: Span[]; markDefs?: MarkDef[] }
  | { _type: 'image'; _key: string; asset: { _ref: string }; alt?: string }   // 存 asset 引用 ID
  | { _type: 'code'; _key: string; language: string; code: string }
  | { _type: string; _key: string; [k: string]: unknown };                   // 自定义块（按规范扩展）

interface Span {
  _type: 'span';
  _key: string;
  text: string;
  marks?: string[];          // 'strong' | 'em' | 'underline' | markDef._key
}

interface MarkDef {
  _key: string;              // 被 Span.marks 引用
  _type: 'link';
  href: string;              // 链接可存 url；图片必须存引用 ID
}
```

**规范覆盖能力（确认够用）**：

| 情况 | PT 的支持 |
|------|----------|
| 段落、各级标题、引用 | `style` |
| 有序/无序/嵌套列表 | `listItem` + `level` |
| 粗体、斜体、下划线、删除线 | `marks` |
| 链接、内部引用 | `markDefs` + `marks` |
| 图片、图注 | `_type:'image'` + `asset._ref` |
| 代码块 | `_type:'code'` |
| 表格 | 官方 table 扩展 |
| 自定义嵌入块（视频/组件） | `_type:'custom'` + 自定义字段 |

**使用边界（必须遵守）**：

> PT 只承载**"人要读的叙述性文本"**。任何**需要被查询、排序、聚合的结构化数据**（价格、库存、状态、规格），
> **必须用 `EntityTypeDef` 的普通字段**，不得塞进富文本块——否则无法建索引、无法查询。

正确分工：
```
EntityTypeDef 字段系统  →  可查询的结构化业务数据
Portable Text 富文本字段 →  叙述性内容（正文、描述）
```

**为什么选结构化而非 HTML/Markdown 直存**：

| 能力 | 存 HTML | 存 Markdown | **存 Portable Text** |
|------|--------|------------|-------------------|
| 类型校验 | ❌ | ❌ | ✅ |
| 渲染到多端（Web/App/PDF） | ❌ | ⚠️ 需再解析 | ✅ |
| 换主题 / 换渲染规则 | ⚠️ 难 | ✅ | ✅ |
| 局部更新（改一段） | ❌ | ⚠️ | ✅ |
| 富文本扩展（自定义块） | ❌ | ❌ | ✅ |
| 内容迁移 / 转换 | ⚠️ | ✅ | ✅ |

**为什么最终选 PT（优缺点评估）**：

*它的好：*
- **内容与呈现彻底分离**——纯数据结构，不带任何渲染信息，天然支持多端。
- **被生产验证**——Sanity 为海量真实内容、多端渲染、**实时协作**而设计，不是实验室产物。
- **关键设计见功力**：`_key`（每块唯一 ID，协作编辑/局部更新的前提）、`marks` 分离内联标记、统一块模型、`custom`/`markDefs` 扩展点、引用式媒体。
- **有生态**：序列化器、渲染器、Markdown 互转、编辑器均有现成实现。

*它的代价（必须知悉，别半路反悔）：*
- **啰嗦**——一句"你好"也要包成 `block → span`，带 `_key`/`_type`/空 `marks`。这是**用冗余换完备性**的刻意权衡。
- **`_` 前缀**是为区分用户自定义字段的防御性设计，正确但不美观。
- **规范偏重**——只用 20% 能力却要理解全套约定。
- **只适合文档模型**——不适合结构化数据（需配合普通字段）。
- **生态优势被"自研"削弱**——主要受益于"规范本身的经验"，而非"拿来即用的库"。

> **结论**：PT 不是"优雅到无可挑剔"，而是**工程上最稳的务实选择**。
> 用一点啰嗦，换完备性 + 验证过的设计 + 公开规范（团队协作/迁移/招人有共同语言）。
> 对"自研 + 多端 + 长期演进"的项目，**收益远大于代价**。
> 唯一不选它的理由：富文本需求极简（仅段落+粗体+链接）时，精简自定义 JSON 更轻——但要自担规范维护。

### 6.4 双编辑器模式，内部归一到同一结构

**决策：后台同时支持 Markdown 编辑与块编辑器（所见即所得），但写入时统一归一为同一种结构 JSON。**

```
Markdown 编辑器 ──解析──▶ ┐
                          ├──▶ Portable Text（唯一存储格式）──▶ 存储
块编辑器（WYSIWYG）──────▶ ┘
```

- **Markdown 编辑器**：适合技术写作者，输入快。
- **块编辑器**：适合非技术编辑，所见即所得（类 Notion）。
- **关键**：两者**产物必须归一**——否则数据结构会分裂成两套，后患无穷。
- 反向（结构 → Markdown 回显）尽力而为，**以结构为准**。

### 6.5 内容层全部决策点（已定死）

| # | 决策点 | **结论（定死）** |
|---|--------|----------------|
| 1 | 富文本存什么 | **严格遵循 Portable Text 规范**（不做私自改动） |
| 2 | 原始输入是否保留 | **保留源（Markdown 原文 / 编辑器产物）**，与结构并存 |
| 3 | 渲染产物如何对待 | **仅作缓存，永远可从结构再生，不作数据源** |
| 4 | 图片/媒体怎么引 | **存引用 ID（`asset._ref`），不存最终 URL** |
| 5 | 内容类型怎么定义 | **Schema 驱动**（`EntityTypeDef`），非硬编码表 |
| 6 | 版本与状态 | **状态机**（draft/published/archived）+ 版本快照 |
| 7 | 多语言 | **locale 是内容的一维**（同一条内容多语言记录） |
| 8 | 校验在哪层 | **写入入口 Zod 强制校验**（结构不合法不入库） |
| 9 | PT 使用边界 | **只装叙述性文本；可查询数据用普通字段** |
| 10 | 扩展方式 | **用 PT 规范的 `custom` 块机制扩展，不破坏规范** |

### 6.6 内容层与架构的呼应

本章的结论正好印证了前面两个设计决策：

1. **"内容用 JSON 存 + Zod 校验"** → 因为要存的是**结构化数据**（Portable Text），不是 HTML 字符串。
2. **"Content API 与前端分离"** → 内容是**中性的**；Web 只是消费方之一。存 HTML 等于把 Web 端的需求写死进了数据。

> **一句话铁律**：**渲染产物（HTML）永远是可再生的缓存，绝不作为数据源。** 任何违背此条的设计都必须在评审阶段拦下。

---

## 7. 数据模型设计

### 7.1 逻辑表结构（方言无关描述）

| 表 | 作用 | 关键字段 |
|----|------|---------|
| `tenants` | 租户（初期仅一条默认记录） | id, name, slug, plan |
| `content_types` | 内容类型定义 | id, tenant_id, slug, schema(JSON) |
| `entries` | 所有内容条目（主体存 JSON） | id, tenant_id, content_type, locale, status, data(JSON), published_at, deleted_at |
| `entry_versions` | 版本历史 | id, entry_id, version, data(JSON) |
| `users` | 用户 | id, tenant_id, email, password_hash |
| `roles` | 角色（RBAC + Scope） | id, tenant_id, name, permissions(JSON) |
| `media` | 媒体资源 | id, tenant_id, filename, mime, size, url |

**关键设计**：所有业务表统一带 `tenant_id`（为多租户预留）；内容主体用 **JSON 字段**存（配合应用层 Zod 校验）；**主键统一应用层 UUID**。

> 具体物理类型由第 5 章的策略表按方言生成（如 `data` 在 PG 是 `jsonb`、SQLite 是 `text`、MySQL 是 `json`）。

### 7.2 权限模型（RBAC + Scope + 字段级）

```json
{
  "role": "editor",
  "rules": [
    {
      "collection": "articles",
      "actions": ["read", "create", "update"],
      "scope": { "ownerOnly": true },
      "fields": { "deny": ["isFeatured", "publishDate"] }
    }
  ]
}
```

- **`scope`**：数据范围（仅自己 / 本部门 / 全租户）——多租户与审批流的基础。
- **`fields.deny`**：字段级权限——企业场景刚需，前期就要抽象好。

### 7.3 多租户策略

| 策略 | 隔离性 | 成本 | 适用 |
|------|--------|------|------|
| **共享库 + `tenant_id`**（推荐起步） | 中 | 最低 | 中小 SaaS |
| 共享库 + 每租户 Schema | 中高 | 中 | 中等规模 |
| 每租户独立数据库 | 最高 | 最高 | 大客户、合规 |

**SQLite 下注意**：单文件写串行，多租户高并发写会受限 → 租户量上来时迁移到 PG。

---

## 8. 部署与发布

### 7.1 发布形态：单二进制（首选）

```bash
bun build ./src/index.ts --compile --outfile dist/app
# 产出 dist/app —— 目标机器无需 Bun、无需 Node、无需 nginx
```

- React 静态产物通过 **`embed`** 打进二进制。
- SQLite 驱动（`better-sqlite3`）也在二进制内，数据库即一个文件。
- **最终形态**：一个二进制 + 一个 `.db` 文件，拷过去就能跑。

### 7.2 交叉编译注意

`better-sqlite3` 是原生模块，**交叉编译（Mac 编 Linux）会有坑**。
**规避**：**在目标平台或 Docker 内编译**。

### 7.3 备选：单容器 Docker

若坚持用 PostgreSQL，则单二进制无法覆盖数据库 → 用 `docker compose` 一键起 `app + db` 两个容器。**目标机器只需 Docker。**

### 7.4 开发 vs 发布（两模式）

| 模式 | 前端 | 后端 | 命令 |
|------|------|------|------|
| 开发 | Vite dev server（HMR） | Bun 直接跑 | `make dev` |
| 发布 | `vite build` → 打进二进制 | `bun --compile` | `make build` |

---

## 9. 分阶段落地路线

### 阶段一：内核 + 存储 + 内容（2–4 周）—— 覆盖场景 A/B 基础
- [ ] 搭 TS + Bun + Hono 骨架
- [ ] **实现内核**：内容原语、事件总线、注册表、契约接口
- [ ] **实现存储模块**：`StorageDriver` 契约 + **SQLite 策略** + 工厂/注册表
- [ ] **实现内容模块**：`ContentService` 契约 + 最小实现（内存或 SQLite）
- [ ] 内容类型定义（2–3 个）+ 基础 CRUD
- [ ] Content API（只读、字段裁剪、分页、`/v1/` 前缀）
- [ ] React 后台（列表 + 编辑，消费 Content API）
- [ ] `bun --compile` 出单二进制，跑通
- [ ] `tenant_id` 全部就位（即使只有默认租户）

**验收**：一个二进制跑起来，浏览器进后台能管理内容；**换配置能切到 Postgres**（验证策略模式）。

### 阶段二：多端增强 —— 夯实场景 B
- [ ] CDN / 缓存策略（`CacheProvider` 策略：内存/Redis/无）
- [ ] API 版本化、限流
- [ ] 多语言（locale）
- [ ] 媒体处理（`StorageProvider` 策略：本地/S3）
- [ ] 内容预览

### 阶段三：多租户（有真实 SaaS 需求时）
- [ ] 租户管理、配额、计费埋点
- [ ] 查询层强制注入 `tenant_id`
- [ ] 租户级角色权限
- [ ] **迁移到 PostgreSQL**（若尚在 SQLite）

### 阶段四：企业能力（有真实客户时）
- [ ] `AuthProvider` 策略：SSO（SAML/OIDC）
- [ ] 审批工作流
- [ ] 审计日志
- [ ] 组织架构、字段级权限完整落地

> **重要**：阶段三、四**不要提前做**。架构留好扩展点即可，实现按需推进。

---

## 10. 关键风险与规避

| 风险 | 说明 | 规避 |
|------|------|------|
| **抽象泄漏** | 业务代码出现 `if (dialect===...)` 或裸 SQL | 强制走契约；CI 扫描 |
| **模块耦合** | 模块互相 import 实现 | 只允许 import 契约；跨模块走事件 |
| **内核污染** | 内核出现业务词汇 | CI 关键词扫描 |
| **多租户串号** | 忘记 `tenant_id` 过滤 | 查询层中间件强制注入 + 单测 |
| **Bun 兼容坑** | 用了 Bun 独有 API | 禁用清单；CI 检查 import |
| **SQLite 扩展受限** | 高并发写/水平扩展 | 预留 PG 迁移路径（策略模式） |
| **交叉编译坑** | 原生模块跨平台 | 在目标平台/Docker 内编译 |
| **JSON 灵活性反噬** | 无强约束 → 脏数据 | Zod 校验所有写入 |
| **API 无版本化** | 改字段 → App 崩 | 从第一天用 `/v1/`，只加不改 |
| **性能陷阱** | Content API 直查 DB | 必须走缓存策略 |
| **把渲染产物当数据源** ⭐ | 存 HTML，换样子要重刷全库（早期博客教训） | **内容存结构（Portable Text）；HTML 仅作缓存；CI 检查内容字段不允许存 HTML 字符串** |
| **双编辑器数据分裂** | Markdown 与块编辑器各存一套格式 | **写入时统一归一为同一种结构 JSON** |

---

## 11. 决策清单（已定稿）

| 决策点 | 结论 |
|--------|------|
| 架构 | **三层洋葱**（内核/模块/场景）+ 单向依赖 + 事件解耦 |
| 内核 | **自研**（TS，薄，对场景无知） |
| 解耦方式 | **抽象 + 策略模式**（存储/搜索/缓存/认证等全部走策略） |
| **富文本存储** | **严格遵循 Portable Text 规范**（不做私自改动，不存 HTML） |
| **编辑器** | **Markdown + 块编辑器双模式，写入归一为同一结构** |
| **渲染产物** | **仅作缓存，永远可从结构再生** |
| **媒体引用** | **存 asset 引用 ID，不存最终 URL** |
| 语言 / 运行时 | **TypeScript + Bun**（**兼容 Node**） |
| 框架 | **Hono** |
| ORM | **Drizzle**（多方言） |
| 数据库 | **SQLite 默认**，可切 **PG / MySQL**（策略模式） |
| 前端 | **React + Vite**（与后端共享类型） |
| 发布 | **Bun --compile 单二进制**（默认）/ Docker |
| 第三方 CMS | **不依赖任何第三方 CMS**；仅借鉴其设计思想（见设计参考） |

---

## 12. 设计参考：我们向成熟 CMS 借了什么

> **原则：只借"设计思想"，不借"代码与模型"。** 自研不等于闭门造车——成熟 CMS 十年趟过的坑值得借鉴，
> 但它们的**实现**与**数据模型**一律不引入，避免污染内核边界。

| 借鉴来源 | 借的设计思想 | 我们的自研落地 |
|---------|------------|--------------|
| **Directus** | "数据库优先"——CMS 是数据之上的一层 | 印证"存储契约 + 策略模式"方向正确 |
| **Payload** | 代码优先 Schema（内容类型用代码定义，可进 Git） | 内核的 `EntityTypeDef` |
| **Sanity** | ⭐ **Portable Text**（富文本结构化存储） | 第 6 章的富文本格式 |
| **Strapi** | Content-Type Builder 的信息架构、插件/扩展点 | 后台建模交互 + 模块扩展点 |
| **Contentful** | 环境/空间抽象、本地化模型 | 多语言、多租户模型参考 |
| **WordPress** | 草稿/修订/发布状态机、钩子机制 | 状态机 + 事件总线（对标 hooks） |

**特别注意的"不可照搬"之处**：

| 它们的做法 | 背后约束 | 我们不能照搬的原因 |
|-----------|---------|------------------|
| Directus 直接包 SQL 表 | 数据库优先，不管表结构 | 我们的表结构是自己的 |
| Payload 深绑 Next.js | 假设用 Next | 我们用 Hono，不能借这个绑定 |
| Sanity 托管 Content Lake | 卖托管 | 我们自托管，只借数据格式 |
| Strapi 庞大插件生态 | 生态大 | 借"扩展点"思想即可 |

> **一句话**：**借它们的"结论"（富文本要结构化、内容类型要可定义、权限要分层），用我们自己的架构（策略模式 + 契约 + 事件总线）去实现。**

---

## 13. 下一步

1. **搭最小可运行骨架**：内核契约 + 事件总线 + 注册表 + **存储策略（SQLite）+ 工厂** + 一个空内容模块。
   - **验证点**：只加载不同模块子集，平台都能启动；换配置能切数据库。
2. 实现**内容模块**（含 Portable Text 结构 + Zod 校验）+ **Content API / Management API** + **React 后台**。
3. `bun --compile` 出单二进制，闭环验证。

> 详细编码规范（目录结构、契约代码、Portable Text 类型、CI 检查、四条宪法的强制手段）见
> [自研平台工程规范.md](./自研平台工程规范.md)。
