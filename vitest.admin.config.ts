import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * 管理端组件测试环境（jsdom）。
 *
 * 为什么单独一套配置：admin 此前**零组件测试**，于是"认证门形同虚设"这种
 * 缺陷能一路通过 typecheck / lint / build——所有静态检查都对一个死掉的门
 * 视而不见。补组件测试就是为了让这类缺陷有地方暴露。
 *
 * 不用 @vitejs/plugin-react：vitest 2 自带的 vite 与项目构建用的 vite
 * 大版本不同，插件类型互不兼容。这里只需要 esbuild 转 JSX 即可。
 */
export default defineConfig({
  // 测试文件按后端 tsconfig 编译时没有 jsx 配置，会退回经典 React.createElement
  // 而测试文件里并没有 import React → "React is not defined"。
  // 显式指定自动 JSX 运行时，与 tsconfig.admin.json 保持一致。
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@kernel': r('./kernel'),
      '@modules': r('./modules'),
      '@scenarios': r('./scenarios'),
    },
  },
  test: {
    name: 'admin',
    environment: 'jsdom',
    include: ['test/admin/**/*.test.tsx'],
    setupFiles: ['test/admin/setup.ts'],
    // antd 依赖浏览器 API，jsdom 缺的一律在 setup 里补齐；
    // 缺一个就红一片的"隐性依赖"应该在那里补，而不是每个用例各写一份
    css: false,
  },
});
