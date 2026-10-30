import fs from 'node:fs/promises';
import path from 'node:path';
import { CDN } from './axure.mjs';
import { cachedBuffer, mkdirp, safeFileName } from './util.mjs';

/**
 * 给截图用的本地图片：下载到 <renderDir>/assets/uN.png，返回 Map<原始 src, 相对路径>
 */
export async function downloadLayoutAssets({ items, mapping, renderDir, cacheDir }) {
  const assetsDir = path.join(renderDir, 'assets');
  const result = new Map();
  const wanted = items.filter((item) => item.kind === 'image' && item.box?.width > 0);
  if (!wanted.length) return result;
  await mkdirp(assetsDir);
  for (const item of wanted) {
    const sign = mapping?.images?.[item.src]?.sign_md5;
    if (!sign) continue;
    const ext = (path.extname(item.src) || '.png').toLowerCase();
    const fileName = `${item.id}${ext}`;
    const buffer = await cachedBuffer(path.join(cacheDir, 'assets', fileName), CDN + sign);
    await fs.writeFile(path.join(assetsDir, fileName), buffer);
    result.set(item.src, `assets/${fileName}`);
  }
  return result;
}

/**
 * 下载页面里用到的原图切片（Axure 导出的 uN.png / uN.svg）。
 * 返回 Map<原始 src, 相对 md 的路径>
 */
export async function downloadImages({ blocks, mapping, pageName, outDir, cacheDir }) {
  const imagesDirName = safeFileName(pageName);
  const targetDir = path.join(outDir, 'images', imagesDirName);
  const cacheAssets = path.join(cacheDir, 'assets');
  const result = new Map();

  const wanted = blocks.filter((b) => b.type === 'image');
  if (!wanted.length) return result;

  await mkdirp(targetDir);
  for (const block of wanted) {
    const sign = mapping?.images?.[block.src]?.sign_md5;
    if (!sign) continue;
    const ext = (path.extname(block.src) || '.png').toLowerCase();
    const fileName = `${block.id}${ext}`;
    const buffer = await cachedBuffer(path.join(cacheAssets, fileName), CDN + sign);
    await fs.writeFile(path.join(targetDir, fileName), buffer);
    result.set(block.src, ['images', imagesDirName, fileName].join('/'));
  }
  return result;
}
