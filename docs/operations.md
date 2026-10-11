# 运维手册（备份 / 恢复 / 发版）

> 面向"部署完这个系统之后，怎么让它一直活着并且出事能救回来"。
> 相关：[backup-schedule.md](./backup-schedule.md)（定时备份装法）、[design.md](./design.md) 第 8 章（交付形态）。

---

## 1. 心智模型：这套系统的数据风险在哪

| 数据 | 在哪 | 丢了会怎样 | 保护手段 |
|------|------|-----------|---------|
| 内容（entries） | DB `entries` 表 | 站点内容全丢 | 备份 + 版本历史 |
| 类型定义 | DB `types` 表 | 后台渲染结构全丢 | 备份（它也能从代码种子重建） |
| 用户与角色 | DB `auth_users` / `auth_roles` | 没人能登录 | 备份 |
| 媒体文件 | `data/media/` | 图片全丢（**DB 里只剩引用 ID**） | 备份（快照 + 媒体目录一起） |
| 审计日志 | DB `audit_logs` | 追溯不了 | 备份 |

**最容易被忽略的是媒体**：内容里存的只是 asset id，DB 备份**不含图片字节**。
只备 DB 不备媒体，等于内容全在、图全裂——所以 `backup.mjs` 两件事一起做，不要拆开用。

## 2. 备份

```bash
make backup                              # 手动备一次
make backup-list                         # 看有哪些备份
make backup-inspect DIR=backups/<时间戳>  # 看某份备份的详细清单
```

产物结构（`backups/20261011-203116/`）：

| 文件 | 用途 |
|------|------|
| `app.db` | `VACUUM INTO` 一致性快照 —— **恢复就靠它** |
| `dump.json` | 全表 JSON —— 快照坏了时的重建路线，也便于人工核对/diff |
| `media/` | 媒体文件原样拷贝 |
| `manifest.json` | 清单：来源、时间、各表行数、快照字节数 |

**为什么用 `VACUUM INTO` 而不是 `cp app.db`**：服务运行中 `cp` 可能拷到写了一半的页，
拿到的是一个损坏的库。`VACUUM INTO` 在事务内完成，**不停服也安全**。

定时化见 [backup-schedule.md](./backup-schedule.md)。

## 3. 恢复

**恢复是唯一会破坏现有数据的操作**，所以流程强制"先演练、再留底、后覆盖"：

```bash
make backup-list                                    # 1. 找一份备份
make backup-inspect DIR=backups/20261011-203116     # 2. 看清单，确认是不是你要的那份
make restore-dry DIR=backups/20261011-203116       # 3. 演练：只看计划，不动数据
make restore DIR=backups/20261011-203116            # 4. 执行（自动先演练一次）
make restore DIR=backups/20261011-203116 YES=1      # 4'. 自动化场景跳过交互确认
```

执行时会发生什么：

1. **快照校验**：`integrity_check` + 逐表 `count(*)` 真读一遍。
   任一失败 → **拒绝恢复**，生产库分毫未动。
2. **恢复前留底**：现有库先 `VACUUM INTO` 成 `pre-restore-<时间戳>.db`（同目录）。
   这是你的**回退路径**，恢复完也别急着删。
3. 覆盖 DB 快照（先删旧文件再拷，中断不会留半截文件）。
4. 恢复媒体（先拷到 `.restoring` 临时目录再换名式替换）。
5. **恢复后自检**：逐表比对行数与清单，差异会明确列出来。

恢复后**需要重启服务**才能读到新数据。

### 回退

```bash
cp data/pre-restore-20261011-204512.db data/app.db   # 把留底拷回原位
```

### 什么时候不该用快照，改走 dump.json

`app.db` 损坏到无法打开、但 `dump.json` 完好时：dump.json 里有全部表数据，
可以据此重建库（需要自己按各表 DDL 建表）。这比"什么都没有"好，但属于手工活，
**所以平时就该演练恢复，而不是等出事才第一次试。**

## 4. 定期演练

建议每月一次，写进日历：

```bash
make restore-dry DIR=$(ls backups | tail -1)    # 至少演练
# 更好：完整恢复到临时库并抽查数据
node scripts/restore.mjs backups/<时间戳> --db /tmp/verify.db --yes
```

**没有演练过的备份等于没有备份。** 真正需要它的时候才发现打不开，是最糟的时机。

## 5. 发版

```bash
# 1. 改 package.json 版本 → 合入 main（等 CI 绿灯）
# 2. 打 tag（触发 .github/workflows/release.yml）
git tag v0.1.0 && git push origin v0.1.0
```

Release 流水线会：校验 tag 与 `package.json` 版本一致（不一致直接拒绝发布）→
`make verify-full` → `make package` → 隔离目录解压自检 → 附带校验和创建 GitHub Release。

也可以手动触发：GitHub Actions → Release → Run workflow，填版本号。

> **不要在未通过 CI 的提交上打 tag。** Release 流水线会自己重跑一遍完整验证，
> 所以绕过 CI 打 tag 只会得到一个红色发版，不会更快。

## 6. 监控清单

| 指标 | 阈值 | 说明 |
|------|------|------|
| 最新备份时间距今 | > 2 × 备份周期 | 备份已停（磁盘满 / cron 没装 / 进程挂了） |
| `backups/` 可用空间 | < 3 × 单份备份大小 | 轮转可能已失效 |
| 服务 `/healthz` | 非 200 | 服务不可用 |
| 磁盘使用率 | > 85% | SQLite 写入会因空间不足失败 |

## 7. 常见故障

| 现象 | 原因 | 处理 |
|------|------|------|
| 启动报 `Cannot open database because the directory does not exist` | 老版本缺陷 | 现已自动建父目录；确认用的是新版本 |
| 备份报 `output file already exists` | 同一秒内重复备份（旧版秒级时间戳） | 已修（毫秒 + 序号兜底）；确认脚本是新版 |
| 恢复报"快照未通过完整性检查" | 备份本身已损坏 | 换一份；或走 `dump.json` 重建路线 |
| 恢复成功但数据是旧的 | 以为备份时间点不对 | 看 `manifest.json` 的 `createdAt`；确认恢复后重启了服务 |
| PG 上写入报整数溢出 | 用了未声明式建表的旧模块 | 全部改声明式建表后需重建表 |
