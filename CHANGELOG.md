# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **类型说明**：`Added` 新增 · `Changed` 变更 · `Deprecated` 弃用 · `Removed` 移除 · `Fixed` 修复 · `Security` 安全

---

## [Unreleased]

### Added
- 文档体系：`README.md`、`docs/dev-log.md`、`CHANGELOG.md`、`docs/vibe-cookbook.md`
- 设计文档 `docs/design.md`（v4）
- 工程规范 `docs/engineering-spec.md`（v3）
- **ID 策略定稿**：租户短 id（8 字符 base62，不可变）+ 其他实体 UUIDv7 + 租户表 id↔name 映射
- **时间格式定稿**：统一 epoch 毫秒整数
- **软删除定稿**：`deleted_at` 哨兵值法（活跃=0）+ `UNIQUE(tenant_id, slug, deleted_at)`
- **术语"策略表"**：在三处文档定义并互链（design 5.2 / engineering-spec 5.3 / cookbook P1.1）
- **项目定位红线**：单二进制为"部署方便"而非"极致省空间"；**方便直观 > 极致抠体积**（design 第0/4.4/8.1 章 + cookbook P3.2）

### Changed
- 富文本格式表述：由"兼容 Portable Text"改为**"严格遵循 Portable Text 规范"**
- 定位表述：约束由"部署极简/资源占用低"改为"**部署简单、依赖少、方便直观**"；清除各处"极致单文件/极致省空间"措辞
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
- 发布形态：`bun --compile` **单二进制**

---

## 版本规划（Roadmap）

| 版本 | 目标 | 内容 |
|------|------|------|
| v0.1.0 | 内核骨架 | 契约 + 事件总线 + 注册表 + 存储策略（SQLite） |
| v0.2.0 | 内容能力 | 内容模块 + Portable Text + Zod + Content API |
| v0.3.0 | 管理后台 | React 后台 + Management API |
| v0.4.0 | 单二进制 | `bun --compile` 发布 |
| v0.5.0 | 多端增强 | 缓存策略、API 版本化、多语言、媒体处理 |
| v1.0.0 | 稳定 | 第一个场景产品（博客）完整跑通 |
| v2.0.0 | 多租户 | SaaS 能力（视需求） |

---
