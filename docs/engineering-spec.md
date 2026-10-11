# 自研无头 CMS 平台 · 工程规范（v3.1）

> 定位：平台化自研内核 + 可插拔能力模块 + 多场景产品
> 用途：**写代码前先立规矩**。本文件是开发时的"宪法"，任何 AI 生成 / 人工编写的代码都必须遵守。
> 技术栈：**TypeScript + Bun（兼容 Node） + Hono + Drizzle + SQLite/PG/MySQL**
> 版本：v3.2 · 2026-10（v3.2：交付理念放宽为"自包含"；v3.1：ID 原语、时间格式、软删除约定）

---

## 0. 为什么先写这份文档

平台化的成败不取决于代码写得多快，而取决于**边界守得多严**。
vibe coding 产出快，但容易把依赖写乱、把场景逻辑漏进内核。
因此：**先钉约束，再开写。违反本规范的代码一律不合并。**

---

## 1. 架构总览：三层洋葱 + 单向依赖

```
┌──────────────────────────────────────────────────────────┐
│  scenarios/  场景产品层（易变，只组装不发明）                │
│  blog · content-api · saas · knowledge-base                │
│  ── 允许依赖：modules/*、kernel                             │
└────────────────────────┬─────────────────────────────────┘
                         │ 单向 ↓
┌────────────────────────▼─────────────────────────────────┐
│  modules/  能力模块层（垂直切分，可插拔）                    │
│  content · authz · storage · billing · workflow            │
│  ── 允许依赖：kernel、其他模块的【契约】                     │
│  ── 禁止：import 其他模块的实现、依赖 scenarios              │
└────────────────────────┬─────────────────────────────────┘
                         │ 单向 ↓
┌────────────────────────▼─────────────────────────────────┐
│  kernel/  内核层（最稳定，对场景无知）                       │
│  内容原语 · 事件总线 · 扩展点契约 · 身份/存储/搜索抽象        │
│  ── 允许依赖：仅第三方基础库（drizzle/zod/hono 的类型）      │
│  ── 禁止：import 任何 modules/scenarios、出现业务词汇        │
└──────────────────────────────────────────────────────────┘
```

**依赖方向铁律：`scenarios → modules → kernel`，永不反向。**

---

## 2. 四条宪法（违反即拒绝合并）

### 宪法一：依赖只能单向向内
- `kernel` **禁止** import `modules/` 或 `scenarios/`
- `modules` **禁止** import `scenarios/`
- `modules` 之间 **禁止** import 对方的**实现**，只能 import 对方的**契约**（`*/contract.ts`）
- **强制**：`eslint-plugin-boundaries` + CI

### 宪法二：内核只定义契约，不含实现
- `kernel/` 下**只允许**：类型/接口（`type`/`interface`）、抽象契约、事件定义、纯逻辑原语
- **禁止**在 kernel 出现具体存储实现、HTTP 路由、业务分支
- **自检**：kernel 里若 import 了 Hono `app`、Drizzle 具体表对象 → 越界

### 宪法三：模块间只发/订事件，不直接调用
- 模块 A 感知模块 B 的变化，**必须**通过事件总线
- 例：计费要感知"内容发布"，订阅 `content.entry.published`，**而非** `import { contentModule }`
- **自检**：`grep` 模块实现是否出现 `import ... from '../别的模块/'` → 越界

### 宪法四：内核不出现业务词汇
- kernel 中**禁止**出现：`article`、`blog`、`order`、`tenant`（业务义）、`published`（业务态）
- 内核只认识：`Entity`、`Field`、`Event`、`Principal`、`Store` 等**中性原语**
- **强制**：CI 对 `kernel/` 关键词扫描

---

## 3. 目录结构（强约定）

```
platform/
├── kernel/                        # 内核：稳定、通用、无知
│   ├── contracts/                 # 只有 interface，没有实现
│   │   ├── content.contract.ts    #   内容能力契约
│   │   ├── authz.contract.ts      #   权限能力契约
│   │   ├── storage.contract.ts    #   存储抽象（策略接口）
│   │   ├── search.contract.ts     #   搜索抽象（策略接口）
│   │   └── module.contract.ts     #   模块接入契约（扩展点）
│   ├── events/
│   │   ├── bus.ts                 #   事件总线实现（内核唯一实现）
│   │   └── types.ts               #   事件基类型
│   ├── primitives/
│   │   ├── entity.ts              #   内容原语：Entity/Field/FieldType
│   │   ├── portable-text.ts       #   富文本结构原语（Portable Text）
│   │   ├── portable-text.schema.ts#   Portable Text 的 Zod 校验
│   │   ├── principal.ts           #   主体原语：谁在操作
│   │   └── result.ts              #   统一 Result 类型
│   ├── registry.ts                #   模块注册表（扩展点插槽）
│   └── index.ts                   #   内核对外出口（唯一出口）
│
├── modules/                       # 能力模块：可插拔
│   ├── storage/                   #   存储能力（多数据库策略）
│   │   ├── contract.ts            #   引用内核存储契约
│   │   ├── factory.ts             #   策略工厂（唯一选择点）
│   │   ├── registry.ts            #   驱动注册表（进阶）
│   │   ├── drivers/
│   │   │   ├── sqlite.driver.ts   #     策略1（默认）
│   │   │   ├── postgres.driver.ts #     策略2
│   │   │   └── mysql.driver.ts    #     策略3
│   │   └── schema/
│   │       └── columns.ts         #   策略表（逻辑类型→方言类型）
│   ├── content/                   #   内容能力
│   │   ├── contract.ts
│   │   ├── index.ts               #   模块入口（实现 Module 契约）
│   │   ├── editor/                #   编辑器归一（写入时统一为 PortableText）
│   │   │   └── normalize.ts       #     fromMarkdown / fromBlockEditor
│   │   ├── render/                #   渲染器（结构 → HTML/其他，产物仅作缓存）
│   │   │   └── to-html.ts
│   │   └── internal/              #   内部实现（外部禁止 import）
│   ├── authz/                     #   权限能力
│   ├── billing/                   #   计费能力（阶段三）
│   └── workflow/                  #   工作流能力（阶段四）
│
├── scenarios/                     # 场景产品：只组装
│   ├── blog/
│   └── content-api/
│
├── web/                           # React 后台（Vite）
│   └── dist/                      #   构建产物 → 被 embed 进二进制
│
├── eslint.config.js               # 边界规则（宪法一/三的强制手段）
├── package.json
└── tsconfig.json                  # 路径别名 + 严格模式
```

---

## 4. 内核契约设计（关键代码骨架）

### 4.1 内容原语（内核不认识"文章"，只认识"实体"）

```ts
// kernel/primitives/entity.ts
export type FieldType =
  | 'text' | 'number' | 'boolean' | 'richText'
  | 'media' | 'relation' | 'select' | 'json';

export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  relationTo?: string;
  many?: boolean;
}

export interface EntityTypeDef {
  slug: string;              // 中性：'posts' 而非写死 'article'
  fields: FieldDef[];
  versioned?: boolean;
  locales?: string[];
  tenantScoped?: boolean;    // 预留多租户
}

export interface Entity {
  id: string;                // 应用层生成：UUIDv7（见 4.1.1）
  tenantId: string;          // 租户短 id（8 字符 base62）
  type: string;
  locale: string;
  status: string;            // 内核不限定取值
  data: Record<string, unknown>;
  createdAt: number;         // epoch 毫秒整数（见 6.5）
  updatedAt: number;
  deletedAt: number;         // 哨兵值：0=未删除，>0=删除时刻毫秒
}
```

#### 4.1.1 ID 原语（`kernel/primitives/id.ts`）

```ts
// 统一生成入口 —— 禁止在业务代码里散落 randomUUID()
import { randomUUID } from 'node:crypto';

/** 通用实体 id：UUIDv7（时间有序，索引友好） */
export function newId(): string {
  return uuidv7();                     // 用 uuid 库的 v7，或自实现（时间戳前缀 + 随机）
}

/** 租户 id：8 字符 base62（短、可读、可手抄；不可变） */
export function newTenantId(): string {
  return toBase62(randomBytes(6)).slice(0, 8);   // 落库前查重
}

/** 软删除语义封装（避免各处散落 `= 0` 判断） */
export const notDeleted = () => ({ deletedAt: 0 });   // 查询用 WHERE deleted_at = 0
export const markDeleted = () => ({ deletedAt: Date.now() });
```

> **为什么集中**：ID 形式是可替换策略（今天是 UUIDv7，明天可能换），集中一处便于统一调整；也便于 CI 扫描"业务代码里出现 `randomUUID`"。```

### 4.2 内容层类型：Portable Text（严格遵循规范）

> **铁律 1**：富文本字段存的是**严格遵循 Portable Text 规范**的结构化 JSON，**不存 HTML 字符串**。
> **铁律 2**：**不私自改动 PT 规范**（字段名、结构一律照办）。需要扩展时用规范的 `custom` 块机制。
> **铁律 3**：PT **只装叙述性文本**；任何需要查询/排序/聚合的数据，用 `EntityTypeDef` 普通字段。
> HTML 只是可再生的**缓存**，永远不能作为数据源。详见方案文档第 6 章。

```ts
// kernel/primitives/portable-text.ts
export type PortableText = PortableTextBlock[];

export type PortableTextBlock =
  | TextBlock
  | ImageBlock
  | CodeBlock
  | CustomBlock;

export interface TextBlock {
  _type: 'block';
  _key: string;
  style: 'normal' | 'h1' | 'h2' | 'h3' | 'blockquote';
  listItem?: 'bullet' | 'number';
  level?: number;
  children: Span[];
  markDefs?: MarkDef[];
}

export interface Span {
  _type: 'span';
  _key: string;
  text: string;
  marks?: string[];          // 'strong' | 'em' | markDef._key（如链接）
}

export interface MarkDef {
  _key: string;
  _type: 'link';
  href: string;              // 链接可存 url
}

/** 图片：必须存 asset 引用 ID，不存最终 URL（换 CDN 不影响数据） */
export interface ImageBlock {
  _type: 'image';
  _key: string;
  asset: { _ref: string };   // ← 引用 media 表的 id
  alt?: string;
  caption?: string;
}

export interface CodeBlock {
  _type: 'code';
  _key: string;
  language: string;
  code: string;
}

export interface CustomBlock {
  _type: 'custom';
  _key: string;
  name: string;              // 自定义块类型名
  value: Record<string, unknown>;
}
```

**Zod 校验（写入入口强制，结构不合法不入库）**：

```ts
// kernel/primitives/portable-text.schema.ts
import { z } from 'zod';

const spanSchema = z.object({
  _type: z.literal('span'),
  _key: z.string(),
  text: z.string(),
  marks: z.array(z.string()).optional(),
});

export const portableTextSchema = z.array(z.discriminatedUnion('_type', [
  z.object({ _type: z.literal('block'), _key: z.string(),
    style: z.enum(['normal','h1','h2','h3','blockquote']),
    children: z.array(spanSchema), markDefs: z.array(z.any()).optional() }),
  z.object({ _type: z.literal('image'), _key: z.string(),
    asset: z.object({ _ref: z.string() }), alt: z.string().optional() }),
  z.object({ _type: z.literal('code'), _key: z.string(),
    language: z.string(), code: z.string() }),
]));
```

**编辑器双模式归一（写入时统一）**：

```ts
// modules/content/editor/normalize.ts
// Markdown 编辑器 与 块编辑器 的产物，写入前统一归一为 PortableText
export function fromMarkdown(md: string): PortableText { /* ... */ }
export function fromBlockEditor(tree: BlockTree): PortableText { /* ... */ }
// 存储永远只有一种：PortableText。禁止两套格式并存。
```

### 4.3 存储策略接口（多数据库的核心抽象）

```ts
// kernel/contracts/storage.contract.ts
export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export interface StorageDriver {
  readonly dialect: Dialect;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface StorageTx {
  find<T>(spec: QuerySpec): Promise<T[]>;
  findOne<T>(spec: QuerySpec): Promise<T | null>;
  insert<T>(table: string, data: T): Promise<T>;
  update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;
  delete(table: string, id: string): Promise<void>;
}

export interface QuerySpec {
  table: string;
  where?: Record<string, unknown>;   // 方言无关条件
  orderBy?: { field: string; dir: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}
```

> **注意**：契约里**没有**任何 SQL、表名、方言字样。数据库是"实现细节"，通过策略模式隔离。

### 4.4 内容能力契约

```ts
// kernel/contracts/content.contract.ts
import type { Entity, EntityTypeDef } from '../primitives/entity';
import type { Principal } from '../primitives/principal';

export interface ContentService {
  defineType(def: EntityTypeDef): Promise<void>;
  find(query: {
    type: string; tenantId: string; locale?: string; status?: string;
    filter?: Record<string, unknown>; limit?: number; offset?: number;
  }): Promise<{ items: Entity[]; total: number }>;
  findOne(id: string, tenantId: string): Promise<Entity | null>;
  create(input: {
    type: string; tenantId: string; locale?: string;
    data: Record<string, unknown>; actor: Principal;
  }): Promise<Entity>;
  update(id: string, input: {
    tenantId: string; data: Partial<Record<string, unknown>>; actor: Principal;
  }): Promise<Entity>;
}
```

### 4.5 模块接入契约（扩展点插槽）

```ts
// kernel/contracts/module.contract.ts
import type { EventBus } from '../events/types';
import type { Registry } from '../registry';

export interface PlatformModule {
  name: string;                 // 'content' | 'storage' | 'authz' ...
  dependsOn?: string[];         // 只依赖名字，不依赖实现
  setup(ctx: {
    registry: Registry;
    events: EventBus;
    config: Record<string, unknown>;
  }): Promise<void>;
  teardown?(): Promise<void>;   // 保证可拔插
}
```

### 4.6 事件总线（内核唯一实现）

```ts
// kernel/events/types.ts
export interface DomainEvent<T = unknown> {
  name: string;                 // 'content.entry.published'
  tenantId: string;
  payload: T;
  occurredAt: number;           // epoch 毫秒整数
}

export interface EventBus {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  subscribe<T>(name: string, handler: (e: DomainEvent<T>) => Promise<void>): void;
}
```

**模块间协作示例**（计费感知内容发布，零直接 import）：
```ts
export const billingModule: PlatformModule = {
  name: 'billing',
  async setup({ events }) {
    events.subscribe('content.entry.published', async (e) => {
      await recordUsage(e.tenantId, 'publish', 1);
    });
  },
};
```

---

## 5. 策略模式规范（多实现解耦）

> 客户明确要求：**"多用抽象和策略模式解耦实现。"** 本章是其落地规范。

### 5.1 何时必须用策略模式

当存在"**同一能力，多种实现**"时，**必须**用策略模式，禁止 if/else：

| 能力 | 策略接口 | 实现 |
|------|---------|------|
| 数据库 | `StorageDriver` | SQLite / Postgres / MySQL |
| 全文搜索 | `SearchService` | FTS5 / tsvector / FULLTEXT |
| 缓存 | `CacheProvider` | 内存 / Redis / 无 |
| 文件存储 | `StorageProvider` | 本地 / S3 / OSS |
| 认证 | `AuthProvider` | 本地 / SSO / OAuth |

### 5.2 三件套写法（强制）

```ts
// ① 策略接口：定义在 kernel/contracts/
interface StorageDriver { /* ... */ }

// ② 策略实现：每个实现一个文件，互不 import
class SqliteDriver   implements StorageDriver { /* ... */ }
class PostgresDriver implements StorageDriver { /* ... */ }

// ③ 工厂/注册表：唯一知道"有哪些策略"的地方
export function createStorageDriver(cfg: StorageConfig): StorageDriver {
  switch (cfg.dialect) { /* ... */ }
}
// 进阶：注册表替代 switch —— 新增方言 = 新增文件，零修改
```

### 5.3 策略表模式（消灭类型映射的 if/else）

> **术语：什么是"策略表"**
> 本文档所说的**"策略表"**，指**用一张二维查找表（逻辑类型 × 数据库方言）代替 if/else 堆叠**的写法。
> 它是**策略模式的轻量版**——不写 class，用对象字面量当策略容器（`strategies[type][dialect]()`）。
> **作用**：消除"同一字段在各数据库下写法不同"的分支判断，让**列定义只在实体层写一次**，加类型/加数据库只改一处。
> 与 5.2 的区别：5.2 解决"选哪个驱动"（一个维度），5.3 解决"同语义字段在各方言怎么写"（两个维度）。
> 参见 cookbook P1.1「禁止 if/else 代替策略模式」。

```ts
// modules/storage/schema/columns.ts
const strategies: Record<LogicalType, Record<Dialect, () => ColumnBuilder>> = {
  uuid: {
    sqlite:   () => text('id'),
    postgres: () => uuid('id'),
    mysql:    () => char('id', { length: 36 }),
  },
  // ...
};
export const column = (t: LogicalType, name: string, d: Dialect) => strategies[t][d]()(name);
```

### 5.4 禁止事项

- ❌ 业务代码出现 `if (dialect === 'sqlite')` —— 说明解耦失败
- ❌ 契约泄漏方言特性（如把 PG 的 jsonb 查询写进 `StorageDriver`）
- ❌ 策略实现之间互相 import
- ✅ 变化点（方言）必须收敛到工厂/注册表**一处**

---

## 6. 技术栈约束（Bun 兼容 Node）

### 6.1 禁用 Bun 独有 API（硬约束）

| ❌ 禁用 | ✅ 改用 |
|--------|--------|
| `Bun.serve()` | Hono + `@hono/node-server` |
| `bun:sqlite` | `better-sqlite3` + Drizzle |
| `Bun.file` / `Bun.write` | `node:fs/promises` |
| `bun:test` | Vitest |
| `Bun.password` | `node:crypto` (scrypt) |
| `Bun.env` | `process.env` |

> **原则**：只写标准 TS + Node 标准库 + 跨端库。Bun 只当"更快的 runner 和包管理器"。
> **CI 检查**：扫描代码中是否出现上述禁用 API 的 import。

### 6.2 依赖引入规则

- 每个新依赖必须能回答"**为什么不能少**"。
- 内核层依赖必须**逐个人工批准**。
- 优先选**纯 JS 实现**（避免原生模块的跨平台/跨运行时问题）。

### 6.3 数据访问规范

- 所有表**必须**含 `tenant_id`（即使当前单租户）
- 所有查询**必须**经 `withTenant()` 包装器，禁止裸查
- **禁止裸写 SQL**（`sql\`...\``），必须走 Drizzle 方言无关 API
  - 例外：SQLite 的 `PRAGMA` 设置（见 6.4）

```ts
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
```

### 6.4 SQLite 必做配置

```ts
db.run(sql`PRAGMA journal_mode = WAL;`);
db.run(sql`PRAGMA busy_timeout = 5000;`);
db.run(sql`PRAGMA foreign_keys = ON;`);
```

### 6.5 跨方言统一约定

| 项 | 约定 |
|----|------|
| 主键 | 应用层生成：**租户用短 id（8 字符 base62）**，**其他实体用 UUIDv7**（`kernel/primitives/id.ts` 统一封装） |
| 时间 | **统一 epoch 毫秒整数**（`integer`/`bigint`）；对外 API 可序列化为 ISO 8601 |
| 软删除 | `deleted_at` **哨兵值法**：活跃=`0`，删除=真实毫秒；`UNIQUE(tenant_id, slug, deleted_at)` |
| JSON | Drizzle `mode:'json'` |
| 布尔 | Drizzle `boolean()` |
| UPSERT | Drizzle `.onConflictDoUpdate()` |

---

## 7. 内置组件规范

### 7.1 统一返回类型（不 throw，返回 Result）

```ts
// kernel/primitives/result.ts
export type Result<T, E = PlatformError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```
**理由**：跨模块调用不抛异常，错误作为值显式传递。

### 7.2 校验（Zod）

- 内核用 `FieldDef` 动态生成 Zod schema
- 富文本字段用 `portableTextSchema` 校验（见 4.2）
- 所有写入前校验，失败返回 `Result.err`

### 7.3 内容字段规范（铁律）

| 规则 | 说明 |
|------|------|
| **富文本存结构** | `richText` 字段的值是 `PortableText`（结构数组），**禁止存 HTML 字符串** |
| **严格遵循 PT 规范** | 字段名/结构照规范办，**不私自改动**；扩展走规范的 `custom` 块机制 |
| **PT 使用边界** | 只装叙述性文本；**可查询/排序/聚合的数据必须用普通字段** |
| **渲染产物仅作缓存** | HTML 必须能从结构再生，**禁止作为数据源** |
| **媒体存引用** | 图片等存 `asset._ref`（引用 ID），**禁止存最终 URL** |
| **编辑器归一** | Markdown / 块编辑器产物，写入前统一 `normalize` 为 PortableText |
| **多语言** | locale 是内容的一维，同一条内容的不同语言是独立记录 |
| **版本与状态** | 变更写 `entry_versions` 快照；状态机流转走内核原语 |

### 7.4 事件命名规范

格式：`<模块名>.<实体>.<动作>`
- ✅ `content.entry.published`、`authz.permission.granted`、`billing.usage.recorded`
- ❌ `publishArticle`、`onSave`、`event1`

---

## 8. 模块开发规范

### 8.1 模块必备结构

```
modules/<name>/
├── contract.ts     # 对外暴露的【接口】——别人只能看这个
├── index.ts        # PlatformModule 实现——内核只认这个
└── internal/       # 内部实现——禁止外部 import
```

### 8.2 模块自检清单（提交前逐条打勾）

- [ ] 没有 import 其他模块的 `internal/`
- [ ] 没有 import `scenarios/`
- [ ] 对外只暴露 `contract.ts` 的类型与 `index.ts` 的模块对象
- [ ] 跨模块通信全部走 `events`
- [ ] 多实现场景用了**策略模式**，无 `if (dialect===...)`
- [ ] 关掉本模块，平台仍能启动（**可拔插性**）
- [ ] 所有写入入口有 Zod 校验
- [ ] 数据访问都带 `tenantId` 过滤（**防串号**）
- [ ] 未使用 Bun 独有 API
- [ ] **富文本字段存 PortableText 结构，未存 HTML 字符串**
- [ ] **渲染产物未被当作数据源**
- [ ] **媒体引用存 asset ID，未存最终 URL**

### 8.3 可拔插性、策略切换与内容层测试（必须写）

```ts
test('平台可在仅加载 content+storage 时启动', async () => {
  const app = await bootstrap({ modules: ['content', 'storage'] });
  expect(app.isReady()).toBe(true);
});

test('同配置切换到 postgres 后端', async () => {
  const app = await bootstrap({ modules: ['content', 'storage'], dialect: 'postgres' });
  expect(app.storage.dialect).toBe('postgres');
});

test('富文本写入的是结构而非 HTML', async () => {
  const entry = await app.content.create({ /* richText 字段 */ });
  const body = entry.data.body;
  expect(Array.isArray(body)).toBe(true);           // 结构数组
  expect(typeof body).not.toBe('string');           // 不是 HTML 字符串
});

test('渲染产物可从结构再生', async () => {
  const html1 = renderToHtml(entry.data.body);
  const html2 = renderToHtml(entry.data.body);      // 重新渲染
  expect(html1).toBe(html2);                        // 幂等，结构是唯一真相
});
```

---

## 9. CI 检查清单（合并前必须全绿）

> **验收哲学：不做人工复核 diff，一切交给机器。** 静态问题靠 lint/扫描，逻辑问题靠单测，运行问题靠日志与启动测试。
> **效率原则：测试分层，日常只跑快的。** 重装备（启动/集成）只在关键节点上场，不拖累日常迭代。

### 9.0 测试分层与运行时机 ⭐

| 类型 | 定位 | 何时跑 | 耗时 | 出现在日常 CI？ |
|------|------|--------|------|----------------|
| **单元测试** | 主力：隔离、单点、无 IO | 每次提交 | 毫秒级 | ✅ 是 |
| **启动测试** | 程序能起 + 自检通过 | 里程碑 / 发版前 | 秒级 | ❌ 否 |
| **集成测试** | 跨组件、真连库、走真实流程 | 重要变更 / 发版前 | 秒~分钟级 | ❌ 否 |

| 触发场景 | 跑什么 |
|---------|--------|
| 每次 push / PR | **类型 + 单元测试**（快） |
| 合并 main / 打 tag | **+ 启动测试 + 集成测试** |
| 手动触发 | 全套 |

```jsonc
// 日常验证（高频，要快）
"verify":   "bun run typecheck && bun run test:unit"
// 关键节点（发版前，要全）
"verify:full": "bun run verify && bun run test:boot && bun run test:e2e"
```

### 9.1 静态检查（lint / 扫描）—— 每次提交

1. **构建**：`bun run build` 通过
2. **类型**：`tsc --noEmit` 零错误
3. **边界**：`eslint` 无 boundary 违规（宪法一/三）
4. **内核纯净**：`kernel/` 无业务词汇（宪法四）
5. **Bun 兼容**：无 Bun 独有 API 的 import
6. **无裸 SQL**：`modules/**` 无裸 SQL（PRAGMA 除外）
7. **无 if/else 方言分支**：业务层无 `dialect ===`（策略模式未被破坏）
8. **内容层铁律**：无"富文本字段存 HTML 字符串"；渲染产物未作数据源

### 9.2 单元测试 —— 每次提交（主力，必须小而快）

> **硬约束**：无真实 IO（不连库、不发 HTTP、不读 FS）、单点验证、目标 < 10ms。
> 外部依赖（存储/时间/随机数）一律用 fake 注入。**一旦连真实依赖，它就退化成集成测试。**

9. **覆盖率**：≥ 70%（内核 ≥ 90%）
10. **契约快照**：内核契约签名变更必须显式更新快照（防偷改契约）
11. **可拔插（单测口径）**：验证注册表能挂载/卸载模块（用 fake module）
12. **多方言（单测口径）**：验证工厂按 `dialect` 返回正确驱动（不真连库）
13. **内容结构**：断言富文本存的是数组（非字符串）、渲染幂等可再生（用 fake storage）

### 9.3 启动测试 + 日志 —— 关键节点

> **启动测试**（秒级，非高频）：`bun --compile` 出二进制后真跑一次——能启动、自检通过、`/health` 返回 200。
> **日志断言**：关键路径打印结构化日志并断言不变量；出现预期外 `ERROR`/`WARN` → 失败。

14. **启动自检**：启动时打印关键状态并校验，**不通过则启动失败（fail fast）**
    ```
    [kernel] 已加载契约: content, storage, authz
    [kernel] 已挂载模块: content, storage
    [storage] dialect = sqlite (WAL = on)
    [selfcheck] OK
    ```
15. **日志断言**：关键路径打印结构化日志并断言不变量
    ```
    [content] create entry type=posts tenant=default
    [content] richText 校验通过 (blocks=5)
    [event] published content.entry.published
    ```

### 9.4 集成测试 —— 关键节点（不常用）

> **原则：能不用就不用。** 只在"跨组件协作 / 真实数据库 / 完整流程"无法用单测覆盖时写，
> 且**不放进日常 CI**（只在合并 main、发版前跑）。

16. **集成测试**：如"真连 PG 完成一次内容 CRUD""多模块协同的事件流"，写入 `test/integration/`。

### 9.5 测试日志要求（两类日志之二）

跑测试时输出**结构化日志**，便于 AI 和 CI 直接定位：
```
✓ content.create 返回结构化 body (2ms)
✗ content.create 期望 Array，实际 string
    at test/unit/content.test.ts:42
    expected: Array(5)  received: "<p>hello</p>"
```

---

## 10. 落地顺序（先骨架后填充）

> 每完成一步，**立刻补上它对应的检查**（静态 + 单测即时补；启动/集成测试在里程碑补）。

| 步骤 | 产出 | 完成标志 | 同步补上的检查 |
|------|------|---------|--------------|
| 1 | 内核骨架 | 契约 + 事件总线 + 注册表 + **Portable Text 原语**，**无业务** | 边界规则、内核词汇扫描、契约快照 |
| 2 | 存储策略 | `StorageDriver` 契约 + SQLite 策略 + 工厂 | 无 if/else 扫描、**工厂单测** |
| 3 | 空内容模块 | content 模块挂载/卸载 | **注册表单测** |
| 4 | **验证架构** | 只加载模块子集能启动；**切方言能生效** | 启动自检 + **启动测试**（里程碑） |
| 5 | 填内容模块 | 内容 CRUD + **编辑器归一 + 渲染器** | **内容结构单测** |
| 6 | 后台与场景 | React 后台 + API + blog 跑通，**内核零改动** | **集成测试**（发版前） |
| 7 | 自包含交付 | 产出可执行文件 / 压缩包（目标机器零环境依赖） | 干净环境启动测试 |
| 8+ | 按需加模块/场景 | 每加一个，回头验证内核没被污染 |

> **第 4 步是分水岭**：若"拔掉模块平台仍能启动、切方言能生效"不成立，说明边界没守住，
> **此时返工成本最低**。务必先过这关再填肉。

---

## 11. 一句话总结

> 平台化 = **稳定的内核 + 可以拔掉的模块 + 只负责组装的场景**；
> 解耦 = **契约 + 策略模式 + 事件总线**；
> 内容 = **结构化存储（Portable Text）+ 渲染产物仅作缓存**。
> 本规范的全部目的，就是保证三者之间的依赖**永远单向、永远可替换**，
> 且**新增能力/方言/场景时，内核一行不改**；**内容永不被某一种呈现格式绑死**。
