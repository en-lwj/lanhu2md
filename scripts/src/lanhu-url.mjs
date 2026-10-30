/**
 * 解析蓝湖链接。支持两种形态：
 * 1) 工作台：https://lanhuapp.com/web/#/item/project/product?tid=..&pid=..&docId=..
 * 2) 分享：  https://lanhuapp.com/link/#/invite?sid=xxxx[&sign=xxxx]
 */
export function parseLanhuUrl(input) {
  if (!input || typeof input !== 'string') throw new Error('缺少蓝湖链接');
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`不是合法 URL：${input}`);
  }

  const hash = url.hash || '';
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = hashQuery ? new URLSearchParams(hashQuery) : url.searchParams;

  // 分享链接：/link/#/invite?sid=...
  const sid = params.get('sid') || params.get('short_id');
  if (sid) {
    return {
      kind: 'share',
      raw: input.trim(),
      origin: url.origin,
      sid,
      sign: params.get('sign') || '',
    };
  }

  const tid = params.get('tid');
  const pid = params.get('pid');
  const docId = params.get('docId') || params.get('image_id');
  const docType = params.get('docType') || '';

  if (!tid || !pid || !docId) {
    throw new Error(
      '链接里缺少 tid / pid / docId，也不是分享链接（缺 sid）。\n' +
        '请确认复制的是蓝湖「产品」页面的完整链接，或「分享」生成的 /link/#/invite?sid=... 链接。'
    );
  }

  return {
    kind: 'workspace',
    raw: input.trim(),
    origin: url.origin,
    tid,
    pid,
    docId,
    versionId: params.get('versionId') || '',
    pageId: params.get('pageId') || '',
    parentId: params.get('parentId') || '',
    docType,
    sharePassword: '',
  };
}

/** sitemap 节点 id 与 URL 里的 pageId 可能一个有横线一个没有，统一比较 */
export function normalizeId(id) {
  return String(id || '').replace(/-/g, '').toLowerCase();
}
