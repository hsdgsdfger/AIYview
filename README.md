# AIYview

本地 ComfyUI / A1111 出图的浏览器与分级筛选器。纯本地运行：索引库、缩略图、标签全在你自己的机器上，不联网、不上传。

## 功能

- **瀑布流浏览**：1–30 列自由调节（Ctrl+滚轮），缩略图后台生成并缓存
- **记忆上次状态**：列数、筛选、已加载深度、滚动位置，下次打开原地续上
- **分级 / 打分 / 标废**：五档评级、0–4 年龄分级、废标与回收站（可撤销）
- **标签系统**：手动打标 + 本地 WD-SwinV2 模型自动打标（ONNX 本地推理）
- **提示词提取**：自动读 A1111 `parameters` 段落，ComfyUI 图顺 KSampler 引用取文本节点
- **遮挡**：按分级阈值遮罩 / 模糊 / 隐藏，方式与强度可调
- **排序**：修改时间 新→旧 / 旧→新，文件名 A→Z / Z→A
- **快捷键**：打分、评级、标废、删除全部可自定义（默认 `1-5`、`0`、`Alt+1-5`、`X`、`Del`）
- **侧边栏**：可拖宽 150–460px，可一键收成图标条

## 安装（普通用户）

1. 从 [Releases](../../releases) 下载 `AIYview-0.1.0-portable-win-x64.zip`（绿色版）或 `AIYview-*-setup.exe`（安装版）
2. 绿色版解压后双击 `AIYview.exe`
3. 首次启动点「添加文件夹」选择你的出图目录（例如 ComfyUI 的 `output`），等待扫描完成

数据目录：`%APPDATA%\aiyview`（索引库 `index.sqlite` 与缩略图缓存都在这里，删掉等于重置）

## 自动打标（可选）

把 WD-SwinV2 tagger 模型放到下列任一位置，界面上点「打标」即可：

```
<项目根>/models/illuTag/wd-swinv2-tagger-v3/
  model.onnx
  selected_tags.csv
```

也可以在设置里填 `tagger.modelDir` 指定任意目录。

## 开发

```bash
npm install
npm run dev        # Vite + Electron 热更新
npm test           # 156 个单测
npm run lint
npm run build:renderer   # 只构建渲染层到 dist/
```

## 打包

本仓库的打包流程分两步，产物原地更新到 `release/v3.0/win-unpacked`：

```bash
npm run build:renderer   # 渲染层
npm run repack           # 解出 app.asar → 覆盖 dist/src/package.json → 重打 → 同步 unpacked
npm run prune            # 裁剪：onnxruntime 只留 win32/x64、语言包只留中英、删 sqlite 编译中间件
```

完整安装包（NSIS / zip）由 GitHub Actions 在 tag 推送时构建，见 `.github/workflows/release.yml`。

想在本机出一个安装包（脚本在 `scripts/installer.nsi`，需要先有 `makensis.exe`）：

```powershell
& "<makensis 路径>\makensis.exe" /V2 /DAPP_VERSION=0.1.0 `
  "/DSRC=$((Resolve-Path 'release\v3.0\win-unpacked').Path)" `
  "/DOUT=$((Get-Location).Path)\AIYview-Setup-0.1.0-x64.exe" `
  "scripts\installer.nsi"
```

安装包行为：单用户安装（不弹 UAC，默认装到 `%LOCALAPPDATA%\Programs\AIYview`）、可选安装目录、开始菜单 + 桌面快捷方式、写 `HKCU` 卸载项；卸载时单独询问是否一并删除 `%APPDATA%\aiyview` 里的图库数据（默认保留，静默卸载绝不删）。

## 结构

```
src/main/        Electron 主进程（窗口、IPC、服务：扫描/缩略图/打标/删除/设置）
src/core/        与 Electron 无关的纯逻辑（DB 仓储、元数据解析、打标后处理）
src/renderer/    React 界面（store + 瀑布流 + 查看器 + 侧边栏 + 面板）
tests/unit/      node:test 单测（含 400 行/文件、core 不依赖 electron 等约定测试）
scripts/         开发与打包脚本
```

## 隐私

- 不联网：全局网络策略只放行 `file://` / 本地 `media://` 与开发服务器
- 不上传：没有账号、没有遥测、没有崩溃上报
- 日志只写本地 `%APPDATA%\aiyview\logs\app.log`

## License

MIT，见 [LICENSE](LICENSE)。
