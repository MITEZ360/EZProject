// modules/content/render/pt-to-html.ts
// Portable Text → HTML 渲染器（消费端工具，纯函数）。
// 铁律：渲染产物永远可再生，绝不入库——此函数只在展示层调用。
// 覆盖子集：h1-h3 / blockquote / bullet list / 段落；行内 marks: strong/em/code/link。

import type { PortableText } from '@kernel/primitives/portable-text.js';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

interface Span {
  _type?: string;
  text?: string;
  marks?: string[];
}
interface Block {
  _type?: string;
  style?: string;
  listItem?: string;
  children?: Span[];
  markDefs?: Array<{ _key: string; _type: string; href?: string }>;
}

function renderSpans(block: Block): string {
  const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d]));
  let out = '';
  for (const span of block.children ?? []) {
    let html = escapeHtml(String(span.text ?? ''));
    for (const mark of span.marks ?? []) {
      const def = defs.get(mark);
      if (def?.href) {
        html = `<a href="${escapeHtml(def.href)}" rel="noopener noreferrer">${html}</a>`;
      } else if (mark === 'strong') html = `<strong>${html}</strong>`;
      else if (mark === 'em') html = `<em>${html}</em>`;
      else if (mark === 'code') html = `<code>${html}</code>`;
    }
    out += html;
  }
  return out;
}

export function ptToHtml(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of blocks as Block[]) {
    if (raw?._type !== 'block') continue; // 非 block（如嵌入对象）本渲染器跳过，不猜
    const inner = renderSpans(raw);

    if (raw.listItem === 'bullet') {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inner}</li>`);
      continue;
    }
    closeList();

    switch (raw.style) {
      case 'h1':
        out.push(`<h1>${inner}</h1>`);
        break;
      case 'h2':
        out.push(`<h2>${inner}</h2>`);
        break;
      case 'h3':
        out.push(`<h3>${inner}</h3>`);
        break;
      case 'blockquote':
        out.push(`<blockquote>${inner}</blockquote>`);
        break;
      default:
        out.push(`<p>${inner}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

/** 纯文本摘要（列表页/SEO 用）：取前 n 个字符 */
export function ptToPlainText(blocks: unknown, max = 160): string {
  if (!Array.isArray(blocks)) return '';
  const text = (blocks as Block[])
    .filter((b) => b._type === 'block')
    .map((b) => (b.children ?? []).map((s) => s.text ?? '').join(''))
    .join(' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export type { PortableText };
