import fs from 'node:fs/promises';
import path from 'node:path';
import { mkdirp } from './util.mjs';
import { sessionFile, profileDir } from './paths.mjs';

const USER_TEAMS = 'https://lanhuapp.com/api/account/user_teams';

export function sessionPath() {
  return sessionFile();
}

async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    throw new Error(
      '缺少 playwright-core（只有 login 子命令需要）。\n' +
        '安装：npm install -g playwright-core\n' +
        '或者不用 login，改用 --cookie / --storage 提供登录态。'
    );
  }
}

/** 检测当前页面是否已登录 */
async function isLoggedIn(context) {
  try {
    const res = await context.request.get(USER_TEAMS, { timeout: 15000 });
    if (res.status() !== 200) return false;
    const json = await res.json();
    return json?.code === '00000' || json?.success === true;
  } catch {
    return false;
  }
}

/**
 * 打开有头浏览器让用户登录，登录成功后把 lanhuapp 的 Cookie 存成 storageState。
 * 持久化 profile，第二次通常无需重新登录。
 */
export async function login({ timeoutMs = 5 * 60 * 1000, log = console.log } = {}) {
  const { chromium } = await loadPlaywright();
  const profile = profileDir();
  await mkdirp(profile);

  log('正在打开浏览器，请完成蓝湖登录（扫码/密码/SSO 均可）…');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://lanhuapp.com/web/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    let ok = await isLoggedIn(context);
    while (!ok && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      ok = await isLoggedIn(context);
    }
    if (!ok) {
      throw new Error('等待登录超时（5 分钟）。请重试，或改用 --cookie / --storage 手动提供登录态。');
    }

    const state = await context.storageState();
    const cookies = (state.cookies || []).filter((c) => String(c.domain).includes('lanhuapp.com'));
    if (!cookies.length) throw new Error('登录成功但没有拿到 lanhuapp 的 Cookie，请重试');

    const target = sessionFile();
    await mkdirp(path.dirname(target));
    await fs.writeFile(target, JSON.stringify({ cookies, origins: [] }, null, 2), 'utf8');
    log(`登录成功，已保存 ${cookies.length} 个 Cookie → ${target}`);
    return { sessionFile: target, cookieCount: cookies.length };
  } finally {
    await context.close().catch(() => {});
  }
}

/** 删除本地登录态（可选连浏览器 profile 一起删） */
export async function logout({ purgeProfile = false, log = console.log } = {}) {
  const target = sessionFile();
  await fs.rm(target, { force: true });
  log(`已删除 ${target}`);
  if (purgeProfile) {
    const profile = profileDir();
    await fs.rm(profile, { recursive: true, force: true });
    log(`已删除浏览器 profile ${profile}`);
  }
}
