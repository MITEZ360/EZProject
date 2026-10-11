// kernel/primitives/entity.ts
// 内容原语：内核不认识"文章"，只认识"实体"。
// 依据：engineering-spec 4.1；时间/ID 约定见 6.5、4.1.1。

export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'richText'
  | 'media'
  | 'relation'
  | 'select'
  | 'json';

export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  relationTo?: string;
  many?: boolean;
}

export interface EntityTypeDef {
  /** 中性 slug：'posts' 而非写死 'article' */
  slug: string;
  fields: FieldDef[];
  versioned?: boolean;
  locales?: string[];
  /** 预留多租户 */
  tenantScoped?: boolean;
}

export interface Entity {
  /** 应用层生成：UUIDv7 */
  id: string;
  /** 租户短 id（8 字符 base62） */
  tenantId: string;
  type: string;
  locale: string;
  /** 内核不限定取值（业务状态机在模块层） */
  status: string;
  data: Record<string, unknown>;
  /** epoch 毫秒整数 */
  createdAt: number;
  updatedAt: number;
  /** 哨兵值：0=未删除，>0=删除时刻毫秒 */
  deletedAt: number;
}
