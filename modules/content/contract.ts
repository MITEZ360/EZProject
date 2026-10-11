// modules/content/contract.ts
// 内容模块对外契约：引用内核内容契约，并补充模块级类型。
// 其他模块只能看这里，不得 import internal/。

export type {
  ContentService,
  ContentQuery,
  ContentPage,
  ContentCreateInput,
  ContentUpdateInput,
} from '@kernel/contracts/content.contract.js';
