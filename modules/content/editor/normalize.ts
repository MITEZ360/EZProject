// modules/content/editor/normalize.ts
// 编辑器双模式归一（engineering-spec 4.2）：写入时统一为 Portable Text。
// 纯函数、无 IO——任何编辑器（Markdown/块编辑）与任何场景后台都共享此实现。
// 存储永远只有 PT（铁律）；HTML/渲染产物不在此层。
// 支持子集：# 标题（1-3 级）、- 无序列表、空行分段、其余为普通段落。行内样式阶段一不解析。

export interface PtSpan {
  _type: 'span';
  _key: string;
  text: string;
  marks?: string[];
}

export interface PtBlock {
  _type: 'block';
  _key: string;
  style: 'normal' | 'h1' | 'h2' | 'h3' | 'blockquote';
  listItem?: 'bullet';
  level?: number;
  children: PtSpan[];
  markDefs: [];
}

let keySeq = 0;
export const nextKey = (): string => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

const span = (text: string): PtSpan => ({ _type: 'span', _key: nextKey(), text });

/** 极简 Markdown → PT。不可解析的内容按普通段落保留（不丢字）。 */
export function markdownToPt(md: string): PtBlock[] {
  const blocks: PtBlock[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push({
      _type: 'block',
      _key: nextKey(),
      style: 'normal',
      children: [span(para.join(' '))],
      markDefs: [],
    });
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushPara();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = (heading[1] ?? '#').length;
      blocks.push({
        _type: 'block',
        _key: nextKey(),
        style: `h${level}` as PtBlock['style'],
        children: [span(heading[2] ?? '')],
        markDefs: [],
      });
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      blocks.push({
        _type: 'block',
        _key: nextKey(),
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        children: [span(line.slice(2))],
        markDefs: [],
      });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

/** PT → 极简 Markdown（编辑回填用；不支持的 block 按普通段落输出，不丢字） */
export function ptToMarkdown(pt: unknown): string {
  if (!Array.isArray(pt)) return '';
  const lines: string[] = [];
  let prevWasList = false;
  for (const b of pt as Array<Record<string, unknown>>) {
    if (b['_type'] !== 'block') continue;
    const text = ((b['children'] as Array<{ text?: string }> | undefined) ?? [])
      .map((c) => c['text'] ?? '')
      .join('');
    const isList = b['listItem'] === 'bullet';
    // 块之间空一行（连续列表项除外），还原 Markdown 段落分隔
    if (lines.length > 0 && !(isList && prevWasList)) lines.push('');
    if (isList) {
      lines.push(`- ${text}`);
    } else if (b['style'] === 'h1' || b['style'] === 'h2' || b['style'] === 'h3') {
      lines.push(`${'#'.repeat(Number(String(b['style'])[1]))} ${text}`);
    } else {
      lines.push(text);
    }
    prevWasList = isList;
  }
  return lines.join('\n');
}
