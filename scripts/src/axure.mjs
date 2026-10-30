import path from 'node:path';
import { cachedText } from './util.mjs';
import { normalizeId } from './lanhu-url.mjs';

export const CDN = 'https://axure-file.lanhuapp.com/';

/** 下载并解析版本 JSON：{ pages: {...}, sitemap: { rootNodes: [...] } } */
export async function loadVersion(jsonUrl, cacheDir) {
  const text = await cachedText(path.join(cacheDir, 'version.json'), jsonUrl);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`版本 JSON 解析失败：${jsonUrl}`);
  }
  if (!data.pages || !data.sitemap) throw new Error('版本 JSON 结构异常（缺少 pages / sitemap）');
  return data;
}

/** sitemap 树 → 扁平页面列表（保留层级路径） */
export function flattenSitemap(nodes, parents = []) {
  const out = [];
  for (const node of nodes || []) {
    const chain = [...parents, node.pageName].filter(Boolean);
    if (node.type === 'Wireframe' && node.url) {
      out.push({ id: node.id, name: node.pageName || node.url, url: node.url, path: chain });
    }
    if (Array.isArray(node.children) && node.children.length) {
      out.push(...flattenSitemap(node.children, chain));
    }
  }
  return out;
}

/** 通过 JSON 里的 pages 表拿到某页的资源签名信息 */
export function pageEntry(versionJson, page) {
  const entry = versionJson.pages[page.url];
  if (!entry) throw new Error(`版本 JSON 里找不到页面：${page.url}`);
  return entry;
}

/**
 * 选择要转换的页面。
 * 优先级：--page（名称或 id） > URL 的 pageId > 第一页
 */
export function selectPages(versionJson, sitemap, params, opts = {}) {
  if (opts.all) return sitemap;

  if (opts.page) {
    const needle = String(opts.page).trim();
    const hit =
      sitemap.find((p) => p.name === needle) ||
      sitemap.find((p) => normalizeId(p.id) === normalizeId(needle)) ||
      sitemap.find((p) => p.name.includes(needle));
    if (!hit) throw new Error(`找不到页面「${needle}」。可用页面：\n${sitemap.map((p) => ' - ' + p.name).join('\n')}`);
    return [hit];
  }

  if (params.pageId) {
    const hit = sitemap.find((p) => normalizeId(p.id) === normalizeId(params.pageId));
    if (hit) return [hit];
  }

  if (sitemap.length) return [sitemap[0]];
  throw new Error('该原型没有任何页面');
}

/** 页面文件名（不含扩展名），用于输出 md 名与图片目录名 */
export function pageBaseName(page) {
  return String(page.name || page.url).replace(/\.html?$/i, '');
}

/** 页面 CSS 地址（每个页面一个 styles.css） */
export function pageCssUrl(entry, mapping) {
  const key = String(entry.dataJs?.src || '').replace(/data\.js$/i, 'styles.css');
  const hit = mapping?.styles?.[key];
  return hit ? CDN + hit.sign_md5 : '';
}

/** HTML / mapping 的 CDN 地址 */
export function pageHtmlUrl(entry) {
  return CDN + entry.html.sign_md5;
}

export function pageMappingUrl(entry) {
  return CDN + entry.mapping_md5;
}
