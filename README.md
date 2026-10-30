# lanhu2md

通用 agent skill（OpenCode 等）：把蓝湖（lanhuapp）Axure 原型链接转成带截图的需求 Markdown。可选整页布局图与 JSON。

## 安装

### 1. 全局命令（可选，任何终端 / agent 都能用）

```bash
npm i -g lanhu2md
```

### 2. 装成 agent skill

```bash
# 通用写法：按提示选择装给哪个 agent
npx skills add https://github.com/en-lwj/lanhu2md -s lanhu2md -g

# 指定 OpenCode
npx skills add https://github.com/en-lwj/lanhu2md -a opencode -s lanhu2md -g
```

- `-s lanhu2md`：选仓库里的哪个 skill（仓库只有一个：`skills/lanhu2md/SKILL.md`）
- `-g`：装到用户级；去掉装到当前项目（`.agents/skills/`）
- 不写 `-a` 时由安装器提示选择 agent

skill 目录里只有 `SKILL.md`（调用说明），实际执行靠第 1 步的全局命令；没有全局命令时 SKILL.md 会退回 `npx -y lanhu2md@latest`。

两者是同一份代码：CLI 走 npm 包，源码在仓库 `scripts/`，npm 不可达时用仓库脚本兜底。

`login` 需要可选依赖 `playwright-core`（`npx` / 全局安装时会随包自动带上；用仓库脚本时先在仓库 `npm i`）。

## 用法

在**任意目录**执行，不要 `cd` 到仓库目录（否则产物会落在仓库里）。下面统一写 `lanhu2md`；没有全局命令时换成 `npx -y lanhu2md@latest`：

```powershell
lanhu2md '<蓝湖链接>'             # 默认：链接指向的页面，带图
lanhu2md '<链接>' --all           # 全部页面 + index.md
lanhu2md '<链接>' --page 首页     # 指定页面
lanhu2md '<链接>' --out .\docs    # 产物落到项目内
```

PowerShell 里链接必须用单引号（含 `&`、`#`）。

### 选项

| 选项 | 含义 | 默认 |
| --- | --- | --- |
| `--all` | 转换原型里的全部页面；页数 > 1 时生成 `index.md` 目录 | 只转链接指向的那页 |
| `--page <名称\|id>` | 只转指定页面；按「名称完全匹配 → id → 名称包含」查找 | 链接里的 `pageId`，没有则第一页 |
| `--list` | 只列出原型的所有页面，不写产物 | 关 |
| `--out <目录>` | 输出根目录，实际写到 `<目录>/<文档名>/`（相对当前目录解析） | `~/.lanhu2md/output` |
| `--clean` | 转换前先清空该文档的输出目录 | 保留并覆盖 |
| `--format md\|json\|both` | `json` / `both` 额外生成同名 `.json`（含 blocks / sections / markdown） | `md` |
| `--no-images` | 不下载、不内嵌图片，只出文字 | 带图 |
| `--images` | 显式开启图片（兼容保留） | 开 |
| `--shots` | 额外输出整页布局图 `shots/<页名>.png` | 关 |
| `--dpr <数字>` | 截图倍率 | `1` |
| `--max-side <像素>` | 单张位图最长边上限，超出自动降采样，最小 1000 | `8000` |
| `--edge <路径>` | 指定截图用的浏览器可执行文件 | 自动找本机 Edge / Chrome |
| `--cookie "<k=v; …>"` | 登录态 Cookie；分享链接优先用匿名分享会话，接口 418 后才回退到它 | 依次找 `--cookie` → `--storage` → `LANHU_COOKIE` / `LANHU_STORAGE` → `~/.lanhu2md/session.json` → 项目 `.cookie` / `.storage.json` |
| `--storage <文件>` | Playwright `storageState.json`（自动取 `lanhuapp.com` 的 Cookie） | 同上，优先级仅次于 `--cookie` |
| `--share-password <pwd>` | 分享链接密码 | 读 `LANHU_SHARE_PASSWORD`，没有则交互询问 |
| `--no-cache` | 忽略 `.cache` 重新下载 | 用缓存 |
| `--concurrency <n>` | 并发下载数，最小 1 | `4` |
| `-h`, `--help` | 显示帮助 | |

分享链接（`/link/#/invite?sid=...`）会自带「仅查看」匿名会话（`lhquickshare_session`），默认**优先匿名读取**分享范围内的内容，不需要登录。只有匿名会话失效或范围不足（接口 418）时，才回退到 `--cookie` / 已缓存登录态；仍失败再提示 `lanhu2md login`。

### 子命令

| 命令 | 含义 |
| --- | --- |
| `lanhu2md login` | 打开浏览器登录蓝湖，登录态缓存到 `~/.lanhu2md/session.json`，之后不用重复登录 |
| `lanhu2md logout` | 删除缓存的登录态 |
| `lanhu2md logout --purge` | 删除登录态，同时删掉 `browser-profile/` |

### 环境变量

| 变量 | 含义 |
| --- | --- |
| `LANHU2MD_HOME` | 换整个状态根目录（输出、缓存、登录态、浏览器 profile 都跟着走） |
| `LANHU_CACHE_DIR` | 只换下载缓存目录 |
| `LANHU_COOKIE` | 蓝湖 Cookie，等价 `--cookie` |
| `LANHU_STORAGE` | storageState 文件，等价 `--storage` |
| `LANHU_SHARE_PASSWORD` | 分享链接密码，等价 `--share-password` |

离线 / 内网兜底：clone 仓库后 `node scripts/lanhu2md.mjs '<链接>'`。

## 产物与缓存

```
~/.lanhu2md/
├─ output/<文档名>/<页名>.md      # 默认产物（--out 可改到项目内）
├─ output/<文档名>/images/<页名>/  # 原型原始切片
├─ output/<文档名>/shots/<页名>.png # --shots
├─ .cache/                         # 下载缓存，可随时删
├─ session.json                    # login 登录态
└─ browser-profile/                # login 的 Edge profile
```

`LANHU2MD_HOME` 可整体换根目录，`LANHU_CACHE_DIR` 只换缓存。

## 目录

```
skills/lanhu2md/SKILL.md   技能说明（agent 读取，不含脚本）
scripts/lanhu2md.mjs       CLI
scripts/src/               链接解析、蓝湖接口、章节聚合、md 渲染、截图
```

## 许可

MIT
