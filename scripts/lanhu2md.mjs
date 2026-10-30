#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { parseLanhuUrl } from './src/lanhu-url.mjs';
import { resolveShareWithPrompt } from './src/share.mjs';
import { login, logout } from './src/login.mjs';
import { cacheRoot as cacheBaseDir, outputRoot } from './src/paths.mjs';
import { resolveCookie } from './src/session.mjs';
import { getDocInfo, pickVersion, versionLabel, AuthError } from './src/api.mjs';
import {
  loadVersion,
  flattenSitemap,
  selectPages,
  pageBaseName,
  pageHtmlUrl,
  pageMappingUrl,
  pageCssUrl,
  CDN,
} from './src/axure.mjs';
import { extractItems, buildBlocks } from './src/extract.mjs';
import { renderPageMarkdown, renderIndexMarkdown, buildSections, headingLevel } from './src/render-md.mjs';
import { downloadImages, downloadLayoutAssets } from './src/images.mjs';
import { buildLayoutHtml, canvasSize, screenshotPage, computeScale } from './src/shots.mjs';
import { cachedText, mkdirp, safeFileName, formatBytes } from './src/util.mjs';

function printHelp() {
  console.log(`
lanhu2md —— 蓝湖 Axure 原型链接转需求 Markdown

用法：
  node scripts/lanhu2md.mjs "<蓝湖链接>" [选项]
  node scripts/lanhu2md.mjs login            # 打开浏览器登录，缓存到 ~/.lanhu2md/session.json
  node scripts/lanhu2md.mjs logout [--purge] # 删除登录态（--purge 连浏览器 profile 一起删）

范围：
  --all                 转换整个原型（含 index.md 目录）
  --page <名称|id>      只转换指定页面（默认：链接里 pageId 指向的页面）
  --list                只列出原型里的所有页面

输出：
  --out <目录>          输出根目录（默认 ~/.lanhu2md/output，实际为 <目录>/<文档名>）
  --clean               转换前先清空本文件的输出目录（默认保留/覆盖）
  --format md|json|both 输出格式（默认 md）
  --no-images           不下载/不内嵌图片，只输出纯文字需求
  --images              显式开启图片（默认已开启，保留兼容）
  --shots               输出整页布局图 shots/<页名>.png（无头 Edge/Chrome）
  --dpr <数字>          截图倍率（默认 1）
  --max-side <像素>     单张位图最长边上限（默认 8000，超过自动降采样）
  --edge <路径>         指定浏览器可执行文件

登录态（仅取版本信息时需要）：
  --cookie "<k=v; ...>" 直接给 Cookie
  --storage <文件>      Playwright storageState.json
  --share-password <pwd> 分享链接的密码（也可用 LANHU_SHARE_PASSWORD）
  也支持环境变量 LANHU_COOKIE / LANHU_STORAGE，或项目下的 .cookie / .storage.json

其他：
  --no-cache            忽略 .cache 重新下载
  --concurrency <n>     并发数（默认 4）
  -h, --help            显示帮助
`);
}

function parseArgs(argv) {
  const opts = { out: '', format: 'md', dpr: 1, maxSide: 8000, concurrency: 4, images: true };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少参数值`);
      return argv[i];
    };
    switch (arg) {
      case '--all':
        opts.all = true;
        break;
      case '--page':
        opts.page = next();
        break;
      case '--list':
        opts.list = true;
        break;
      case '--out':
        opts.out = next();
        break;
      case '--clean':
        opts.clean = true;
        break;
      case '--format':
        opts.format = next();
        break;
      case '--images':
        opts.images = true;
        break;
      case '--no-images':
        opts.images = false;
        break;
      case '--shots':
        opts.shots = true;
        break;
      case '--dpr':
        opts.dpr = Number(next());
        break;
      case '--max-side':
        opts.maxSide = Math.max(1000, Number(next()) || 8000);
        break;
      case '--edge':
        opts.edge = next();
        break;
      case '--cookie':
        opts.cookie = next();
        break;
      case '--share-password':
        opts.sharePassword = next();
        break;
      case '--storage':
        opts.storage = next();
        break;
      case '--no-cache':
        opts.noCache = true;
        break;
      case '--concurrency':
        opts.concurrency = Math.max(1, Number(next()) || 1);
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
        rest.push(arg);
    }
  }
  opts.url = rest[0];
  return opts;
}

function uniqueFileName(baseName, used) {
  let name = `${baseName}.md`;
  if (used.has(name)) {
    let index = 2;
    while (used.has(`${baseName}_${index}.md`)) index += 1;
    name = `${baseName}_${index}.md`;
  }
  used.add(name);
  return name;
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printShareError(params, result, hadPassword) {
  console.error('\n[分享链接解析失败]');
  console.error(`  sid：${params.sid}`);
  console.error(`  接口返回：code=${result.code}${result.message ? ' / ' + result.message : ''}`);

  switch (String(result.code)) {
    case '30015':
      console.error('  原因：该分享链接设置了密码，当前没有提供或密码字段未被接受。');
      console.error('  处理：--share-password <密码>，或设置环境变量 LANHU_SHARE_PASSWORD；交互终端会提示输入。');
      break;
    case '30501':
      console.error('  原因：该分享要求登录后才能查看（多数还要求先加入项目/团队）。');
      console.error('  处理：运行 `lanhu2md login` 登录一次并缓存，或 --storage/--cookie 提供有权限的账号。');
      console.error('        如果登录后仍提示无权限，说明该账号还没被加入项目，需要分享者先把你加入团队/项目。');
      break;
    case '30016':
      console.error('  原因：密码不正确。');
      console.error('  处理：确认分享者给的密码（区分大小写），或重新输入。');
      break;
    case '30018':
      console.error('  原因：sid 无效 / 分享已失效或被关闭。');
      console.error('  处理：让分享者重新生成链接；注意 PowerShell 里要用单引号包住链接。');
      break;
    default:
      console.error('  处理：确认链接可用；仍失败可改用工作台链接 + --storage/--cookie。');
  }

  if (result.raw?.message) {
    console.error(`  服务端消息：${String(result.raw.message).split('\n').filter(Boolean).join(' / ')}`);
  }
  console.error('  提示：分享链接只负责解析出项目地址，读取原型内容仍需要登录态。');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // 子命令：login / logout
  if (rawArgs[0] === 'login') {
    try {
      await login({});
    } catch (error) {
      console.error(`\n[登录失败] ${error.message}`);
      console.error('  也可以用 --cookie / --storage 手动提供登录态。');
      process.exitCode = 1;
    }
    return;
  }
  if (rawArgs[0] === 'logout') {
    await logout({ purgeProfile: rawArgs.includes('--purge') });
    return;
  }

  const opts = parseArgs(rawArgs);
  if (opts.help) {
    printHelp();
    return;
  }
  if (!opts.url) {
    printHelp();
    throw new Error('缺少蓝湖链接');
  }
  if (!['md', 'json', 'both'].includes(opts.format)) throw new Error('--format 只能是 md / json / both');
  if (opts.edge) process.env.EDGE_PATH = opts.edge;

  let params = parseLanhuUrl(opts.url);
  let cookie = await resolveCookie(opts);
  let fromShare = false;

  if (params.kind === 'share') {
    fromShare = true;
    console.log(`识别为分享链接：sid=${params.sid}`);
    const sharePassword = opts.sharePassword || process.env.LANHU_SHARE_PASSWORD || '';
    const resolvedOnce = await resolveShareWithPrompt({
      sid: params.sid,
      sign: params.sign,
      password: sharePassword,
      cookie,
      interactive: Boolean(process.stdin.isTTY),
    });
    let resolved = resolvedOnce;

    // 30501：该分享要求登录（通常还要先加入项目）——直接引导登录并重试一次
    if (!resolved.ok && resolved.needLogin && !cookie) {
      if (process.stdin.isTTY) {
        const yes = await askYesNo('该分享需要登录后才能查看，是否现在打开浏览器登录？(y/N) ');
        if (yes) {
          try {
            await login({});
            cookie = await resolveCookie({});
            if (cookie) {
              resolved = await resolveShareWithPrompt({
                sid: params.sid,
                sign: params.sign,
                password: sharePassword,
                cookie,
                interactive: false,
              });
            }
          } catch (error) {
            console.error(`\n[登录失败] ${error.message}`);
          }
        }
      } else {
        console.error('\n[需要登录] 该分享要求登录后才能查看。请在交互终端运行 `lanhu2md login`，或提供 --storage/--cookie。');
      }
    }

    if (!resolved.ok) {
      printShareError(params, resolved, Boolean(sharePassword));
      process.exitCode = 1;
      return;
    }
    if (!resolved.url) {
      console.error('\n[分享链接] 解析成功但没有返回项目地址，可能是链接类型不支持（仅支持分享到「产品/原型」的链接）。');
      process.exitCode = 1;
      return;
    }
    console.log(`分享解析成功 → ${resolved.url.slice(0, 120)}...`);
    if (resolved.needsJoin) {
      console.warn(
        '  ! 这是「项目邀请链接」：解析到的地址可用，但读取内容要求你的账号已加入该项目。\n' +
          '    若下面提示 418/无权限，请先接受邀请（或让分享者把你加入团队/项目）。'
      );
    }
    opts.url = resolved.url; // md 头部的来源记录实际项目链接
    try {
      params = parseLanhuUrl(resolved.url);
    } catch (error) {
      console.error('\n[分享链接] 已解析成功，但返回的地址不是「原型文档」链接。');
      console.error(`  返回地址：${resolved.url}`);
      console.error('  可能原因：这是团队/项目邀请链接，而不是分享到某个设计稿的链接。');
      console.error('  处理：在蓝湖里打开具体原型页面再点「分享」，或直接用工作台链接。');
      process.exitCode = 1;
      return;
    }
  }

  if (!cookie) {
    console.warn(
      '提示：未提供登录态 Cookie。\n' +
        (fromShare ? '      分享链接只负责“找到项目”，读取原型内容仍需要一个有该项目权限的账号。\n' : '') +
        '      可用 `lanhu2md login` 登录一次并缓存，或用 --cookie / --storage 指定。'
    );
  }

  console.log(`解析链接：${params.pid} / ${params.docId}`);

  let docInfo;
  try {
    docInfo = await getDocInfo(params, cookie);
  } catch (error) {
    // 任何链接遇到 418 都按需登录：交互终端问一句，非交互只给指引
    const canOfferLogin = error instanceof AuthError && process.stdin.isTTY;
    if (!canOfferLogin) throw error;

    const question = cookie
      ? '当前账号没有该项目权限，是否换一个账号登录？(y/N) '
      : '该链接需要登录后才能读取，是否现在打开浏览器登录？(y/N) ';
    const yes = await askYesNo(question);
    if (!yes) {
      console.error('\n[退出] 已跳过登录。可稍后运行 `lanhu2md login`，或改用 --cookie / --storage。');
      process.exitCode = 1;
      return;
    }

    await login({});
    cookie = await resolveCookie({});
    if (!cookie) throw new Error('登录后仍未拿到登录态，请重试或改用 --cookie');
    docInfo = await getDocInfo(params, cookie);
  }
  const version = pickVersion(docInfo, params.versionId);
  const label = versionLabel(version);
  console.log(`文档：${docInfo.name}（${label || '未知版本'}）`);

  // 缓存统一放 ~/.lanhu2md/.cache（可用 LANHU2MD_HOME / LANHU_CACHE_DIR 覆盖）
  const cacheRoot = path.join(cacheBaseDir(), safeFileName(params.pid), safeFileName(version.id || 'latest'));
  if (opts.noCache) await fs.rm(cacheRoot, { recursive: true, force: true });

  const versionJson = await loadVersion(version.json_url, cacheRoot);
  const sitemap = flattenSitemap(versionJson.sitemap.rootNodes).filter((p) => versionJson.pages[p.url]);

  if (opts.list) {
    console.log(`\n共 ${sitemap.length} 个页面：`);
    for (const page of sitemap) {
      console.log(` - ${page.path.join(' / ')}  (${page.url})`);
    }
    return;
  }

  const targets = opts.all ? sitemap : selectPages(versionJson, sitemap, params, opts);
  const docDirName = safeFileName(docInfo.name || 'lanhu');
  const outDir = opts.out
    ? path.resolve(process.cwd(), opts.out, docDirName)
    : path.join(outputRoot(), docDirName);
  if (opts.clean) {
    await fs.rm(outDir, { recursive: true, force: true });
    console.log(`--clean：已清空 ${outDir}`);
  }
  await mkdirp(outDir);
  console.log(`输出目录：${outDir}`);
  console.log(`待转换页面：${targets.length} 个\n`);

  const entries = [];
  const pagesDir = path.join(cacheRoot, 'pages');
  const usedFileNames = new Set();

  for (const page of targets) {
    const entry = versionJson.pages[page.url];
    const cacheKey = `${safeFileName(pageBaseName(page))}-${page.id || 'p'}`;
    const html = await cachedText(path.join(pagesDir, `${cacheKey}.html`), pageHtmlUrl(entry));
    const mapping = JSON.parse(
      await cachedText(path.join(pagesDir, `${cacheKey}.mapping.json`), pageMappingUrl(entry))
    );
    const cssUrl = pageCssUrl(entry, mapping);
    const css = cssUrl ? await cachedText(path.join(pagesDir, `${cacheKey}.css`), cssUrl) : '';

    const items = extractItems(html, css);
    const blocks = buildBlocks(items);
    const imageMap = opts.images
      ? await downloadImages({ blocks, mapping, pageName: pageBaseName(page), outDir, cacheDir: cacheRoot })
      : null;

    const markdown = renderPageMarkdown({
      page,
      pagePath: page.path,
      docName: docInfo.name,
      versionLabel: label,
      sourceUrl: opts.url,
      blocks,
      imageMap,
      inlineImages: Boolean(opts.images),
    });

    const fileName = uniqueFileName(safeFileName(pageBaseName(page)), usedFileNames);
    const base = fileName.replace(/\.md$/, '');
    await fs.writeFile(path.join(outDir, fileName), markdown, 'utf8');

    let shotRel = '';
    if (opts.shots) {
      const renderDir = path.join(cacheRoot, 'render', base);
      const size = canvasSize(css);
      const scale = computeScale(size, opts.dpr, opts.maxSide);
      if (scale < opts.dpr - 0.001) {
        console.warn(`  ! 画布 ${size.width}×${size.height}，${opts.dpr}x 超过单张上限 ${opts.maxSide}px，已降为 ${scale.toFixed(2)}x（可 --max-side 调大）`);
      }
      await mkdirp(renderDir);
      const assetMap = await downloadLayoutAssets({ items, mapping, renderDir, cacheDir: cacheRoot });
      const cssHrefs = Object.values(mapping.styles || {}).map((item) => CDN + item.sign_md5);
      const htmlFile = path.join(renderDir, `${base}.html`);
      await fs.writeFile(htmlFile, buildLayoutHtml({ items, mapping, size, assetMap, cssHrefs }), 'utf8');
      const outPng = path.join(outDir, 'shots', `${base}.png`);
      const shot = await screenshotPage({ htmlFile, outPng, size, scale });
      shotRel = path.relative(outDir, outPng).replace(/\\/g, '/');
      console.log(`  截图 ${base} → ${shotRel} (${shot.width}×${shot.height}, ${formatBytes(shot.bytes)})`);
    }

    if (opts.format === 'json' || opts.format === 'both') {
      const sections = buildSections(blocks).map((section) => ({
        level: section.level,
        title: section.title,
        text: section.text,
        images: section.images.map((image) => ({ ...image, file: imageMap?.get(image.src) || '' })),
      }));
      await fs.writeFile(
        path.join(outDir, `${base}.json`),
        JSON.stringify(
          {
            doc: docInfo.name,
            version: label,
            page: { name: page.name, url: page.url, path: page.path },
            source: opts.url,
            shot: shotRel,
            blocks: blocks.map((block) =>
              block.type === 'text'
                ? { ...block, level: headingLevel(block.text.split('\n')[0].trim()) }
                : block
            ),
            sections,
            markdown,
          },
          null,
          2
        ),
        'utf8'
      );
    }

    const textCount = blocks.filter((b) => b.type === 'text').length;
    const imageCount = blocks.filter((b) => b.type === 'image').length;
    console.log(`  ✓ ${page.path.join(' / ')} → ${fileName}（文本块 ${textCount}，图片 ${imageCount}）`);
    entries.push({ pageName: page.name, pagePath: page.path, file: fileName });
  }

  if (targets.length > 1) {
    await fs.writeFile(
      path.join(outDir, 'index.md'),
      renderIndexMarkdown({ docName: docInfo.name, versionLabel: label, sourceUrl: opts.url, entries }),
      'utf8'
    );
    console.log(`\n目录已生成：index.md（${entries.length} 页）`);
  }

  console.log('\n完成。');
}

main().catch((error) => {
  if (error instanceof AuthError) {
    console.error(`\n[登录态问题] ${error.message}`);
  } else {
    console.error(`\n[失败] ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
  }
  process.exitCode = 1;
});
