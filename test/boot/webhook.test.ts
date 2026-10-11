// Webhook 模块验证：事件投递、目标来源优先级、以及最重要的纪律——
// **投递失败绝不能连带破坏内容写入**（事件总线的 publish 会 await 订阅者）。

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { authzModule } from '@modules/authz/index.js';
import { settingsModule } from '@modules/settings/index.js';
import { webhookModule } from '@modules/webhook/index.js';
import { blogTypes } from '@scenarios/blog/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { SettingsService } from '@kernel/contracts/settings.contract.js';
import { Tokens } from '@kernel/registry.js';

const TENANT = 'tenant01';
const actor = { id: 'u1', tenantId: TENANT, kind: 'user' };

let app: App;
let server: Server | undefined;
let received: Array<Record<string, unknown>> = [];
let port = 0;

/** 起一个本地接收端（真实 socket，验证出站链路） */
async function startReceiver(status = 200): Promise<void> {
  received = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push(JSON.parse(body || '{}') as Record<string, unknown>);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
}

async function boot(opts: { url?: string } = {}): Promise<void> {
  app = await bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      authzModule({ jwtSecret: 'test-secret' }),
      contentModule(blogTypes),
      settingsModule(),
      webhookModule(opts.url ? { url: opts.url, timeoutMs: 1500 } : { timeoutMs: 1500 }),
    ],
    config: { tenantId: TENANT },
  });
}

const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);
const settings = (): SettingsService => app.registry.require<SettingsService>(Tokens.Settings);

const BODY = [
  { _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: 'x' }], markDefs: [] },
];

async function createEntry(): Promise<string> {
  const e = await content().create({
    type: 'posts', tenantId: TENANT, data: { title: 'webhook 测试', slug: 'wh-1', body: BODY }, actor,
  });
  return e.id;
}

afterEach(async () => {
  await app?.stop();
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  delete process.env['WEBHOOK_URL'];
});

describe('Webhook（事件总线的第二个消费者）', () => {
  it('创建 / 更新 / 删除各投递一次，事件名与载荷正确', async () => {
    await startReceiver();
    await boot({ url: `http://127.0.0.1:${port}/hook` });

    const id = await createEntry();
    await content().update(id, { tenantId: TENANT, data: { title: '改后' }, actor });
    await content().remove(id, TENANT, actor);

    await new Promise((r) => setTimeout(r, 50)); // 等出站完成（投递是同步 await 的，保险起见）

    expect(received.map((r) => r['name'])).toEqual([
      'content.entry.created',
      'content.entry.updated',
      'content.entry.deleted',
    ]);
    expect(received[0]?.['tenantId']).toBe(TENANT);
    const payload = received[0]?.['payload'] as Record<string, unknown>;
    expect(payload['id']).toBe(id);
    expect(payload['type']).toBe('posts');
  });

  it('未配置目标 → 静默跳过（不报错、不投递）', async () => {
    await startReceiver();
    await boot(); // 无 url、无 WEBHOOK_URL、无 settings 配置
    await createEntry(); // 不应抛异常
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(0);
  });

  it('目标可来自租户设置 webhook.url', async () => {
    await startReceiver();
    await boot();
    await settings().set(TENANT, 'webhook.url', `http://127.0.0.1:${port}/hook`);

    await createEntry();
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
  });

  it('目标返回 5xx：记录告警，但**内容写入仍成功**', async () => {
    await startReceiver(500);
    await boot({ url: `http://127.0.0.1:${port}/hook` });

    const id = await createEntry(); // 必须成功，不能被 webhook 失败拖累
    expect(id).toBeTruthy();
    expect(await content().findOne(id, TENANT)).not.toBeNull();
  });

  it('目标不可达（超时）：不影响写入', async () => {
    await startReceiver();
    await boot({ url: 'http://127.0.0.1:1/hook' }); // 端口 1，连接被拒/超时

    const id = await createEntry();
    expect(await content().findOne(id, TENANT)).not.toBeNull();
  });

  it('非 http(s) 协议被忽略（防 SSRF 走 file:// 等）', async () => {
    await startReceiver();
    await boot({ url: 'file:///etc/passwd' });
    await createEntry();
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(0); // 未投递，且写入照常成功
  });

  it('环境变量 WEBHOOK_URL 可作兜底来源', async () => {
    await startReceiver();
    process.env['WEBHOOK_URL'] = `http://127.0.0.1:${port}/hook`;
    await boot(); // 模块选项未给 → 回退到环境变量

    await createEntry();
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
  });
});
