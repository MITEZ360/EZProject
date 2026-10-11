// kernel/contracts/asset.contract.ts
// 媒体资产契约（策略接口）：内核只定义"能存取二进制资产"，不定义存哪（本地/S3/...）。
// 内容只存 asset id（铁律），不存 URL。

export interface Asset {
  id: string;
  tenantId: string;
  /** 原始文件名 */
  filename: string;
  /** MIME 类型 */
  contentType: string;
  /** 字节数 */
  size: number;
  /** 可选元信息（宽高、alt 等） */
  meta?: Record<string, unknown>;
  createdAt: number;
}

export interface AssetStore {
  /** 写入资产（返回元信息；`id` 由调用方提供，保证内容引用可预生成） */
  put(input: {
    id: string;
    tenantId: string;
    filename: string;
    contentType: string;
    data: Uint8Array;
    meta?: Record<string, unknown>;
  }): Promise<Asset>;
  getMeta(id: string, tenantId: string): Promise<Asset | null>;
  /** 读取二进制（用于下载/回源） */
  read(id: string, tenantId: string): Promise<{ asset: Asset; data: Uint8Array } | null>;
  remove(id: string, tenantId: string): Promise<void>;
  list(tenantId: string): Promise<Asset[]>;
}

export type AssetDialect = 'local' | 's3';
