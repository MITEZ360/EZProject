// 中文切分策略 + 两方言查询表达式生成。
// 切分是方言无关的（tokenize.ts 单一来源）；查询语法各策略自己拼，
// 但**语义必须对齐**（FTS5 phrase ≡ PG `<->`），故在此对照断言。
import { describe, it, expect } from 'vitest';
import { MAX_TOKEN_BYTES, tokenize, tokenizeList } from '@modules/search/internal/tokenize.js';
import { toMatchExpr } from '@modules/search/internal/sqlite-fts.js';
import { toTsQuery } from '@modules/search/internal/postgres-fts.js';
import { searchableText } from '@modules/search/internal/document.js';

describe('中文切分（单字切分，实测选定）', () => {
  it('汉字逐字成 token；英文/数字按词保留', () => {
    expect(tokenize('你好 world 123')).toBe('你 好 world 123');
  });

  it('标点与空白作分隔并归一', () => {
    expect(tokenize('你好，世界！')).toBe('你 好 世 界');
    expect(tokenize('  a    b  ')).toBe('a b');
  });

  it('空串 / 纯标点 → 空', () => {
    expect(tokenize('')).toBe('');
    expect(tokenize('，。！？')).toBe('');
  });

  it('tokenizeList 与 tokenize 同源（切分只有一处实现）', () => {
    expect(tokenizeList('你好 world')).toEqual(['你', '好', 'world']);
    expect(tokenizeList('  ')).toEqual([]);
  });

  it('关键性质：能表示中文子串（这正是默认分词器做不到的）', () => {
    expect(tokenize('你好世界')).toContain('世 界');
    expect(tokenizeList('你好世界')).toEqual(['你', '好', '世', '界']);
  });
});

describe('超长 token 过滤（跨方言一致的平台约束）', () => {
  it('超过上限的连续字母数字串被丢弃', () => {
    expect(tokenize('a'.repeat(MAX_TOKEN_BYTES))).toBe('a'.repeat(MAX_TOKEN_BYTES));
    expect(tokenize('a'.repeat(MAX_TOKEN_BYTES + 1))).toBe('');
  });

  it('中文不受影响：单字切分后每 token 仅 3 字节', () => {
    // 5000 字连续中文——若整体成一个 token 会远超限；单字切分后逐字存活
    const list = tokenizeList('字'.repeat(5000));
    expect(list.length).toBe(5000);
    expect(list.every((t) => t === '字')).toBe(true);
  });

  it('超长串混在正常文本中：只丢它自己，其余照常索引', () => {
    const text = `标题 ${'x'.repeat(MAX_TOKEN_BYTES + 10)} 正文`;
    expect(tokenize(text)).toBe('标 题 正 文');
  });
});

describe('两方言查询表达式（语法不同，语义对齐）', () => {
  it('FTS5 用双引号短语；PG 用 <-> 相邻', () => {
    expect(toMatchExpr('世界')).toBe('"世 界"');
    expect(toTsQuery('世界')).toBe('世 <-> 界');
  });

  it('英文/数字同样处理', () => {
    expect(toMatchExpr('hello')).toBe('"hello"');
    expect(toTsQuery('hello')).toBe('hello');
    expect(toMatchExpr('a b')).toBe('"a b"');
    expect(toTsQuery('a b')).toBe('a <-> b');
  });

  it('空查询 → 空表达式（调用方据此短路返回空结果）', () => {
    expect(toMatchExpr('  ')).toBe('');
    expect(toTsQuery('  ')).toBe('');
    expect(toMatchExpr('，。！')).toBe('');
    expect(toTsQuery('，。！')).toBe('');
  });

  it('token 只含汉字/字母/数字 → 两方言的查询元字符都不可能被注入', () => {
    // FTS5 元字符：双引号、*、^、AND/OR；PG 元字符：& | ! ( ) : <-> *
    const hostile = 'a"b* OR c^d & ! e:f <-> g';
    // FTS5：外层短语引号 + 纯 token，别无一物
    expect(toMatchExpr(hostile)).toMatch(/^"[a-zA-Z ]+"$/);
    // PG：纯 token 以 <-> 相连，别无一物
    expect(toTsQuery(hostile)).toMatch(/^[a-zA-Z]+( <-> [a-zA-Z]+)*$/);
  });
});

describe('searchableText：索引内容的方言无关来源', () => {
  it('收集嵌套字段的字符串；跳过元数据字段', () => {
    const doc = {
      id: 'x1',
      status: 'published',
      slug: 'hello',
      data: { title: '你好', body: [{ children: [{ text: '世界' }] }], views: 42, draft: true },
    };
    const text = searchableText(doc);
    expect(text).toContain('你 好');
    expect(text).toContain('世 界');
    // 元数据与数字/布尔不入索引
    expect(text).not.toContain('published');
    expect(text).not.toContain('hello');
    expect(text).not.toContain('42');
  });
});
