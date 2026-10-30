import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CDN } from './axure.mjs';
import { mkdirp } from './util.mjs';

const BROWSER_CANDIDATES = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

export async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* 继续找 */
    }
  }
  throw new Error('未找到 Edge / Chrome，可用 --edge <可执行文件路径> 或环境变量 EDGE_PATH 指定');
}

/** 从页面 CSS 推算画布尺寸（所有控件的最右 / 最下边界） */
export function canvasSize(css) {
  let maxX = 0;
  let maxY = 0;
  const ruleRe = /#(u\d+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(css || ''))) {
    const body = match[2];
    const num = (key) => {
      const m = body.match(new RegExp(`(?:^|;)\\s*${key}:\\s*(-?[\\d.]+)px`));
      return m ? parseFloat(m[1]) : 0;
    };
    maxX = Math.max(maxX, num('left') + num('width'));
    maxY = Math.max(maxY, num('top') + num('height'));
  }
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}

/** 画布 × dpr 超过单张位图上限时自动降采样（默认 8000，实测 15451 宽很容易超时/截白） */
export function computeScale(size, dpr = 1, maxDim = 8000) {
  const longest = Math.max(size.width || 1, size.height || 1);
  const wanted = Number(dpr) > 0 ? Number(dpr) : 1;
  if (longest * wanted <= maxDim) return wanted;
  return maxDim / longest;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 用「原始控件标签 + 原图 + 页面 CSS」重建一张静态 HTML。
 * 文本直接复用 Axure 导出的原始结构（<p style="font-size:.."> 都在里面），
 * 这样字号、缩进、换行和原型一致；只补一个 <base> 让所有资源指向签名地址。
 */
export function buildLayoutHtml({ items, mapping, size, assetMap, cssHrefs = [] }) {
  const links = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
  const parts = [];

  for (const item of items) {
    const box = item.box || {};
    if (item.kind === 'image') {
      const local = assetMap?.get(item.src);
      const sign = mapping?.images?.[item.src]?.sign_md5;
      const src = local || (sign ? CDN + sign : '');
      if (!src || !box.width || !box.height) continue;
      parts.push(
        `<img src="${src}" style="position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px">`
      );
      continue;
    }
    // 容器（分组）会包含子控件的 HTML，交给子控件渲染，避免重复
    if (item.isContainer || !item.openTag || !item.html) continue;
    parts.push(`${item.openTag}${item.html}</div>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8">
${links}
<style>
html,body{margin:0;background:#fff;position:relative;left:0!important;margin-left:0!important}
body{width:${size.width}px;height:${size.height}px;
  font-family:"Microsoft YaHei","PingFang SC","Segoe UI",Arial,sans-serif}
</style></head>
<body>${parts.join('\n')}</body></html>`;
}

/** 无头浏览器整页截图（Edge/Chrome CLI，不依赖 npm 包） */
export async function screenshotPage({ htmlFile, outPng, size, scale = 1 }) {
  const winW = Math.max(320, Math.round(size.width * scale));
  const winH = Math.max(240, Math.round(size.height * scale));
  const browser = await findBrowser();
  await mkdirp(path.dirname(outPng));
  await killStaleBrowsers();
  const pageUrl = 'file:///' + htmlFile.replace(/\\/g, '/');

  // Chromium 在 Windows 上写不了含中文/全角字符的路径，先落到 ASCII 临时目录再搬回去
  const tempOut = path.join(os.tmpdir(), `lanhu-shot-${Date.now()}.png`);
  const profileDir = path.join(os.tmpdir(), `lanhu-edge-${process.pid}-${Date.now()}`);

  const baseArgs = [
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=8000',
    `--window-size=${winW},${winH}`,
  ];

  const attempts = [
    ['--headless=new', ...baseArgs, `--screenshot=${tempOut}`, pageUrl],
    ['--headless', ...baseArgs, `--screenshot=${tempOut}`, pageUrl],
  ];

  let lastError;
  try {
    for (const args of attempts) {
      let child = null;
      try {
        await fs.rm(tempOut, { force: true });
        // Chromium 会把自身重新拉起成子进程：用 detached + stdio:ignore 启动，
        // 否则 execFile 会在真正写完文件前返回。
        child = spawn(browser, args, { detached: true, stdio: 'ignore' });
        child.unref();
        const stat = await waitForFile(tempOut, 120000);
        if (stat && stat.size > 0) {
          await fs.copyFile(tempOut, outPng);
          await fs.rm(tempOut, { force: true });
          return { width: winW, height: winH, scale, bytes: stat.size };
        }
        lastError = new Error('截图文件为空');
      } catch (error) {
        lastError = error;
      } finally {
        // headless Chromium 写完图不一定马上退出，残留进程会锁住 profile 目录
        if (child?.pid) killTree(child.pid);
      }
    }
  } finally {
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  throw new Error(`整页截图失败：${lastError?.message || lastError}`);
}

/** 结束整棵进程树（Windows 下只用 kill 会留下 renderer/utility 子进程） */
function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    /* 进程可能已经退出 */
  }
}

/**
 * 清掉上次残留的 headless 浏览器（只匹配本项目 profile 前缀 lanhu-edge-，
 * 不会动用户自己开的 Edge/Chrome）。残留过多会导致新截图一直等不到文件。
 */
function killStaleBrowsers() {
  if (process.platform !== 'win32') return;
  try {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*lanhu-edge-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 20000 }
    );
  } catch {
    /* 清理失败不影响主流程 */
  }
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 0) return stat;
    } catch {
      /* 还没生成 */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}
