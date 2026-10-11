// kernel/contracts/search.contract.ts
// 搜索抽象（策略接口）：契约层只暴露 search()，不泄漏具体引擎特性。

export interface SearchQuery {
  /** 索引/集合（中性） */
  index: string;
  tenantId: string;
  text: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface SearchHit<T = Record<string, unknown>> {
  id: string;
  score: number;
  document: T;
}

export interface SearchResult<T = Record<string, unknown>> {
  hits: SearchHit<T>[];
  total: number;
}

export interface SearchProvider {
  readonly engine: string;
  index(index: string, id: string, document: Record<string, unknown>): Promise<void>;
  remove(index: string, id: string): Promise<void>;
  search<T = Record<string, unknown>>(query: SearchQuery): Promise<SearchResult<T>>;
}
