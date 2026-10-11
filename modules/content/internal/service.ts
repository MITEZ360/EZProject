// modules/content/internal/service.ts
// ContentService 的最小实现：以 StorageDriver 为底座。
// 内部实现——禁止外部 import。

import type { Entity, EntityTypeDef } from '@kernel/primitives/entity.js';
import type {
  ContentCreateInput,
  ContentPage,
  ContentQuery,
  ContentService,
  ContentUpdateInput,
} from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import { newId, notDeleted } from '@kernel/primitives/id.js';
import { platformError, type Result, ok, err } from '@kernel/primitives/result.js';
import { validateEntityData } from './validate.js';

const TABLE = 'entries';

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

export function createContentService(
  driver: StorageDriver,
  getTypeDef: (type: string, tenantId: string) => EntityTypeDef | undefined
): ContentService {
  return {
    async defineType(): Promise<void> {
      // 类型定义由 content 模块在 setup 时通过内部注册表管理；
      // 此处保留契约方法（阶段一先内存态，后续落 content_types 表）。
    },

    async find(query: ContentQuery): Promise<ContentPage> {
      const where: Record<string, unknown> = {
        ...notDeleted(),
        tenantId: query.tenantId,
        type: query.type,
      };
      if (query.locale) where['locale'] = query.locale;
      if (query.status) where['status'] = query.status;

      const rows = await driver.transaction((tx) =>
        tx.find<EntryRow>({
          table: TABLE,
          where: { ...where, ...(query.filter ?? {}) },
          orderBy: [{ field: 'createdAt', dir: 'desc' }],
          limit: query.limit ?? 20,
          offset: query.offset ?? 0,
        })
      );
      const all = await driver.transaction((tx) =>
        tx.find<EntryRow>({ table: TABLE, where })
      );
      return { items: rows as unknown as Entity[], total: all.length };
    },

    async findOne(id: string, tenantId: string): Promise<Entity | null> {
      const row = await driver.transaction((tx) =>
        tx.findOne<EntryRow>({ table: TABLE, where: { id, tenantId, ...notDeleted() } })
      );
      return (row as unknown as Entity) ?? null;
    },

    async create(input: ContentCreateInput): Promise<Entity> {
      const typeDef = getTypeDef(input.type, input.tenantId);
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
      return entity as unknown as Entity;
    },

    async update(id: string, input: ContentUpdateInput): Promise<Entity> {
      const current = await this.findOne(id, input.tenantId);
      if (!current) {
        throw mapError(platformError('E_NOT_FOUND', `条目不存在: ${id}`));
      }
      const typeDef = getTypeDef(current.type, input.tenantId);
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
      return updated as unknown as Entity;
    },

    async remove(id: string, tenantId: string): Promise<void> {
      const current = await this.findOne(id, tenantId);
      if (!current) {
        throw mapError(platformError('E_NOT_FOUND', `条目不存在: ${id}`));
      }
      // 软删除：写哨兵值的反面（真实毫秒）
      await driver.transaction((tx) =>
        tx.update<EntryRow>(TABLE, id, { deletedAt: Date.now(), updatedAt: Date.now() })
      );
    },
  };
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
