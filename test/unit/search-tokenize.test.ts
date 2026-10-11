// 中文切分策略单测（索引与查询必须用同一套，否则对不上）。
import { describe, it, expect } from 'vitest';
import { tokenize, toMatchExpr } from '@modules/search/internal/tokenize.js';

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

  it('MATCH 表达式：phrase 包裹、引号转义', () => {
    expect(toMatchExpr('世界')).toBe('"世 界"');
    expect(toMatchExpr('hello')).toBe('"hello"');
    expect(toMatchExpr('  ')).toBe(''); // 空查询 → 空表达式（调用方返回空结果）
  });

  it('关键性质：能表示中文子串（这正是默认分词器做不到的）', () => {
    // "世界" 切出的 token 序列，必须能在 "你 好 世 界" 中**相邻**匹配
    expect(toMatchExpr('世界')).toBe('"世 界"');
    expect(tokenize('你好世界')).toContain('世 界');
  });
});
