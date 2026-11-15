# 把 AIYview 发到 GitHub：完整操作手册

这份文档是给「已经改好代码、只差发布」的状态准备的。按顺序做，每一步都写了可以直接复制粘贴的命令。

---

## 0. 你已经准备好的东西（本地已生成，不用再动手）

| 文件 | 作用 |
| --- | --- |
| `README.md` | 仓库首页说明（功能、安装、开发、打包、隐私） |
| `LICENSE` | MIT 协议 |
| `.gitignore` | 已排除 `node_modules/`、`dist/`、`release/`、`tmp/`、`*.sqlite`、`*.asar`、`models/`、`*.onnx`、日志 |
| `.github/workflows/ci.yml` | 每次 push 跑 lint + 单测 + 迁移冒烟 + 打包（不出安装包） |
| `.github/workflows/release.yml` | 打 tag 时在 Windows runner 出 NSIS 安装包 + 绿色版 zip，并自动挂到 Release |
| `release/v3.0/win-unpacked/` | 本地可用的绿色版（`AIYview.exe`，约 395 MB） |
| `AIYview-0.1.0-portable-win-x64.zip` | 上面这个绿色版的压缩包，可直接作为 Release 附件上传 |
| `AIYview-Setup-0.1.0-x64.exe` | 安装版（NSIS 编译，116 MB），同样可直接上传 |
| `scripts/installer.nsi` | 安装包脚本（单用户安装、快捷方式、卸载项、卸载时询问是否删数据） |

代码里已清掉的敏感内容：个人绝对路径、内网地址、密钥类字面量、旧品牌名、仓库内的数据库备份与日志（全部已被 `.gitignore` 拦住）。每次发版前想再确认一次：

```powershell
npm run scan:secrets
```

---

## 1. 需要准备的账号与信息

1. **GitHub 账号**（免费即可，`public` 仓库的 Actions 分钟数不限）
2. **仓库名**，建议：`AIYview`（描述可用「本地 ComfyUI 图片浏览器 + 分级筛选器」）
3. **可见性**：`Public`（想让别人下载 Releases）或 `Private`（只自己用，Actions 照样能跑）
4. **本地 git 身份**（提交里会公开显示，别用真实邮箱如果想匿名）：

```powershell
git config --global user.name  "你的名字"
git config --global user.email "you@example.com"
```

> 仓库历史里所有 commit 的作者/邮箱都会公开。如果当前用的是真实邮箱又不想暴露，建议**这次直接新建一个干净仓库**再推（下面第 2 步的 A 方案就是这么做的，可以只推一个「发布版」提交）。

---

## 2. 建仓库并推送

工作目录：`D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app`

### 方案 A：网页上建 + 本地推（最稳）

1. 打开 https://github.com/new
   - Repository name：`AIYview`
   - 可见性按需选
   - **不要**勾选 “Add a README / .gitignore / license”（仓库里已经有了）
2. 本地执行：

```bash
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app

git remote add origin https://github.com/xianwan/AIYview.git
git branch -M master
git push -u origin master
```

首次 push 会要求登录：弹窗选浏览器授权，或用 Personal Access Token 当密码（
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → 勾 `Contents: Read and write`）。

### 方案 B：有 GitHub CLI 时一条命令

```bash
gh auth login
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app
gh repo create AIYview --public --source=. --remote=origin --push
```

### 想把历史压成一个提交（可选，避免旧作者信息）

```bash
git checkout --orphan release-only
git add -A
git commit -m "AIYview: 本地 ComfyUI 图片浏览器"
git branch -D master
git branch -m master
git push -u origin master --force
```

---

## 3. 出安装包：打 tag 让 Actions 干活

本机跑 `electron-builder` 会挂在 packaging 阶段（CPU 归零），所以**安装包一定交给 CI 出**。

```bash
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app
git tag v3.0
git push origin v3.0
```

推送 tag 后：

1. 打开仓库 → **Actions** → 名为 `release` 的工作流
2. 等它跑完（约 10–20 分钟，第一次要下 Electron 缓存）
3. 产物会出现在 **Releases** 页面：`AIYview-0.1.0-x64.exe`（安装版）、`AIYview-0.1.0-portable-win-x64.zip`（绿色版）

也可以手动触发：Actions → release → **Run workflow**（不带 tag 时只上传 artifact，不建 Release）。

---

## 4. 如果暂时不想让 CI 打包：手动发一版

本地已经有两种产物，直接拖进 Release 即可：

| 文件 | 说明 |
| --- | --- |
| `AIYview-Setup-0.1.0-x64.exe` | **安装版**（NSIS，116 MB）：单用户安装、不弹 UAC、可选目录、开始菜单 + 桌面快捷方式、写卸载项 |
| `AIYview-0.1.0-portable-win-x64.zip` | **绿色版**（163 MB）：解压双击 `AIYview.exe` |

安装包是 `scripts/installer.nsi` 编出来的，想重新生成（需要 `makensis.exe`，NSIS 3.x）：

```powershell
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app
& "<makensis 路径>\makensis.exe" /V2 /DAPP_VERSION=0.1.0 `
  "/DSRC=$((Resolve-Path 'release\v3.0\win-unpacked').Path)" `
  "/DOUT=$((Get-Location).Path)\AIYview-Setup-0.1.0-x64.exe" `
  "scripts\installer.nsi"
```

> `.nsi` 必须是 **UTF-8 with BOM**，否则 makensis 报 `Bad text encoding`。Git 里已是 BOM 版本，改动时注意别丢掉。

绿色版想重新压：

```powershell
Compress-Archive -Path "release\v3.0\win-unpacked\*" -DestinationPath "AIYview-0.1.0-portable-win-x64.zip" -CompressionLevel Optimal
```

网页操作：仓库 → Releases → Draft a new release → Tag `v3.0`、Title `AIYview v3.0` → 把这两个文件拖进 “Attach binaries”。

Release 说明可以直接写这几条：

```
AIYview v3.0（首个公开版）

- 瀑布流浏览（1–30 列，Ctrl+滚轮调节），缩略图本地缓存
- 记忆上次状态：列数 / 筛选 / 已加载深度 / 滚动位置
- 五档评级 + 0–4 年龄分级 + 废标 / 回收站（可撤销）
- 标签系统与本地 ONNX 自动打标（WD-SwinV2）
- A1111 parameters 与 ComfyUI KSampler 提示词提取
- 遮挡：遮罩 / 模糊 / 隐藏，阈值与强度可调
- 排序：时间 新→旧 / 旧→新，名称 A→Z / Z→A
- 快捷键全可自定义（打分 1–5、评级 0、Alt+1–5、标废 X、删除 Del）
- 侧边栏可拖宽 / 可收成图标条

绿色版：解压后双击 AIYview.exe；安装版：AIYview-0.1.0-x64.exe
数据目录：%APPDATA%\aiyview
```

---

## 5. 发布前必查清单（已逐条验证过，发版前可以再跑一遍）

```powershell
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app

npm run lint            # 必须 0 报错
npm test                # 必须 156/156
npm run scan:secrets    # 只应命中测试里的假路径 C:/Users/x

git status --short      # 只应看到你这次真正要提交的源码改动
git check-ignore -v tmp\index.sqlite.bak-*   # 应输出 .gitignore:/tmp/
```

- [ ] 仓库里没有 `index.sqlite` / `thumbnails` / `logs` / `app.asar.prev`
- [ ] 仓库里没有 `models/` 或 `*.onnx`（467MB 的模型不进仓库，放 Release 附件或让用户自己下）
- [ ] `package.json` 里 `name=aiyview`、`appId=com.aiyview.app`、`productName=AIYview`
- [ ] 没有把 `D:\Apps\99_Data\...` 这类个人路径写进源码或文档
- [ ] 决定仓库可见性（Public 后历史 commit 的作者名/邮箱都公开）

---

## 6. 常见问题

**Actions 里 `npm ci` 失败**
仓库根目录必须同时有 `package.json` 和 `package-lock.json`（都在），lock 里 `name` 已改成 `aiyview`，与 `package.json` 一致，能过。

**CI 打包报 native 模块 ABI 不匹配**
CI 用的是 `electron-builder`，它会自己 rebuild 原生模块；本地 `npm run repack` 那套 ABI 切换（`scripts/set-native-abi.mjs`）只影响本机。

**Release 附件超过 2GB**
绿色版 zip 约 180–200 MB，远低于 GitHub 单文件 2GB 上限；模型文件（467MB）如需提供，单独作为 Release 附件上传即可。

**想让别人看到图标/品牌**
放一张 `build/icon.png`（≥512×512，正方形）在仓库根目录，`electron-builder` 会自动转成 Windows 的 `.ico` 并嵌进 exe 与安装器。当前用的是 Electron 默认图标。

---

## 7. 后续日常发布流程（改完代码之后）

```bash
cd /d D:\Apps\99_Data\workbubby_Data\ComfyUI生图查看器\app

npm run build:renderer   # 改的是渲染层时
npm run repack           # 重打 app.asar（原地覆盖 release\v3.0\win-unpacked）
npm run prune            # 裁掉跨平台二进制与多余语言包

git add -A
git commit -m "fix: ..."
git push

git tag v3.1 && git push origin v3.1   # 触发新一版安装包
```
