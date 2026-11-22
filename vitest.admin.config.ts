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

    /**
     * 超时从 vitest 默认的 5s 提到 20s。
     *
     * 为什么必须提：antd 组件在 jsdom 里每次交互都要走完整的
     * render → 布局计算 → 断言链，单个用例 2~4s 是常态。
     * 而 CI runner 普遍比开发机慢 1.5~2 倍——实测同一用例在沙箱
     * 3740ms、在 GitHub Actions 上 5985ms，直接撞穿 5s 默认阈值，
     * 让 CI 因"机器慢"而红，而不是因"代码坏了"而红。
     *
     * 提超时不是掩盖问题：真正的挂死（比如 await 永不 resolve）
     * 会一直耗到 20s 才失败，仍然会被抓到；而慢用例不会误报。
     */
    testTimeout: 20_000,
    // hookTimeout 也要放宽：beforeEach 里的 render 同样随机器速度浮动
    hookTimeout: 20_000,
  },
});
