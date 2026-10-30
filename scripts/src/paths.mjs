import os from 'node:os';
import path from 'node:path';

/**
 * 所有本地状态的根目录（缓存 / 产物 / 登录态 / 浏览器 profile）。
 * 默认 ~/.lanhu2md，可用 LANHU2MD_HOME 覆盖。
 */
export function homeDir() {
  return process.env.LANHU2MD_HOME
    ? path.resolve(process.env.LANHU2MD_HOME)
    : path.join(os.homedir(), '.lanhu2md');
}

/** 下载缓存根目录（版本 JSON、页面 HTML/CSS、原图切片） */
export function cacheRoot() {
  return process.env.LANHU_CACHE_DIR
    ? path.resolve(process.env.LANHU_CACHE_DIR)
    : path.join(homeDir(), '.cache');
}

/** 产物根目录（<文档名>/ 前缀由调用方拼） */
export function outputRoot() {
  return path.join(homeDir(), 'output');
}

/** login 保存的登录态 */
export function sessionFile() {
  return path.join(homeDir(), 'session.json');
}

/** login 使用的持久化浏览器 profile */
export function profileDir() {
  return path.join(homeDir(), 'browser-profile');
}
