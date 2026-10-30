import fs from 'node:fs/promises';
import path from 'node:path';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function mkdirp(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/** 还原 Axure 导出 HTML 里的实体（&#x..; / &#..; / &nbsp; 等） */
export function decodeEntities(input) {
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** GET 请求，返回 { status, ok, buf, text }；带简单重试 */
export async function httpGet(url, { cookie, referer = 'https://lanhuapp.com/web/', retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const headers = { 'user-agent': UA, referer };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(url, { headers, redirect: 'follow' });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, ok: res.ok, buf, text: buf.toString('utf8') };
    } catch (error) {
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

/** 带磁盘缓存的文本 GET（用于 html / css / json） */
export async function cachedText(cacheFile, url, opts = {}) {
  const hit = await readTextIfExists(cacheFile);
  if (hit != null) return hit;
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`请求失败 ${res.status}: ${url}`);
  await mkdirp(path.dirname(cacheFile));
  await fs.writeFile(cacheFile, res.text, 'utf8');
  return res.text;
}

/** 带磁盘缓存的二进制 GET（用于图片） */
export async function cachedBuffer(cacheFile, url, opts = {}) {
  try {
    return await fs.readFile(cacheFile);
  } catch {
    /* 未命中缓存 */
  }
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`请求失败 ${res.status}: ${url}`);
  await mkdirp(path.dirname(cacheFile));
  await fs.writeFile(cacheFile, res.buf);
  return res.buf;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 文件名安全化（Windows 非法字符） */
export function safeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

export function stripHtml(fragment) {
  return decodeEntities(
    String(fragment)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
