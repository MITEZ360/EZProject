// PT → HTML 渲染器（消费端工具）：结构、行内 marks、XSS 转义。

import { describe, it, expect } from 'vitest';
import { ptToHtml, ptToPlainText, escapeHtml } from '@modules/content/render/pt-to-html.js';

const block = (style: string, text: string, marks?: string[]) => ({
  _type: 'block',
  _key: 'k',
  style,
  children: [{ _type: 'span', _key: 's', text, ...(marks ? { marks } : {}) }],
  markDefs: [],
});

describe('ptToHtml', () => {
  it('标题/段落/引用/无序列表', () => {
    const html = ptToHtml([
      block('h1', '标题'),
      block('normal', '段落'),
      block('blockquote', '引用'),
      { ...block('normal', '甲'), listItem: 'bullet' },
      { ...block('normal', '乙'), listItem: 'bullet' },
    ]);
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<p>段落</p>');
    expect(html).toContain('<blockquote>引用</blockquote>');
    expect(html).toContain('<ul>\n<li>甲</li>\n<li>乙</li>\n</ul>');
  });

  it('行内 marks：strong/em/code；link 走 markDefs', () => {
    const html = ptToHtml([
      block('normal', '粗', ['strong']),
      block('normal', '斜', ['em']),
      block('normal', '码', ['code']),
      {
        _type: 'block',
        style: 'normal',
        children: [{ _type: 'span', text: '链接', marks: ['lnk'] }],
        markDefs: [{ _key: 'lnk', _type: 'link', href: 'https://example.com' }],
      },
    ]);
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('<em>斜</em>');
    expect(html).toContain('<code>码</code>');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">链接</a>');
  });

  it('XSS：HTML 特殊字符被转义（含属性）', () => {
    const html = ptToHtml([block('normal', '<script>alert(1)</script>')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(escapeHtml('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('非 block 类型跳过（不猜、不崩）', () => {
    const html = ptToHtml([{ _type: 'image', url: '/x' }, block('normal', 'ok')]);
    expect(html).toBe('<p>ok</p>');
  });
});

describe('ptToPlainText', () => {
  it('取纯文本并截断', () => {
    const blocks = [block('h1', '标题'), block('normal', '正文内容')];
    expect(ptToPlainText(blocks)).toBe('标题 正文内容');
    expect(ptToPlainText(blocks, 3)).toBe('标题 …');
  });
});
