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
# 安装依赖（Bun 只用于安装/构建）
bun install

# 日常验证（快：类型 + lint + 内核扫描 + 单测）
make verify

# 完整验证（里程碑：+ 启动测试 + 契约快照 + 交付测试）
make verify-full

# 本地运行（默认 SQLite，零配置；构建后用 Node 跑）
make build && PORT=3000 node dist/app.mjs

# 构建自包含交付物
make package          # → dist/headless-cms-<ver>.tar.gz（解压即用）
```

**HTTP API（阶段一已就绪）**：

```bash
# Content API（只读 · 匿名 · 可缓存）
curl http://localhost:3000/api/v1/posts              # 已发布列表
curl http://localhost:3000/api/v1/posts/hello-world  # 按 slug 读单篇

# Management API（写 · Bearer Token 守卫，token 由 MANAGE_TOKEN 环境变量配置）
curl -X POST http://localhost:3000/api/manage/v1/posts \
  -H "authorization: Bearer $MANAGE_TOKEN" -H "content-type: application/json" \
  -d '{"title":"第一篇","slug":"hello-world","body":[],"status":"published"}'
```

> **运行时说明**：`better-sqlite3` 原生模块**在 Bun 下不可用**，故**运行与测试链走 Node**；
> Bun 只用于依赖安装与打包。详见 [docs/vibe-cookbook.md](./docs/vibe-cookbook.md) P3.3。
>
> 数据库默认 SQLite；切换：`DB_DIALECT=postgres DB_URL=postgres://... node app.mjs`（PG/MySQL 驱动待补）。

## 备份与运维

```bash
make backup          # → backups/<时间戳>/
```

产出三组内容：`app.db`（**DB 一致性快照**，经 `VACUUM INTO` 生成——**服务运行中即可安全备份**，
无需停服）、`dump.json`（全表 JSON，可读可迁移）、`media/`（媒体文件），附 `manifest.json` 清单。

内容变更可经 Webhook 通知外部系统：

```bash
WEBHOOK_URL=https://example.com/hook node dist/app.mjs
# 或在管理端"系统设置"里配置 webhook.url（每租户独立）
```

## 项目结构

```
kernel/      内核：契约 + 事件总线 + 注册表 + 原语（对场景无知）
modules/     能力模块：storage / content / authz / search ...（可插拔）
scenarios/   场景产品：blog（只组装）
test/        分层测试：unit（日常）/ boot（里程碑）/ e2e（发版前）
scripts/     边界扫描：内核词汇 / 方言分支 / 契约快照
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/design.md](./docs/design.md) | **设计文档**：架构、选型、内容层、数据模型、路线 |
| [docs/engineering-spec.md](./docs/engineering-spec.md) | **工程规范**：四条宪法、目录结构、契约代码、CI 检查 |
| [docs/git-workflow.md](./docs/git-workflow.md) | **分支策略**：kernel/main 双长期分支、命名规范、内核把关 |
| [docs/vibe-cookbook.md](./docs/vibe-cookbook.md) | **AI 协作开发经验**：踩坑记录、有效/无效的提示 |
| [docs/dev-log.md](./docs/dev-log.md) | **开发记录**：按时间记录做了什么、为什么 |
| [docs/operations.md](./docs/operations.md) | **运维手册**：数据风险地图、备份/恢复演练、发版、监控清单 |
| [docs/backup-schedule.md](./docs/backup-schedule.md) | **定时备份**：crontab / systemd timer 两种装法与保留策略调参 |
| [CHANGELOG.md](./CHANGELOG.md) | **变更日志**：按版本记录对外变更 |

## 贡献约定

- **分支策略**：见 [docs/git-workflow.md](./docs/git-workflow.md)。内核走 `kernel` 分支，产品走 `main`，功能走前缀式短分支。
- 提交前必须通过 CI 全部检查（见工程规范第 9 章）。
- 违反"四条宪法"的代码一律不合并。
- 开发过程中的坑，请记录到 [docs/vibe-cookbook.md](./docs/vibe-cookbook.md)。
- 每个开发时段结束，在 [docs/dev-log.md](./docs/dev-log.md) 追加一条记录。

## License

TBD
