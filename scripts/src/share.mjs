import readline from 'node:readline';

const RESOLVE_URL = 'https://lanhuapp.com/api/share/url/resolve';

/**
 * 分享接口返回码（实测）：
 *   0     已登录账号下的成功
 *   30015 需要密码（未提供或密码字段无效）
 *   30016 密码错误
 *   30017 匿名访问的成功
 *   30018 sid 无效
 */
const CODE = {
  OK_ANON: 30017,
  OK_LOGGED_IN: 0,
  JOIN_REQUIRED: 30010,
  NEED_LOGIN: 30501,
  NEED_PASSWORD: 30015,
  WRONG_PASSWORD: 30016,
  INVALID_SID: 30018,
};

/**
 * 分享链接（/link/#/invite?sid=xxx）→ 工作台链接。
 * 匿名即可调用；带密码的分享需要 password。
 */
export async function resolveShare({ sid, sign = '', password = '', cookie = '' }) {
  const body = { short_id: sid };
  if (sign) body.sign = sign;
  if (password) body.password = password;

  const res = await fetch(RESOLVE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://lanhuapp.com/link/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, code: res.status, message: `分享接口请求失败 HTTP ${res.status}`, raw: null };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { ok: false, code: 'bad-json', message: '分享接口返回的不是 JSON', raw: null };
  }

  const code = json.code;
  const data = json.data || {};

  if (code === CODE.OK_ANON || code === CODE.OK_LOGGED_IN || code === CODE.JOIN_REQUIRED) {
    if (!data.url) {
      return { ok: false, code, message: '接口返回成功但没有 url（可能是团队/项目邀请链接）', raw: json };
    }
    return {
      ok: true,
      code,
      url: data.url,
      needsJoin: code === CODE.JOIN_REQUIRED,
      message: '',
      raw: json,
    };
  }

  if (code === CODE.NEED_LOGIN) {
    return {
      ok: false,
      code,
      needLogin: true,
      message: '该分享需要登录后才能查看（可能还要求加入项目/团队）',
      raw: json,
    };
  }

  if (code === CODE.NEED_PASSWORD) {
    return {
      ok: false,
      code,
      needPassword: !password,
      message: password ? '密码无效（分享可能已变更密码）' : '该分享需要密码',
      raw: json,
    };
  }

  if (code === CODE.WRONG_PASSWORD) {
    return { ok: false, code, wrongPassword: true, message: '密码不正确', raw: json };
  }

  if (code === CODE.INVALID_SID) {
    return { ok: false, code, message: '分享参数无效（sid 不完整或已失效）', raw: json };
  }

  return { ok: false, code, message: json.message || '未知错误', raw: json };
}

/** 逐级解析：匿名 → 需要密码时交互输入 */
export async function resolveShareWithPrompt({ sid, sign, password, cookie, interactive = true }) {
  const first = await resolveShare({ sid, sign, password, cookie });
  if (first.ok) return first;
  if (!first.needPassword || password) return first;
  if (!interactive) return first;

  const pwd = await askPassword(`分享链接需要密码（${sid}）：`);
  if (!pwd) return { ...first, message: '未输入密码，已取消' };
  return resolveShare({ sid, sign, password: pwd, cookie });
}

/** 隐藏回显地读取密码 */
export function askPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const original = rl._writeToOutput?.bind(rl);
    let promptShown = false;
    rl._writeToOutput = (text) => {
      if (!promptShown) {
        promptShown = true;
        original?.(text);
        return;
      }
      if (text.includes('\n') || text.includes('\r')) original?.(text);
      else original?.('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}
