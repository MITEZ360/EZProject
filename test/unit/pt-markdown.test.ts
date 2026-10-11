import { describe, it, expect } from 'vitest';
import { markdownToPt, ptToMarkdown } from '@scenarios/blog/admin/src/lib/pt.js';

describe('Markdown → Portable Text（写入归一）', () => {
  it('标题/段落/列表归一为 PT block 结构', () => {
    const pt = markdownToPt('# 大标题\n\n第一段。\n\n- 甲\n- 乙\n\n## 小标题\n正文续。');
    expect(pt).toHaveLength(6);
    expect(pt[0]).toMatchObject({ style: 'h1', children: [{ text: '大标题' }] });
    expect(pt[1]).toMatchObject({ style: 'normal', children: [{ text: '第一段。' }] });
    expect(pt[2]).toMatchObject({ listItem: 'bullet', children: [{ text: '甲' }] });
    expect(pt[4]).toMatchObject({ style: 'h2' });
    expect(pt[5]).toMatchObject({ style: 'normal', children: [{ text: '正文续。' }] });
  });

  it('所有产物都是 PT 结构（铁律：不产生 HTML 字符串）', () => {
    const pt = markdownToPt('# t\n\np\n\n- l');
    for (const b of pt) {
      expect(b['_type']).toBe('block');
      expect(typeof b).toBe('object');
    }
  });

  it('多行段落合并为一段；空段被跳过', () => {
    const pt = markdownToPt('行一\n行二\n\n\n\n行三');
    expect(pt).toHaveLength(2);
    expect(pt[0]?.children[0]?.text).toBe('行一 行二');
  });

  it('空输入 → 空数组', () => {
    expect(markdownToPt('')).toEqual([]);
  });
});

describe('PT → Markdown（编辑回填）', () => {
  it('与 markdownToPt 构成往返（子集内）', () => {
    const md = '# 大标题\n\n第一段。\n\n- 甲\n- 乙';
    expect(ptToMarkdown(markdownToPt(md))).toBe(md);
  });

  it('非数组输入返回空串（防御）', () => {
    expect(ptToMarkdown(null)).toBe('');
    expect(ptToMarkdown('not-pt')).toBe('');
  });
});
