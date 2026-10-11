import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@kernel': r('./kernel'),
      '@modules': r('./modules'),
      '@scenarios': r('./scenarios'),
    },
  },
  test: {
    name: 'backend',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 前端组件测试走 jsdom（vitest.admin.config.ts），两套环境分开，
    // 免得 jsdom 全局（matchMedia 等）污染后端测试
    exclude: ['test/admin/**'],
  },
});
