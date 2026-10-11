// modules/webhook/index.ts
// Webhook 模块：把领域事件投递到外部 URL（事件总线的第二个真实消费者，
// 第一个是 audit）。通用能力，任何场景都可装配。
//
// 目标来源（优先级）：模块选项 `url` → 环境变量 `WEBHOOK_URL` → 租户设置 `webhook.url`。
//
// 两条纪律：
//  1. **投递失败绝不抛异常**——事件总线的 publish 会 await 订阅者，handler 抛错会
//     让内容写入一起失败。Webhook 是"通知"，不能成为主流程的单点故障。
//  2. 只投递 http/https（防 SSRF 走 file:// 等协议）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { SettingsService } from '@kernel/contracts/settings.contract.js';
import type { DomainEvent } from '@kernel/events/types.js';
import { Tokens } from '@kernel/registry.js';

export interface WebhookModuleOptions {
  /** 目标 URL；不传则依次回退到 WEBHOOK_URL、租户设置 webhook.url */
  url?: string;
  /** 单次投递超时（毫秒），默认 3000 */
  timeoutMs?: number;
  /** 订阅的事件名；默认内容写事件 */
  events?: string[];
}

const DEFAULT_EVENTS = [
  'content.entry.created',
  'content.entry.updated',
  'content.entry.deleted',
];

/** 结构化事件体：订阅方拿到的就是这份 JSON */
const bodyOf = (e: DomainEvent): string =>
  JSON.stringify({
    name: e.name,
    tenantId: e.tenantId,
    occurredAt: e.occurredAt,
    payload: e.payload,
  });

async function deliver(url: string, event: DomainEvent, timeoutMs: number): Promise<void> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    console.warn(`[webhook] 目标不是合法 URL：${url}`);
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    console.warn(`[webhook] 忽略非 http(s) 协议：${target.protocol}`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'headless-cms-webhook/1',
      },
      body: bodyOf(event),
      signal: controller.signal,
    });
    if (!res.ok) console.warn(`[webhook] 目标返回 ${res.status}：${target}`);
  } catch (e) {
    // 网络错误/超时/中止：仅告警，绝不抛出（否则会连带打断内容写入）
    console.warn(`[webhook] 投递失败（${target}）：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function webhookModule(options: WebhookModuleOptions = {}): PlatformModule {
  return {
    name: 'webhook',
    dependsOn: ['settings'], // 目标 URL 可存租户设置，需在其之后解析

    async setup({ registry, events }): Promise<void> {
      const settings = registry.get<SettingsService>(Tokens.Settings);
      const fromEnv = process.env['WEBHOOK_URL'];
      const timeoutMs = options.timeoutMs ?? 3000;

      const targetOf = async (tenantId: string): Promise<string | null> => {
        if (options.url) return options.url;
        if (fromEnv) return fromEnv;
        const item = await settings?.get(tenantId, 'webhook.url');
        return typeof item?.value === 'string' ? item.value : null;
      };

      for (const name of options.events ?? DEFAULT_EVENTS) {
        events.subscribe(name, async (e: DomainEvent) => {
          const url = await targetOf(e.tenantId);
          if (!url) return; // 未配置 → 静默跳过（不是错误）
          await deliver(url, e, timeoutMs);
        });
      }
    },
  };
}
