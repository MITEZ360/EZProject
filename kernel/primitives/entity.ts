// kernel/primitives/entity.ts
// 内容原语：内核不认识"文章"，只认识"实体"。
// 依据：engineering-spec 4.1、4.2.1（决策 #26 字段类型集）；时间/ID 约定见 6.5、4.1.1。

/** 字段调色板（决策 #26 定稿，11 种）：
 *  基础标量：text / longText / number / boolean / date / select
 *  结构：richText（PT 铁律）/ component（递归，深 ≤3）
 *  引用：relation / media（只存 ID）
 *  逃生舱：json（系统不解释，保证装得下） */
export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'richText'
  | 'component'
  | 'relation'
  | 'media'
  | 'json';

export interface FieldDef {
  name: string;
  type: FieldType;

  // —— 通用选项 ——
  required?: boolean;
  /** 默认值（创建时未提供则填充；阶段二在服务层落地） */
  default?: string | number | boolean;
  /** text 正则约束 */
  pattern?: string;
  /** number 数值范围 / date 毫秒范围 / longText 长度范围 */
  min?: number;
  max?: number;

  // —— 类型专属选项 ——
  /** number：必须为整数 */
  integer?: boolean;
  /** date：仅日期（约定存 UTC 零点毫秒） */
  dateOnly?: boolean;
  /** select：选项集（必填） */
  options?: string[];
  /** select 多选（string[]） */
  multiple?: boolean;
  /** component：子字段定义（递归） */
  fields?: FieldDef[];
  /** component：可重复（值为数组） */
  repeatable?: boolean;
  /** relation：限定目标内容类型 slug（不填=任意） */
  targetType?: string;
  /** 预留（决策 #26）：物化字段——声明后将来提升为物理列+索引（写入双写）。当前仅占位 */
  materialized?: boolean;
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
