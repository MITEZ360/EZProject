import { describe, it, expect } from 'vitest';
import { portableTextSchema } from '@kernel/primitives/portable-text.schema.js';
import { isPortableText } from '@kernel/primitives/portable-text.js';

const validBlocks = [
  {
    _type: 'block',
    _key: 'k1',
    style: 'normal',
    children: [{ _type: 'span', _key: 's1', text: 'hello', marks: ['strong'] }],
  },
  { _type: 'image', _key: 'k2', asset: { _ref: 'media-123' }, alt: '图' },
  { _type: 'code', _key: 'k3', language: 'ts', code: 'const a = 1;' },
  { _type: 'custom', _key: 'k4', name: 'callout', value: { text: 'hi' } },
];

describe('portable text schema', () => {
  it('接受合法的 PT 结构（四类块）', () => {
    const r = portableTextSchema.safeParse(validBlocks);
    expect(r.success).toBe(true);
  });

  it('拒绝 HTML 字符串（铁律：不存 HTML）', () => {
    const r = portableTextSchema.safeParse('<p>hello</p>');
    expect(r.success).toBe(false);
  });

  it('拒绝缺失 _key 的块', () => {
    const r = portableTextSchema.safeParse([
      { _type: 'block', style: 'normal', children: [] },
    ]);
    expect(r.success).toBe(false);
  });

  it('图片必须带 asset._ref（存引用，不存 URL）', () => {
    const ok = portableTextSchema.safeParse([
      { _type: 'image', _key: 'k', asset: { _ref: 'abc' } },
    ]);
    expect(ok.success).toBe(true);

    const bad = portableTextSchema.safeParse([
      { _type: 'image', _key: 'k', asset: { url: 'http://x/y.png' } },
    ]);
    expect(bad.success).toBe(false);
  });

  it('isPortableText 形态判断', () => {
    expect(isPortableText(validBlocks)).toBe(true);
    expect(isPortableText('<p>no</p>')).toBe(false);
    expect(isPortableText([])).toBe(true);
    expect(isPortableText([{ noType: true }])).toBe(false);
  });
});
