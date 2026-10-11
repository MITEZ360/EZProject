// kernel/primitives/portable-text.ts
// 富文本结构原语：严格遵循 Portable Text 规范。
// 铁律：存结构不存 HTML；不私自改动 PT 规范；PT 只装叙述性文本。
// 依据：docs/design.md 第 6 章、engineering-spec 4.2。

export type PortableText = PortableTextBlock[];

export type PortableTextBlock = TextBlock | ImageBlock | CodeBlock | CustomBlock;

export type TextBlockStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'blockquote';

export interface TextBlock {
  _type: 'block';
  _key: string;
  style: TextBlockStyle;
  listItem?: 'bullet' | 'number';
  level?: number;
  children: Span[];
  markDefs?: MarkDef[];
}

export interface Span {
  _type: 'span';
  _key: string;
  text: string;
  /** 'strong' | 'em' | 'underline' | 'code' | markDef._key（如链接） */
  marks?: string[];
}

export interface MarkDef {
  _key: string;
  _type: 'link';
  /** 链接可存 url */
  href: string;
}

/** 图片：必须存 asset 引用 ID，不存最终 URL（换 CDN 不影响数据） */
export interface ImageBlock {
  _type: 'image';
  _key: string;
  asset: { _ref: string };
  alt?: string;
  caption?: string;
}

export interface CodeBlock {
  _type: 'code';
  _key: string;
  language: string;
  code: string;
}

export interface CustomBlock {
  _type: 'custom';
  _key: string;
  /** 自定义块类型名 */
  name: string;
  value: Record<string, unknown>;
}

/** 判断一个值是否为合法的 PortableText 结构（形态层面的快速判断，非深度校验） */
export function isPortableText(value: unknown): value is PortableText {
  return Array.isArray(value) && value.every((b) => isBlockLike(b));
}

function isBlockLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return typeof b['_type'] === 'string' && typeof b['_key'] === 'string';
}
