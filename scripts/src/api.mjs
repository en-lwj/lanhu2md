import { httpGet } from './util.mjs';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

const API = 'https://lanhuapp.com/api';

/**
 * 取文档信息（含所有版本的 axure JSON 地址）。
 * 这一步需要登录态 Cookie，未登录返回 418。
 */
export async function getDocInfo(params, cookie) {
  const url =
    `${API}/project/image?team_id=${encodeURIComponent(params.tid)}` +
    `&project_id=${encodeURIComponent(params.pid)}` +
    `&image_id=${encodeURIComponent(params.docId)}`;

  const res = await httpGet(url, { cookie, referer: `${params.origin}/web/` });

  if (res.status === 418 || res.status === 401 || res.status === 403) {
    throw new AuthError(
      `蓝湖接口返回 ${res.status}：没有访问该项目的权限。\n` +
        '处理：\n' +
        '  1) 交互运行 `lanhu2md login` 登录一次（会自动重试）；\n' +
        '  2) 或用 --cookie "<Cookie 字符串>" / --storage <storageState.json>；\n' +
        '  3) 如果是从分享链接进入，确认当前账号已在分享范围内（有的分享要先「接受邀请/加入项目」）。'
    );
  }
  if (!res.ok) throw new Error(`蓝湖接口请求失败 ${res.status}: ${url}`);

  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw new Error(`蓝湖接口返回的不是 JSON：${res.text.slice(0, 120)}`);
  }
  if (data.code !== '00000' || !data.result) {
    throw new Error(`蓝湖接口返回异常：code=${data.code} msg=${data.msg || ''}`);
  }
  return data.result;
}

/** 按 URL 里的 versionId 选版本，没有就取最新版 */
export function pickVersion(docInfo, versionId) {
  const versions = docInfo.versions || [];
  if (!versions.length) throw new Error('该文档没有可用版本');
  if (versionId) {
    const hit = versions.find((v) => v.id === versionId);
    if (hit) return hit;
  }
  const latest = versions.find((v) => v.id === docInfo.latest_version) || versions[0];
  return latest;
}

/** 版本号展示文案，如「版本3」 */
export function versionLabel(version) {
  if (!version) return '';
  const name = version.version_info || '';
  const time = version.create_time ? String(version.create_time).slice(0, 16) : '';
  return [name, time].filter(Boolean).join(' / ');
}
