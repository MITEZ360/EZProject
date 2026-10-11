// modules/content/internal/service.ts
// ContentService 的最小实现：以 StorageDriver 为底座。
// 类型定义是数据（决策 #26 逻辑 Schema）：落 content_types 表，读写经驱动。
// 内部实现——禁止外部 import。

import type { Entity, EntityTypeDef } from '@kernel/primitives/entity.js';
import type { Principal } from '@kernel/primitives/principal.js';
import type {
  ContentCreateInput,
  ContentPage,
  ContentQuery,
  ContentService,
  ContentUpdateInput,
} from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { EventBus } from '@kernel/events/types.js';
import { newId, notDeleted } from '@kernel/primitives/id.js';
import { platformError, type Result, ok, err } from '@kernel/primitives/result.js';
import { validateEntityData, validateTypeDef } from './validate.js';

const TABLE = 'entries';
const TYPES_TABLE = 'content_types';

interface EntryRow {
  id: string;
  tenantId: string;
  type: string;
  slug?: string;
  locale: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
}

interface ContentTypeRow {
  id: string;
  tenantId: string;
  slug: string;
  schema: EntityTypeDef;
  createdAt: number;
  updatedAt: number;
}

export function createContentService(driver: StorageDriver, events?: EventBus): ContentService {
  const svc = {
    /** 定义/更新内容类型：落 content_types（逻辑 Schema，不迁移旧数据）。
     *  actor.tenantId 为 '*' 时写入通配定义（代码内建类型的种子）。 */
    async defineType(def: EntityTypeDef, actor: Principal): Promise<void> {
      const problems = validateTypeDef(def);
      if (problems.length > 0) {
        throw mapError(platformError('E_VALIDATION', `类型定义非法: ${def.slug}`, { issues: problems }));
      }
      const tenantId = actor.tenantId;
      const now = Date.now();
      await driver.transaction(async (tx) => {
        const existing = await tx.findOne<ContentTypeRow>({
          table: TYPES_TABLE,
          where: { tenantId, slug: def.slug },
        });
        if (existing) {
          await tx.update<ContentTypeRow>(TYPES_TABLE, existing.id, {
            schema: def,
            updatedAt: now,
          });
        } else {
          await tx.insert(TYPES_TABLE, {
            id: newId(),
            tenantId,
            slug: def.slug,
            schema: def,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
    },

    async listTypes(tenantId: string): Promise<EntityTypeDef[]> {
      // 精确租户 + '*' 通配（内建类型）；QuerySpec 仅等值，两次查询合并
      const [own, wildcard] = await Promise.all([
        driver.transaction((tx) =>
          tx.find<ContentTypeRow>({ table: TYPES_TABLE, where: { tenantId } })
        ),
        tenantId === '*'
          ? Promise.resolve([])
          : driver.transaction((tx) =>
              tx.find<ContentTypeRow>({ table: TYPES_TABLE, where: { tenantId: '*' } })
            ),
      ]);
      const seen = new Set<string>();
      return [...own, ...wildcard]
        .filter((r) => (seen.has(r.slug) ? false : (seen.add(r.slug), true)))
        .map((r) => r.schema);
    },

    async getType(slug: string, tenantId: string): Promise<EntityTypeDef | null> {
      return svc.loadTypeDef(slug, tenantId); // 闭包自引用（解构安全，同 svc 约定）
    },

    /** 类型解析：先精确租户，再 '*' 通配（代码内建类型种子） */
    async loadTypeDef(slug: string, tenantId: string): Promise<EntityTypeDef | null> {
      const row = await driver.transaction((tx) =>
        tx.findOne<ContentTypeRow>({ table: TYPES_TABLE, where: { tenantId, slug } })
      );
      if (row) return row.schema;
      const wildcard = await driver.transaction((tx) =>
        tx.findOne<ContentTypeRow>({ table: TYPES_TABLE, where: { tenantId: '*', slug } })
      );
      return wildcard?.schema ?? null;
    },

    async find(query: ContentQuery): Promise<ContentPage> {
      const where: Record<string, unknown> = {
        ...notDeleted(),
        tenantId: query.tenantId,
        type: query.type,
      };
      if (query.locale) where['locale'] = query.locale;
      if (query.status) where['status'] = query.status;

      // 单事务内完成"取分页数据 + 计数"：total 与 items 保证同一一致性视图。
      // 计数用 tx.count（SQL COUNT），禁止全量取回再取 length。
      // filters（决策 #26：自定义字段等值/范围/包含）find 与 count 必须同一套。
      return driver.transaction(async (tx) => {
        const [items, total] = await Promise.all([
          tx.find<EntryRow>({
            table: TABLE,
            where: { ...where, ...(query.filter ?? {}) },
            filters: query.filters,
            orderBy: [{ field: 'createdAt', dir: 'desc' }],
            limit: query.limit ?? 20,
            offset: query.offset ?? 0,
          }),
          tx.count({ table: TABLE, where, filters: query.filters }),
        ]);
        return { items: items as unknown as Entity[], total };
      });
    },

    async findOne(id: string, tenantId: string): Promise<Entity | null> {
      const row = await driver.transaction((tx) =>
        tx.findOne<EntryRow>({ table: TABLE, where: { id, tenantId, ...notDeleted() } })
      );
      return (row as unknown as Entity) ?? null;
    },

    async create(input: ContentCreateInput): Promise<Entity> {
      const typeDef = await svc.loadTypeDef(input.type, input.tenantId);
      if (!typeDef) {
        throw mapError(platformError('E_TYPE_UNKNOWN', `未定义的内容类型: ${input.type}`));
      }
      const check = validateEntityData(typeDef, input.data);
      if (!check.ok) {
        throw mapError(
          platformError('E_VALIDATION', '内容校验失败', { issues: check.issues })
        );
      }

      const now = Date.now();
      const entity = {
        id: newId(),
        tenantId: input.tenantId,
        type: input.type,
        slug: typeof input.data['slug'] === 'string' ? input.data['slug'] : undefined,
        locale: input.locale ?? 'default',
        status: typeof input.data['status'] === 'string' ? input.data['status'] : 'draft',
        data: input.data,
        createdAt: now,
        updatedAt: now,
        deletedAt: 0,
      };
      await driver.transaction((tx) => tx.insert(TABLE, entity));
      await emit('created', entity, input.actor);
      return entity as unknown as Entity;
    },

    async update(id: string, input: ContentUpdateInput): Promise<Entity> {
      // 通过闭包引用 svc 而非 this：方法被解构/作为回调传递时依然安全。
      const current = await svc.findOne(id, input.tenantId);
      if (!current) {
        throw mapError(platformError('E_NOT_FOUND', `条目不存在: ${id}`));
      }
      const typeDef = await svc.loadTypeDef(current.type, input.tenantId);
      if (typeDef) {
        const check = validateEntityData(typeDef, { ...current.data, ...input.data });
        if (!check.ok) {
          throw mapError(
            platformError('E_VALIDATION', '内容校验失败', { issues: check.issues })
          );
        }
      }
      const patch: Record<string, unknown> = {
        data: { ...current.data, ...input.data },
        updatedAt: Date.now(),
      };
      const updated = await driver.transaction((tx) =>
        tx.update<EntryRow>(TABLE, id, patch)
      );
      await emit('updated', updated, input.actor);
      return updated as unknown as Entity;
    },

    async remove(id: string, tenantId: string, actor: Principal): Promise<void> {
      const current = await svc.findOne(id, tenantId);
      if (!current) {
        throw mapError(platformError('E_NOT_FOUND', `条目不存在: ${id}`));
      }
      // 软删除：写哨兵值的反面（真实毫秒）
      const removed = await driver.transaction((tx) =>
        tx.update<EntryRow>(TABLE, id, { deletedAt: Date.now(), updatedAt: Date.now() })
      );
      await emit('deleted', removed, actor);
    },
  };

  /** 领域事件（宪法三）：audit 等模块订阅这些名字，content 不知道谁在听 */
  const emit = async (
    action: 'created' | 'updated' | 'deleted',
    entry: EntryRow,
    actor: Principal
  ): Promise<void> => {
    if (!events) return;
    await events.publish({
      name: `content.entry.${action}`,
      tenantId: entry.tenantId,
      occurredAt: Date.now(),
      payload: { id: entry.id, type: entry.type, slug: entry.slug, actorId: actor.id },
    });
  };

  return svc;
}

/** 统一把内核错误包成标准 Error（服务层供内部使用；对外 API 层再包 Result） */
function mapError(e: { code: string; message: string; details?: Record<string, unknown> }): Error {
  const issues = e.details?.['issues'];
  const suffix = Array.isArray(issues) && issues.length > 0
    ? `：${issues.map((i) => (i as { message: string }).message).join('；')}`
    : '';
  const error = new Error(`[content] ${e.message}${suffix}`);
  error.name = e.code;
  return error;
}

/** 服务层内部 Result 便捷（保留给 API 层） */
export type ServiceResult<T> = Result<T>;
export { ok, err };
