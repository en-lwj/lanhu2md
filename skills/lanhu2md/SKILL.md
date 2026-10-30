---
name: lanhu2md
description: 把蓝湖（lanhuapp）Axure 原型链接转成带截图的需求 Markdown。用户给出 lanhuapp.com 链接（工作台 /web/#/item/project/product 或分享 /link/#/invite?sid=）并要求提取需求、整理页面结构、看原型时使用；支持按需浏览器登录、分享密码、整页布局图与 JSON。
---

# lanhu2md

蓝湖 Axure 原型 → `~/.lanhu2md/output/<文档名>/<页名>.md`：每节先放截图、再放该节需求文字；可选 JSON（含坐标/章节/原文）与整页布局图。

## 何时用

- 用户贴蓝湖链接，要「这个页面的需求」「原型转文档」「整理字段/交互」
- 需要把原型整理成给开发/AI 使用的规格（md 或 json）

## 命令

先确认命令是否可用：`command -v lanhu2md`（PowerShell 用 `Get-Command lanhu2md`）。

- 可用：下面的 `lanhu2md` 直接用
- 不可用（command not found）：把命令里的 `lanhu2md` 换成 `npx -y lanhu2md@latest`

在**任意目录**执行（不要 `cd` 到工具目录，否则产物会落在工具目录里）：

```bash
lanhu2md '<链接>'                    # 默认：链接那页，带图
lanhu2md '<链接>' --all              # 全部页面 + index.md
lanhu2md '<链接>' --list             # 只列页面
lanhu2md '<链接>' --page <页名>       # 指定页
lanhu2md '<链接>' --no-images        # 纯文字
lanhu2md '<链接>' --shots            # 额外整页布局图
lanhu2md '<链接>' --format both      # 额外输出 JSON
lanhu2md '<链接>' --share-password <pwd>   # 带密码的分享
lanhu2md '<链接>' --out ./lanhu2md-docs    # 产物改到项目内

lanhu2md login                       # 可选：提前登录并缓存
lanhu2md logout [--purge]            # 清除登录态
```

PowerShell 必须用单引号包住链接（URL 含 `&`、`#`，否则被当成后台任务/注释）。

## 行为约定

- 产物默认写 `~/.lanhu2md/output/<文档名>/`；想放进项目就加 `--out ./lanhu2md-docs`（实际为 `./lanhu2md-docs/<文档名>/`）。
- 缓存写 `~/.lanhu2md/.cache/`；登录态 `~/.lanhu2md/session.json`；可用 `LANHU2MD_HOME` 换整个根目录。
- 默认带图；`--no-images` 输出纯文字。
- 分享链接会自带「仅查看」匿名会话，默认**优先匿名读取**，不需要登录；接口 418 时才回退到已缓存登录态，仍失败再按需提示登录。
- 登录按需：匿名会话和登录态都无权时，交互终端会问「是否打开浏览器登录」，选 y 自动登录并重试；非交互只打印指引，不阻塞。
- 分享链接先匿名解析；要密码时提示输入（或 `--share-password` / `LANHU_SHARE_PASSWORD`）。
- 工作台链接（非分享）仍需要一个在项目范围内的蓝湖账号。

## 产物

```
~/.lanhu2md/output/<文档名>/
  index.md                 # --all
  <页名>.md                # 标题 → 截图 → 需求
  <页名>.json              # --format json/both：blocks/sections/markdown
  images/<页名>/uN.png     # 原型原始切片
  shots/<页名>.png         # --shots 整页布局图
```

## 依赖

- Node ≥ 18，运行时零依赖
- `login` 子命令需要可选依赖 `playwright-core`（用 npx 或全局命令时会自动带上）
- `--shots` 用本机已安装的 Edge/Chrome 无头模式，不下载 Chromium
