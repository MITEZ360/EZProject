// kernel/contracts/content.contract.ts
// 内容能力契约：内核定义"能做什么"，实现由 content 模块提供。
// 依据：engineering-spec 4.4。

import type { Entity, EntityTypeDef } from '../primitives/entity.js';
import type { Principal } from '../primitives/principal.js';

export interface ContentQuery {
  type: string;
  tenantId: string;
  locale?: string;
  status?: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface ContentPage {
  items: Entity[];
  total: number;
}

export interface ContentCreateInput {
  type: string;
  tenantId: string;
  locale?: string;
  data: Record<string, unknown>;
  actor: Principal;
}

export interface ContentUpdateInput {
  tenantId: string;
  data: Partial<Record<string, unknown>>;
  actor: Principal;
}

export interface ContentService {
  defineType(def: EntityTypeDef): Promise<void>;
  find(query: ContentQuery): Promise<ContentPage>;
  findOne(id: string, tenantId: string): Promise<Entity | null>;
  create(input: ContentCreateInput): Promise<Entity>;
  update(id: string, input: ContentUpdateInput): Promise<Entity>;
  remove(id: string, tenantId: string, actor: Principal): Promise<void>;
}
