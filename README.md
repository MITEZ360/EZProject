# Headless CMS Platform（自研无头内容管理平台）

> 一个**自研的、可延伸出多场景产品**的无头内容管理系统。
> 稳定的内核 + 可插拔的能力模块 + 只负责组装的场景产品，交付为**自包含包**（目标机器零环境依赖）。

---

## 这是什么

一个平台化的无头 CMS：
- **一个内核**，能延伸出博客、多端内容 API、SaaS、知识中台等不同产品。
- **架构上强制解耦**：内核 → 能力模块 → 场景产品，依赖单向向内。
- **交付自包含**：`bun --compile` 产出可执行文件（或 `make package` 出压缩包），**目标机器零环境依赖**，拷过去就能跑。

> **定位说明**：交付物追求的是**"目标机器不用装任何环境"（自包含）**，而非"必须是一个文件"。
> **单二进制只是首选实现，压缩包/容器同样可选**——谁更方便直观就选谁。本项目的本质是"**管理复杂度的平台**"——**方便与直观 > 极致抠体积**。

## 技术栈

| 层 | 选型 |
|----|------|
| 语言 / 运行时 | TypeScript + **Bun**（**必须兼容 Node**） |
| Web 框架 | Hono |
| ORM | Drizzle |
| 数据库 | **SQLite（默认）** / PostgreSQL / MySQL —— 策略模式切换 |
| 前端后台 | React + Vite（与后端共享类型） |
| 富文本格式 | **严格遵循 Portable Text 规范** |
| 交付 | **自包含**（单二进制 / 压缩包 / 容器），目标机器零环境依赖 |

## 架构速览

```
scenarios/  场景产品层（只组装，不发明）
     ↓ 依赖单向
modules/    能力模块层（可插拔：content/authz/storage/...）
     ↓ 依赖单向
kernel/     内核层（稳定，对场景无知：契约 + 事件总线 + 注册表）
```

**四条宪法**：① 依赖单向向内 ② 内核只定义契约 ③ 模块间只发订事件 ④ 内核无业务词汇。

详见 [docs/design.md](./docs/design.md)。

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式（前端热更 + 后端热重载）
make dev

# 构建自包含交付物（二选一）
make build            # 单二进制  → dist/app
make package          # 压缩包    → dist/headless-cms-<ver>.tar.gz

# 运行（把产物拷到目标机器，无需预装任何环境）
./dist/app
# 或
tar -xzf dist/headless-cms-<ver>.tar.gz && ./headless-cms
```

> 数据库默认 SQLite，零配置。
> 切换数据库：`DB_DIALECT=postgres DB_URL=postgres://... ./dist/app`

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/design.md](./docs/design.md) | **设计文档**：架构、选型、内容层、数据模型、路线 |
| [docs/engineering-spec.md](./docs/engineering-spec.md) | **工程规范**：四条宪法、目录结构、契约代码、CI 检查 |
| [docs/vibe-cookbook.md](./docs/vibe-cookbook.md) | **AI 协作开发经验**：踩坑记录、有效/无效的提示 |
| [docs/dev-log.md](./docs/dev-log.md) | **开发记录**：按时间记录做了什么、为什么 |
| [CHANGELOG.md](./CHANGELOG.md) | **变更日志**：按版本记录对外变更 |

## 贡献约定

- 提交前必须通过 CI 全部检查（见工程规范第 9 章）。
- 违反"四条宪法"的代码一律不合并。
- 开发过程中的坑，请记录到 [docs/vibe-cookbook.md](./docs/vibe-cookbook.md)。
- 每个开发时段结束，在 [docs/dev-log.md](./docs/dev-log.md) 追加一条记录。

## License

TBD
