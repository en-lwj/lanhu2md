export function headingLevel(text) {
  if (!text || text.length > 40) return 0;
  if (/^\d+\.\d+\.\d+[\s.、]/.test(text)) return 4;
  if (/^\d+\.\d+[\s.、]/.test(text)) return 3;
  if (/^\d+[\s.、]\S/.test(text) && text.length <= 30) return 2;
  if (/^[a-zA-Z][.、]\s*\S/.test(text) && text.length <= 30) return 4;
  return 0;
}

function blockLines(block) {
  return String(block.text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function boxOf(block) {
  const box = block?.box;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [left, top, width, height] = box;
  return { left, top, right: left + width, bottom: top + height };
}

function boxDistance(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  return Math.hypot(dx, dy);
}

/**
 * 把线性 blocks 聚成章节：{ level, title, text[], images[] }
 * 标题行单独成节；图片按「离哪个文本块最近」归到该文本块产生的第一节
 * （原型里截图和说明常是左右两栏并排，只按 DOM 顺序会把截图全堆到最前面）。
 */
export function buildSections(blocks) {
  const sections = [];
  let current = { level: 0, title: '', text: [], images: [] };
  const blockSections = []; // { block, section } 每个文本块 -> 它产生的第一节

  for (const block of blocks) {
    if (block.type !== 'text') continue;
    let firstSection = null;
    for (const line of blockLines(block)) {
      const level = headingLevel(line);
      if (level) {
        if (current.title || current.text.length || current.images.length) sections.push(current);
        current = { level, title: line, text: [], images: [] };
        if (!firstSection) firstSection = current;
      } else {
        current.text.push(line);
      }
    }
    if (!firstSection) firstSection = current;
    blockSections.push({ block, section: firstSection, box: boxOf(block) });
  }
  if (current.title || current.text.length || current.images.length) sections.push(current);

  const loose = [];
  const imageBoxes = blocks.filter((b) => b.type === 'image').map(boxOf).filter(Boolean);
  const insideImage = (box) =>
    box && imageBoxes.some((img) => box.left >= img.left - 1 && box.right <= img.right + 1 && box.top >= img.top - 1 && box.bottom <= img.bottom + 1);
  const isParagraph = (box) => box && (box.right - box.left >= 400 || box.bottom - box.top >= 200);
  const paragraphAnchors = blockSections.filter((c) => isParagraph(c.box));
  const anchors = paragraphAnchors.length ? paragraphAnchors : blockSections;

  for (const block of blocks) {
    if (block.type !== 'image') continue;
    const imageBox = boxOf(block);
    let best = null;
    let bestScore = Number.MAX_SAFE_INTEGER;
    // 先排除「落在某张截图内部」的文字（那是截图上的按钮/表头标签，不是需求说明）
    for (const candidate of anchors) {
      if (insideImage(candidate.box)) continue;
      // 需求文字通常在截图右侧；文字块跑到截图左边时加惩罚，避免把上一条的说明配给下一张图
      const wrongSide = candidate.box.left + 50 < imageBox.left ? 900 : 0;
      const score = boxDistance(imageBox, candidate.box) + wrongSide;
      if (score < bestScore) {
        bestScore = score;
        best = candidate.section;
      }
    }
    if (best) best.images.push(block);
    else loose.push(block);
  }

  for (const section of sections) {
    section.images.sort((a, b) => {
      const ay = a.box?.[1] ?? 0;
      const by = b.box?.[1] ?? 0;
      if (ay !== by) return ay - by;
      return (a.box?.[0] ?? 0) - (b.box?.[0] ?? 0);
    });
  }

  if (loose.length) sections.unshift({ level: 0, title: '', text: [], images: loose });
  return sections;
}

/**
 * 单页 Markdown。
 * inlineImages=true（配合 --images）时按章节输出：标题 → 截图 → 该节需求文字，
 * 也就是「截图A + A 的需求」这种顺序；否则保持原来的纯文本顺序。
 */
export function renderPageMarkdown({
  page,
  pagePath,
  docName,
  versionLabel,
  sourceUrl,
  blocks,
  imageMap,
  inlineImages = false,
}) {
  const lines = [];
  lines.push(`# ${page.name}`, '');

  const meta = [`项目：${docName}`];
  if (versionLabel) meta.push(`版本：${versionLabel}`);
  if (pagePath && pagePath.length > 1) meta.push(`页面路径：${pagePath.join(' / ')}`);
  lines.push(`> ${meta.join(' · ')}`, '');
  if (sourceUrl) lines.push(`> 来源：${sourceUrl}`, '');

  if (inlineImages && imageMap && imageMap.size) {
    for (const section of buildSections(blocks)) {
      if (section.title) lines.push(`${'#'.repeat(section.level)} ${section.title}`, '');
      for (const image of section.images) {
        const relative = imageMap.get(image.src);
        if (!relative) continue;
        lines.push(`![${image.caption || '截图'}](${relative})`, '');
      }
      if (section.text.length) lines.push(section.text.join('\n'), '');
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    lines.push(buffer.join('\n'), '');
    buffer = [];
  };

  for (const block of blocks) {
    if (block.type === 'text') {
      for (const line of blockLines(block)) {
        const level = headingLevel(line) || (block.fontSize >= 30 && line.length <= 30 ? 2 : 0);
        if (level) {
          flush();
          lines.push(`${'#'.repeat(level)} ${line}`, '');
        } else {
          buffer.push(line);
        }
      }
      continue;
    }
    const relative = imageMap?.get(block.src);
    if (!relative) continue;
    flush();
    lines.push(`![${block.caption || '截图'}](${relative})`, '');
  }

  flush();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** --all 时的总目录：按一级文件夹分组 */
export function renderIndexMarkdown({ docName, versionLabel, sourceUrl, entries }) {
  const lines = [`# ${docName}`, ''];
  if (versionLabel) lines.push(`> 版本：${versionLabel}`, '');
  if (sourceUrl) lines.push(`> 来源：${sourceUrl}`, '');
  lines.push(`> 共 ${entries.length} 个页面`, '');

  const groups = new Map();
  for (const entry of entries) {
    const chain = entry.pagePath || [entry.pageName];
    const folder = chain.length > 1 ? chain[0] : '';
    if (!groups.has(folder)) groups.set(folder, []);
    const sub = chain.length > 2 ? chain.slice(1, -1).join(' / ') : '';
    groups.get(folder).push({ ...entry, sub });
  }

  for (const [folder, items] of groups) {
    lines.push(folder ? `## ${folder}` : '## 其他', '');
    for (const item of items) {
      const suffix = item.sub ? `（${item.sub}）` : '';
      lines.push(`- [${item.pageName}](${item.file})${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
