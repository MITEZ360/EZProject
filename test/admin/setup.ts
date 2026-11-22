// test/admin/setup.ts —— jsdom 环境的浏览器 API 补齐
//
// 这些 shim 不是"为了让测试跑起来"的权宜之计，而是**记录真实依赖**：
// 每个补上的 API 都说明组件（多半是 antd 内部）在浏览器里用到了什么，
// 哪天 jsdom 不再需要它，对应的就是可以删掉的隐式环境依赖。

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom 没有 matchMedia，antd 的响应式栅格/主题会直接崩
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// ResizeObserver：antd Table / Select 依赖它做自适应
if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// IntersectionObserver：Dropdown / Popover 的懒挂载判断
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as Record<string, unknown>)['IntersectionObserver'] = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

// jsdom 不实现滚动，antd 的虚拟列表与定位会读它
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
window.scrollTo = window.scrollTo ?? (() => {});

// jsdom 的 getComputedStyle 不支持第二个参数（伪元素）：
// 传 pseudoElt 时它不抛错，但会打一条 "Not implemented" 的错误日志。
// antd 每次交互都要查询伪元素样式，于是单次测试能刷出几十条噪音，
// 把真正的失败信息淹没。这里只在"带伪元素"时退回普通查询，
// 让 jsdom 闭嘴；不带伪元素的调用仍走原生实现，行为不变。
{
  const original = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    // 伪元素在 jsdom 里查不到真实值，退回元素本身的计算样式即可
    void pseudoElt;
    return original(elt);
  }) as typeof window.getComputedStyle;
}

// fetch 未定义时 api 层会在 await 处炸成一团无意义的错；
// 这里只给出"默认未打桩"的显式失败，测试必须自己 stub
if (!globalThis.fetch) {
  globalThis.fetch = (() => {
    throw new Error('测试未打桩 fetch：请在用例里 vi.stubGlobal("fetch", ...)');
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
