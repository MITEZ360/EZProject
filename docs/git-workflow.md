# Git 分支管理策略

> 定位：本项目的**协作契约**之一。任何提交、合并都必须遵循本文件。
> 版本：v1.0 · 2026-10
> 配套：分支保护规则 → 见 [engineering-spec.md](./engineering-spec.md) 第 9 章 CI 检查清单。

---

## 0. 一句话结论

**`kernel` 是内核的"上游真相"，`main` 是集成/发布主线；功能开发一律走前缀式短分支，经 PR 合回。`main` 永不直接改 `kernel/`。**

```
        ┌─────────────────────────────────────────────┐
        │  kernel（长期分支）—— 内核唯一演进线          │
        │  只装 kernel/ 目录；改动需额外把关              │
        └───────────────┬─────────────────────────────┘
                        │ ① 内核演进：feature → kernel
                        │ ② 定期反向同步：kernel → main
                        ▼
        ┌─────────────────────────────────────────────┐
        │  main（长期分支）—— 集成 + 发布主线            │
        │  可运行的产品基线；功能/场景在此合流            │
        └───────────────┬─────────────────────────────┘
                        │ ③ 功能/场景开发：main → feature/* → main
                        ▼
   feature/* · module/* · scenario/* · fix/* · docs/* · chore/*
```

**为什么这样分**：内核是"多年不动的地基"，产品是"频繁变化的上层"。把两者放在同一条长期分支上，
内核极易被产品需求"顺手改坏"。**物理分线**让"内核演进"和"产品迭代"各自有独立节奏，合流点受控。

---

## 1. 两类长期分支

| 分支 | 角色 | 允许的改动 | 生命周期 |
|------|------|-----------|---------|
| **`kernel`** | 内核唯一演进线（上游真相） | **仅 `kernel/` 目录**及其配套测试 | 长期 |
| **`main`** | 集成 + 发布主线 | 模块、场景、文档、配置、CI；**不直接改 `kernel/`** | 长期 |

> **铁律**：`main` 上**永远不出现直接修改 `kernel/` 的提交**。内核要变，必须走 `kernel` 分支，再反向同步回来。

**为什么 `main` 不改内核**：内核是"对场景无知"的稳定层（见四条宪法）。若允许产品分支随手改内核，
内核会逐渐渗入业务词汇、业务分支，最终失守。**把内核改动集中到一条分支，等于给内核装了一道闸门。**

---

## 2. 分支命名规范（前缀式）

| 前缀 | 用途 | 从哪切出 | 合回哪 | 示例 |
|------|------|---------|--------|------|
| `feature/` | 新功能（跨模块的能力） | `main` | `main` | `feature/portable-text-editor` |
| `module/` | 单个能力模块的开发 | `main` | `main` | `module/content-pt`、`module/authz-rbac` |
| `scenario/` | 场景产品组装 | `main` | `main` | `scenario/blog`、`scenario/multi-tenant` |
| `fix/` | 修 bug | `main`（或对应发布 tag） | `main` | `fix/entry-publish-race` |
| `docs/` | 纯文档 | `main` | `main` | `docs/git-workflow` |
| `chore/` | 构建/CI/依赖等杂项 | `main` | `main` | `chore/ci-bun-cache` |
| `kernel/` | **内核演进**（特殊） | `kernel` | `kernel` | `kernel/event-bus-v2` |

> **命名公式**：`<前缀>/<kebab-case-短描述>`。描述要能一眼看出"这条线在做什么"。
> 避免 `feature/update`、`fix/bug` 这类无信息命名。

**分支生命周期**：**短**。切出 → 开发 → PR → 合并 → **删除**。长期只保留 `kernel` 与 `main` 两条。

---

## 3. 内核演进流程（关键路径）

内核改动**唯一合法路径**：

```
kernel ──① 切出──▶ kernel/<描述> ──② 开发──▶ PR（额外把关）──③ 合回──▶ kernel
                                                                        │
                                                    ④ 定期反向同步 ▼
                                                                      main
```

**① 从 `kernel` 切出**，**不是**从 `main`。
**② 开发**：只改 `kernel/` 目录 + 同步更新契约快照与扫描规则。
**③ 合回 `kernel` 前，必须额外通过"内核把关"**（见第 5 章）：
   - 四条宪法扫描全绿；
   - **内核词汇扫描**：`kernel/` 内不得出现业务词汇；
   - **契约签名快照比对**：`interface` 变更需在 PR 描述里逐条说明"为什么内核必须变"；
   - 破坏性契约变更需给出**下游适配方案**。
**④ 反向同步 `kernel → main`**：内核稳定后，把 `kernel` 合并进 `main`（见第 4 章）。

> **判断标准**：一个改动"该进 `kernel` 还是 `main`"？
> 问自己：**它是否对"业务场景"无知？** 是 → 进 `kernel`；否 → 进模块/场景（`main`）。

---

## 4. 合流与同步规则

### 4.1 功能/场景 → main（常规路径）

```
main ──▶ feature/*（开发）──▶ PR ──▶ main
```
- PR 前必须先**同步 `main` 最新**（rebase 或 merge `main` 进来），保证 CI 在最新基线上跑。
- 合并方式：**Squash merge 优先**（每条功能线在 `main` 上留一个干净提交），历史清晰。

### 4.2 kernel → main（内核反向同步）

```
kernel ──▶ main
```
- **时机**：内核演进稳定、已通过内核把关后；或 `main` 需要新契约时。
- 方式：**`main` 合并 `kernel`**（merge，保留内核演进历史）。
- **冲突处理**：若 `main` 上有人"违规改过 `kernel/`"，此处会冲突——**以 `kernel` 为准**，并回滚 `main` 上的违规改动。

### 4.3 main → kernel（禁止反向灌业务）

**禁止**把 `main` 上的业务代码合并进 `kernel`。
内核**只接受** `kernel/*` 分支的演进——否则业务就会渗进内核。

> **一句话**：`kernel → main` 是允许且定期的；`main → kernel` 是**禁止**的。

---

## 5. 内核分支的保护（严格把关）

`kernel` 分支启用**最严格的分支保护**（本地可用 git hook 近似，远程用仓库规则）：

| 保护项 | 规则 |
|--------|------|
| 直推 | **禁止**直接 push，必须走 PR |
| 审批 | 内核改动需**至少 1 次显式复核**（AI 改动 → 人工确认"内核确实必须变"） |
| CI 门禁 | 四条宪法扫描 + 内核词汇扫描 + 契约快照比对**全绿** |
| 变更说明 | PR 描述**必须**回答："内核为什么必须改？不改行不行？" |
| 破坏性变更 | `interface` 有 breaking change 时，必须附**下游适配清单** |

> **反例**：为了给某产品加个字段，顺手在 `kernel/primitives/entity.ts` 加业务属性——**直接拒绝**。
> 正确做法：字段属于 `EntityTypeDef`（数据驱动），内核原语**零改动**。

---

## 6. 提交信息规范

采用 **Conventional Commits**，与 CHANGELOG 生成衔接：

```
<type>(<scope>): <描述>

<body>（可选：为什么这么做）

<footer>（可选：关联 issue / BREAKING CHANGE）
```

| type | 含义 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(content): Portable Text 校验` |
| `fix` | 修 bug | `fix(storage): 修 SQLite WAL 配置` |
| `docs` | 文档 | `docs(git-workflow): 分支策略` |
| `refactor` | 重构（不改行为） | `refactor(kernel): 抽离事件总线` |
| `test` | 测试 | `test(content): 补 PT 归一用例` |
| `chore` | 构建/CI/依赖 | `chore(ci): 加内核词汇扫描` |

**scope 建议对齐架构层级**：`kernel` / `content` / `storage` / `authz` / `blog`（场景）等。

> **BREAKING CHANGE**：写在内核契约上时，footer 必须显式标注，触发 CHANGELOG 的大版本提示。

---

## 7. 与 CI / 测试分层的衔接

不同合流点，跑不同强度的检查（呼应工程规范第 9 章"测试分层"）：

| 触发点 | 必须通过的检查 |
|--------|--------------|
| 任意分支 push | 类型检查 + 单元测试（**日常，快**） |
| PR → `main` | 上述 + **启动测试**（里程碑级） |
| PR → `kernel` | 上述 + **内核词汇扫描 + 契约快照比对**（内核专属） |
| 合并 `main` / 打 tag | **+ 集成测试**（发版前，慢） |

> **原则**：日常低频分支只跑快检查；**慢测试只在 `main` 合并 / 打 tag 时跑**（见 cookbook P4.2）。

---

## 8. 场景速查（我该怎么做？）

| 我要做什么 | 从哪切 | 合回哪 | 额外动作 |
|-----------|--------|--------|---------|
| 加一个能力模块 | `main` | `main` | 确保只依赖契约，不碰其他模块实现 |
| 组装一个场景产品 | `main` | `main` | 内核应**零改动**（否则说明内核设计有问题，走内核流程） |
| 修业务 bug | `main` | `main` | — |
| **改内核契约** | `kernel` | `kernel` → 定期同步 `main` | **内核把关**（第 5 章） |
| 改文档 | `main` | `main` | — |
| 加/改 CI | `main` | `main` | 若是"内核扫描规则"相关，同步 `kernel` |

---

## 9. 最小可用的落地步骤（本地）

```bash
# 初始化：创建 kernel 长期分支（从 main 切出，初始与 main 同点）
git checkout main
git branch kernel
git push -u origin kernel

# 场景一：开发一个功能模块（常规）
git checkout main && git pull
git checkout -b module/content-pt
# ... 开发 ...
git commit -m "feat(content): Portable Text 结构校验"
git push -u origin module/content-pt
# → 开 PR，合回 main，删除该分支

# 场景二：演进内核（特殊，从 kernel 切）
git checkout kernel && git pull
git checkout -b kernel/event-bus-v2
# ... 只改 kernel/ 目录 ...
git commit -m "refactor(kernel): 事件总线支持通配订阅"
git push -u origin kernel/event-bus-v2
# → 开 PR 合回 kernel（过内核把关）

# 场景三：内核反向同步到 main（定期）
git checkout main && git pull
git merge kernel        # 保留同步历史
git push origin main
```

> **注意**：本项目目前为本地仓库、无远程。以上 `origin` 操作在**接入远程仓库后**生效；
> 在此之前，分支规范依然适用，只是 push/PR 改为本地合并。

---

## 10. 常见错误（禁止清单）

- ❌ **在 `main` 上直接改 `kernel/`** —— 内核改动必须走 `kernel` 分支。
- ❌ **从 `main` 切内核分支** —— 内核分支必须从 `kernel` 切，否则会带上业务代码。
- ❌ **把业务分支合进 `kernel`** —— `main → kernel` 禁止。
- ❌ **长期不删除功能分支** —— 短分支用完即删，避免堆积。
- ❌ **无描述的分支名** —— `feature/update`、`fix/a` 这种一律打回。
- ❌ **内核 PR 不写"为什么必须改内核"** —— 内核把关不通过。

---

> **一句话总纲**：**内核走 `kernel`、产品走 `main`、功能走短分支；`kernel → main` 定期同步，反向禁止。**
