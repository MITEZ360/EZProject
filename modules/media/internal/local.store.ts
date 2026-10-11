// modules/media/internal/local.store.ts
// 本地文件系统资产存储（策略实现）：文件落 <root>/<tenantId>/<id>，元信息落私有表。
// 目标机器零环境依赖：root 默认 ./data/media（随交付包走）。

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset, AssetStore } from '@kernel/contracts/asset.contract.js';
import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';

/** 资产私有表声明（**声明式建表**：物理类型由存储层按方言落地） */
export const ASSETS_TABLE: TableDef = {
  table: 'assets',
  columns: [
    { name: 'id', type: 'text', primaryKey: true },
    { name: 'tenant_id', type: 'text', notNull: true },
    { name: 'filename', type: 'text', notNull: true },
    { name: 'content_type', type: 'text', notNull: true },
    { name: 'size', type: 'int', notNull: true },
    { name: 'meta', type: 'json', notNull: true },
    { name: 'created_at', type: 'timestamp', notNull: true },
  ],
  indexes: [{ name: 'ix_assets_tenant', columns: ['tenant_id', '-created_at'] }],
  schema: {
    columns: { tenantId: 'tenant_id', contentType: 'content_type', createdAt: 'created_at' },
    jsonColumns: ['meta'],
  },
};

interface AssetRow {
  id: string;
  tenantId: string;
  filename: string;
  contentType: string;
  size: number;
  meta: Record<string, unknown>;
  createdAt: number;
}

/** 防路径穿越：只允许安全的 id 形态 */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function createLocalAssetStore(driver: StorageDriver, root: string): AssetStore {
  const filePath = (tenantId: string, id: string): string => {
    if (!SAFE_ID.test(id)) throw Object.assign(new Error('非法资产 id'), { name: 'E_VALIDATION' });
    if (!/^[a-zA-Z0-9_*-]{1,32}$/.test(tenantId)) {
      throw Object.assign(new Error('非法租户 id'), { name: 'E_VALIDATION' });
    }
    return join(root, tenantId, id);
  };
  const toMeta = (row: AssetRow): Asset => ({
    id: row.id,
    tenantId: row.tenantId,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    meta: row.meta,
    createdAt: row.createdAt,
  });

  return {
    async put(input): Promise<Asset> {
      const path = filePath(input.tenantId, input.id);
      mkdirSync(join(root, input.tenantId), { recursive: true });
      writeFileSync(path, input.data);
      const row: AssetRow = {
        id: input.id,
        tenantId: input.tenantId,
        filename: input.filename,
        contentType: input.contentType,
        size: input.data.byteLength,
        meta: input.meta ?? {},
        createdAt: Date.now(),
      };
      await driver.transaction((tx) => tx.insert('assets', row));
      return toMeta(row);
    },

    async getMeta(id, tenantId) {
      const row = await driver.transaction((tx) =>
        tx.findOne<AssetRow>({ table: 'assets', where: { id, tenantId } })
      );
      return row ? toMeta(row) : null;
    },

    async read(id, tenantId) {
      const meta = await this.getMeta(id, tenantId);
      if (!meta) return null;
      const path = filePath(tenantId, id);
      if (!existsSync(path)) return null;
      return { asset: meta, data: new Uint8Array(readFileSync(path)) };
    },

    async remove(id, tenantId) {
      await driver.transaction((tx) => tx.delete('assets', id));
      const path = filePath(tenantId, id);
      if (existsSync(path)) rmSync(path);
    },

    async list(tenantId) {
      const rows = await driver.transaction((tx) =>
        tx.find<AssetRow>({
          table: 'assets',
          where: { tenantId },
          orderBy: [{ field: 'createdAt', dir: 'desc' }],
        })
      );
      return rows.map(toMeta);
    },
  };
}
