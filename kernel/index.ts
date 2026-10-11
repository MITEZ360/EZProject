// kernel/index.ts
// 内核对外出口（唯一出口）。外部只能从这里 import 内核。

// 原语
export * from './primitives/result.js';
export * from './primitives/id.js';
export * from './primitives/entity.js';
export * from './primitives/principal.js';
export * from './primitives/portable-text.js';
export { portableTextSchema, portableTextBlockSchema, spanSchema } from './primitives/portable-text.schema.js';

// 事件
export * from './events/types.js';
export { createEventBus } from './events/bus.js';

// 契约
export * from './contracts/storage.contract.js';
export * from './contracts/content.contract.js';
export * from './contracts/module.contract.js';
export * from './contracts/authz.contract.js';
export * from './contracts/search.contract.js';

// 注册表与生命周期
export * from './registry.js';
export * from './bootstrap.js';
