// modules/search/index.ts
// 全文检索模块（通用能力）。
// 契约见 kernel/contracts/search.contract.ts（引擎无关）；本模块提供 SQLite FTS5 策略。
//
// 索引同步：订阅 content 的领域事件（宪法三——只听事件名，不 import content 实现；
// 回查实体经内核 ContentService 契约）。事件总线 publish 会 await 订阅者，
// 故索引与内容写入是**强一致**的（写完即可被搜到）。
//
// 全量构建：启动时若索引为空则自动建（首次启用搜索时库中已有内容）；
// 环境变量 SEARCH_REINDEX=1 可强制重建（换切分策略或索引损坏后）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { SearchProvider } from '@kernel/contracts/search.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { DomainEvent } from '@kernel/events/types.js';
import { Tokens } from '@kernel/registry.js';
import { SEARCH_DDL, createSqliteSearch } from './internal/sqlite-fts.js';

export interface SearchModuleOptions {
  /** 检索策略；默认 'sqlite-fts5'（SQLite 内置扩展，零依赖） */
  provider?: 'sqlite-fts5';
  /** 启动时索引为空则自动全量构建，默认 true */
  autoIndexOnEmpty?: boolean;
}

/** 全量遍历的批大小 */
const REINDEX_BATCH = 200;

async function hasAnyIndex(driver: StorageDriver): Promise<boolean> {
  const rows = await driver.transaction((tx) =>
    tx.query<{ n: number }>('SELECT count(*) AS n FROM search_index')
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** 全量重建某租户的索引（分页遍历所有类型的所有条目） */
async function reindexTenant(
  content: ContentService,
  provider: SearchProvider,
  tenantId: string
): Promise<number> {
  const types = await content.listTypes(tenantId);
  let total = 0;
  for (const t of types) {
    let offset = 0;
    for (;;) {
      const page = await content.find({ type: t.slug, tenantId, limit: REINDEX_BATCH, offset });
      for (const entity of page.items) {
        await provider.index(t.slug, entity.id, entity as unknown as Record<string, unknown>);
        total += 1;
      }
      if (page.items.length < REINDEX_BATCH) break;
      offset += REINDEX_BATCH;
    }
  }
  return total;
}

export function searchModule(options: SearchModuleOptions = {}): PlatformModule {
  return {
    name: 'search',
    dependsOn: ['storage', 'content'],

    async setup({ registry, events, config }): Promise<void> {
      const driver = registry.require<StorageDriver>(Tokens.Storage);
      const content = registry.require<ContentService>(Tokens.Content);

      // 私有表：FTS5 虚拟表（DDL 经契约允许的原生通道）
      await driver.transaction((tx) => tx.exec(SEARCH_DDL));

      const provider = createSqliteSearch(driver);
      registry.provide<SearchProvider>(Tokens.Search, provider);

      const tenantId = (config['tenantId'] as string | undefined) ?? 'default';

      // ---------- 增量：订阅内容事件 ----------
      const indexOne = async (e: DomainEvent): Promise<void> => {
        const p = (e.payload ?? {}) as { id?: string; type?: string };
        if (!p.id || !p.type) return;
        const entity = await content.findOne(p.id, e.tenantId);
        if (entity) {
          await provider.index(p.type, p.id, entity as unknown as Record<string, unknown>);
        }
      };
      const dropOne = async (e: DomainEvent): Promise<void> => {
        const p = (e.payload ?? {}) as { id?: string; type?: string };
        if (p.id && p.type) await provider.remove(p.type, p.id);
      };
      events.subscribe('content.entry.created', indexOne);
      events.subscribe('content.entry.updated', indexOne);
      events.subscribe('content.entry.deleted', dropOne);

      // ---------- 全量：启动时按需构建 ----------
      if (options.autoIndexOnEmpty !== false) {
        const force = process.env['SEARCH_REINDEX'] === '1';
        // 失败不阻塞启动：搜索不可用不应导致整个服务起不来
        try {
          if (force || !(await hasAnyIndex(driver))) {
            const n = await reindexTenant(content, provider, tenantId);
            if (n > 0) console.log(`[search] 已建立索引：${n} 条`);
          }
        } catch (e) {
          console.warn(`[search] 索引初始化失败（搜索可能不完整）：${(e as Error).message}`);
        }
      }
    },
  };
}
