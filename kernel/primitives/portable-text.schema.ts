// kernel/primitives/portable-text.schema.ts
// Portable Text 的 Zod 校验：写入入口强制，结构不合法不入库。
// 依据：engineering-spec 4.2。

import { z } from 'zod';

export const spanSchema = z.object({
  _type: z.literal('span'),
  _key: z.string().min(1),
  text: z.string(),
  marks: z.array(z.string()).optional(),
});

export const markDefSchema = z.object({
  _key: z.string().min(1),
  _type: z.literal('link'),
  href: z.string(),
});

const textBlockSchema = z.object({
  _type: z.literal('block'),
  _key: z.string().min(1),
  style: z.enum(['normal', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']),
  listItem: z.enum(['bullet', 'number']).optional(),
  level: z.number().int().positive().optional(),
  children: z.array(spanSchema),
  markDefs: z.array(markDefSchema).optional(),
});

const imageBlockSchema = z.object({
  _type: z.literal('image'),
  _key: z.string().min(1),
  asset: z.object({ _ref: z.string().min(1) }),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

const codeBlockSchema = z.object({
  _type: z.literal('code'),
  _key: z.string().min(1),
  language: z.string().min(1),
  code: z.string(),
});

const customBlockSchema = z.object({
  _type: z.literal('custom'),
  _key: z.string().min(1),
  name: z.string().min(1),
  value: z.record(z.unknown()),
});

export const portableTextBlockSchema = z.discriminatedUnion('_type', [
  textBlockSchema,
  imageBlockSchema,
  codeBlockSchema,
  customBlockSchema,
]);

export const portableTextSchema = z.array(portableTextBlockSchema);

export type PortableTextInput = z.input<typeof portableTextSchema>;
