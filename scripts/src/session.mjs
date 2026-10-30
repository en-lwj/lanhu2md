import fs from 'node:fs/promises';
import path from 'node:path';
import { sessionFile } from './paths.mjs';

/**
 * 登录态解析优先级：
 *   1. --cookie "k=v; k2=v2"
 *   2. --storage <playwright storageState.json>
 *   3. 环境变量 LANHU_COOKIE / LANHU_STORAGE
 *   4. 项目或当前目录下的 .cookie / .storage.json
 */
export async function resolveCookie(opts = {}) {
  if (opts.cookie) return normalizeCookie(opts.cookie);

  if (opts.storage) return cookieFromStorage(opts.storage);

  if (process.env.LANHU_COOKIE) return normalizeCookie(process.env.LANHU_COOKIE);
  if (process.env.LANHU_STORAGE) return cookieFromStorage(process.env.LANHU_STORAGE);

  // lanhu2md login 保存的登录态（~/.lanhu2md/session.json）
  const homeSession = sessionFile();
  try {
    await fs.access(homeSession);
    return cookieFromStorage(homeSession);
  } catch {
    /* 没有登录态 */
  }

  for (const candidate of ['.cookie', path.join('.lanhu', 'cookie.txt')]) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (raw.trim()) return normalizeCookie(raw.trim());
    } catch {
      /* 忽略 */
    }
  }
  for (const candidate of ['.storage.json', path.join('.lanhu', 'storage.json')]) {
    try {
      await fs.access(candidate);
      return cookieFromStorage(candidate);
    } catch {
      /* 忽略 */
    }
  }
  return '';
}

function normalizeCookie(raw) {
  const text = raw.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    // 传进来的可能是 JSON 数组
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.cookies || [];
      return list.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch {
      /* 按普通字符串处理 */
    }
  }
  return text.replace(/\r?\n/g, ' ').replace(/^cookie:\s*/i, '').trim();
}

async function cookieFromStorage(file) {
  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw);
  const cookies = Array.isArray(data) ? data : data.cookies || [];
  const picked = cookies.filter((c) => String(c.domain || '').includes('lanhuapp.com'));
  if (!picked.length) throw new Error(`${file} 里没有 lanhuapp.com 的 Cookie`);
  return picked.map((c) => `${c.name}=${c.value}`).join('; ');
}
