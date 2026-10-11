# 定时备份：crontab 与 systemd 两种装法

> 目标：`make backup-cron` 每天/每小时自动跑一次，备份 + 轮转一次做完。
> 详见 [operations.md](./operations.md)（含恢复演练流程）。

**唯一入口是 `scripts/backup-cron.mjs`**（或 `make backup-cron`）。
不要在 crontab 里把"备份"和"轮转"拆成两条命令——两者可能只成功一半，
备份成功但轮转没跑会把磁盘占满，轮转跑了但备份没成功等于净损失。

---

## 装法一：crontab（最简单）

```cron
# 每小时第 17 分跑一次（避开整点：整点是所有人都在跑备份的时刻）
17 * * * * cd /opt/headless-cms && /usr/bin/make backup-cron >> /var/log/cms-backup.log 2>&1

# 每天 03:17 额外做一次全量归档（若上文的 hourly 已够，可删掉这行）
17 3 * * * cd /opt/headless-cms && /usr/bin/make backup-cron >> /var/log/cms-backup.log 2>&1
```

要点：
- **用绝对路径**（`cd` + `/usr/bin/make`）：cron 的 PATH 极简，`node`/`make` 常常找不到。
- **错开整点**：整点是备份任务的拥堵时刻，磁盘 IO 争抢最明显。
- 退出码非 0 时 cron 会留下痕迹；日志里应有 `❌ 备份失败` 字样。

安装：

```bash
crontab -e    # 粘贴上面的行
```

## 装法二：systemd timer（推荐：失败可观测、可补跑）

`/etc/systemd/system/cms-backup.service`：

```ini
[Unit]
Description=Headless CMS 数据备份（含轮转）
# 备份前确保应用目录存在；不依赖应用进程在跑（VACUUM INTO 运行中也安全）

[Service]
Type=oneshot
WorkingDirectory=/opt/headless-cms
ExecStart=/usr/bin/make backup-cron
# 备份是低优先级 IO，避免与线上服务争抢
Nice=10
IOSchedulingClass=idle
# 只读源码目录，唯一可写的是备份目录
PrivateTmp=true
NoNewPrivileges=true
```

`/etc/systemd/system/cms-backup.timer`：

```ini
[Unit]
Description=每小时备份一次 Headless CMS

[Timer]
OnCalendar=*-*-* *:17:00
# 机器关机错过的任务，开机后补跑一次
Persistent=true
# 随机延迟，避免整点拥堵
RandomizedDelaySec=180

[Install]
WantedBy=timers.target
```

启用：

```bash
systemctl daemon-reload
systemctl enable --now cms-backup.timer
systemctl list-timers cms-backup.timer      # 确认下次触发时间
journalctl -u cms-backup.service -n 50     # 看备份日志
```

## 保留策略调参

默认值（小时 24 / 天 14 / 周 8 / 月 12，共约 58 份）：

```bash
# 只改天级，其他保持默认
make backup-rotate DRY=1          # 先看会删哪些
KEEP_HOURLY=48 KEEP_DAILY=30 make backup-rotate
```

覆盖 `KEEP_HOURLY` / `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` 环境变量，
或 `--hourly 48 --daily 30`。设为 `0` 即关闭该档。

**磁盘估算**：单份备份 ≈ DB 快照 + dump.json + 媒体文件。
若媒体占大头，优先把 `KEEP_HOURLY` 调小（小时级备份主要用于兜底，不值得留 24 份全量）。

## 验证定时任务真的在跑

```bash
systemctl start cms-backup.service        # 手动触发一次
ls -lt backups | head -3                   # 应出现新时间戳目录
cat backups/<最新>/manifest.json | head    # 确认表统计非空
```

## 告警建议

把这两条接进你的监控（任一命中即告警）：

- `backups/` 下最新备份的时间戳距今 > 2 × 备份周期 → **备份已停**（磁盘满、进程挂了、cron 没装）
- `backups/` 剩余可用空间 < 3 × 单份备份大小 → **轮转可能已失效**
