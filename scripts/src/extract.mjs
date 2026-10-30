import { decodeEntities } from './util.mjs';

/**
 * 解析 Axure 页面 CSS 里每个控件的绝对定位。
 * 形如：#u6 { position:absolute; left:119px; top:1973px; width:224px; height:32px; font-size:28px; }
 */
export function parseCss(css) {
  const map = new Map();
  const ruleRe = /#(u\d+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(css))) {
    const id = match[1];
    const body = match[2];
    const num = (key) => {
      const m = body.match(new RegExp(`(?:^|;)\\s*${key}:\\s*(-?[\\d.]+)px`));
      return m ? parseFloat(m[1]) : 0;
    };
    map.set(id, {
      left: num('left'),
      top: num('top'),
      width: num('width'),
      height: num('height'),
      fontSize: num('font-size'),
    });
  }
  return map;
}

function htmlToText(fragment) {
  const text = String(fragment)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 从页面 HTML + CSS 里抽出「文本块」和「图片块」，带坐标。
 * 每个 Axure 控件是一个 id="uN" 的 div（图片是其中的 id="uN_img"）。
 */
export function extractItems(html, css) {
  const cssMap = parseCss(css || '');
  const markRe = /<(div|img|span)[^>]*\bid="u(\d+)(_img)?"[^>]*>/g;
  const marks = [];
  let match;
  while ((match = markRe.exec(html))) {
    marks.push({ start: match.index, end: markRe.lastIndex, tag: match[1], id: 'u' + match[2], isImg: Boolean(match[3]) });
  }

  const items = [];
  for (let i = 0; i < marks.length; i += 1) {
    const cur = marks[i];
    const nextStart = i + 1 < marks.length ? marks[i + 1].start : html.length;
    const box = cssMap.get(cur.id) || null;

    if (cur.isImg) {
      const tagText = html.slice(cur.start, cur.end);
      const src = (tagText.match(/data-src="([^"]+)"/) || html.slice(cur.end, nextStart).match(/data-src="([^"]+)"/) || [])[1];
      if (src) {
        const parentBox = cssMap.get(cur.id.replace(/_img$/, '')) || box;
        items.push({ kind: 'image', id: cur.id, src: decodeEntities(src), box: parentBox });
      }
      continue;
    }

    const fragment = html.slice(cur.end, nextStart);
    const text = htmlToText(fragment);
    if (text) {
      items.push({
        kind: 'text',
        id: cur.id,
        text,
        html: fragment,
        openTag: html.slice(cur.start, cur.end),
        // 容器里如果还嵌着别的控件，说明它是分组/父节点，布局时交给子控件渲染
        isContainer: /id="u\d+"/.test(fragment),
        box,
        fontSize: box?.fontSize || 0,
      });
    }
  }
  return items;
}

function contains(outer, inner) {
  if (!outer || !inner) return false;
  return (
    outer.left <= inner.left + 1 &&
    outer.top <= inner.top + 1 &&
    outer.left + outer.width >= inner.left + inner.width - 1 &&
    outer.top + outer.height >= inner.top + inner.height - 1
  );
}

/** 去掉「父容器」重复文本（Axure 里嵌套 div 会把子控件的文字再包一层） */
function dedupeTexts(items) {
  const result = [];
  for (const item of items) {
    if (item.kind !== 'text') {
      result.push(item);
      continue;
    }
    const duplicateOf = items.find(
      (other) =>
        other !== item &&
        other.kind === 'text' &&
        other.text === item.text &&
        contains(other.box, item.box) &&
        (other.box.width || 0) * (other.box.height || 0) > (item.box?.width || 0) * (item.box?.height || 0)
    );
    if (!duplicateOf) result.push(item);
  }
  return result;
}

function boxArray(box) {
  return box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null;
}

/**
 * 生成文档块序列。
 * Axure 的 DOM 顺序基本等于作者编写顺序（实测比按坐标排序更贴近需求文档的 1 → 2 → 3 顺序），
 * 所以默认保持 document order；坐标只用来过滤小图标、以及给图片找上下文。
 */
export function buildBlocks(items, { minImageWidth = 120, minImageHeight = 80, order = 'doc' } = {}) {
  const cleaned = dedupeTexts([...items]);
  const sorted =
    order === 'xy'
      ? cleaned.sort((a, b) => {
          const ay = a.box?.top ?? 0;
          const by = b.box?.top ?? 0;
          if (ay !== by) return ay - by;
          return (a.box?.left ?? 0) - (b.box?.left ?? 0);
        })
      : cleaned;

  const blocks = [];
  let lastText = null;
  let previousText = '';

  for (const item of sorted) {
    if (item.kind === 'text') {
      if (item.text === previousText) continue;
      previousText = item.text;
      lastText = item;
      blocks.push({
        type: 'text',
        id: item.id,
        text: item.text,
        fontSize: item.fontSize,
        box: boxArray(item.box),
      });      continue;
    }

    const width = item.box?.width || 0;
    const height = item.box?.height || 0;
    if (width < minImageWidth || height < minImageHeight) continue;
    if (/\.svg$/i.test(item.src) && width * height < 40000) continue;

    const captionSource = lastText ? lastText.text.split('\n').filter(Boolean).slice(-1)[0] || '' : '';
    blocks.push({
      type: 'image',
      id: item.id,
      src: item.src,
      box: boxArray(item.box),
      caption: captionSource.slice(0, 40),
      section: lastText ? lastText.text.split('\n')[0].slice(0, 40) : '',
    });
  }

  return blocks;
}
