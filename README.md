# dsh-wallpaper-diudiu

给 **DSH Desktop** 加一张自定义背景壁纸：往桌面客户端注入一小段 CSS，把三栏面板改成半透明，让壁纸从窗口透出来；壁纸默认**自动跟随 Wallpaper Engine**（动态视频墙纸直接播、场景壁纸解包取高清静帧）。

> ⚠️ **这不是 npm 上的 `dsh-wallpaper`。** 那个包（作者 `codeMonkey-Pine` / `mokeycoding`，Apache-2.0，TypeScript 实现）与本项目是两个独立项目，只是主题相同。本项目的包名是 `dsh-wallpaper-diudiu`，仓库是 <https://github.com/diudiu666/dsh-wallpaper>。

## 特性

- **自动找 Wallpaper Engine**：不再假定 `C:\Program Files (x86)\Steam\...`——依次查注册表、Steam 的 `libraryfolders.vdf`（多盘/多库）、常见安装位置、macOS/Linux 布局（见[它怎么找 WE](#它怎么找-wallpaper-engine)）。
- **跟随桌面壁纸**：视频墙纸（mp4/webm）直接内联播放并支持 seek；场景墙纸（`scene.pkg`）解包取 1929×1080 级别的高清静帧；图片墙纸原样使用；其它类型取 `preview.*` 封面。
- **四档透明度**：面板 / 表面 / 弹层 / 强调色分档（`--dsh-wallpaper-tint` 等），亮壁纸也能保证正文可读。
- **失败可诊断**：`GET /dsh-wallpaper/status` 说明「找到了什么、试过什么、哪一步失败」，不用猜。
- **零运行时依赖**：不引入任何 npm 包；可选能力（抽帧、解包）缺失时自动降级。

## 安装

装到 **desktop** profile（客户端半边是给桌面三栏用的）。安装后**完全退出 DSH Desktop 再打开**；背景没出现时按一次 `Ctrl+Shift+R`。

> ⚠️ **如果首次启动就失败**（对话框报 `web boot: 1 entry did not activate`），**先不要点**「禁用第三方插件、备份 profile patch 并重启」：那个按钮会把插件从 `dsh.profile.bundles` 里删掉、并重写 `cordis.patch.yml`，而且**不会真的留下备份文件**（文案与实际行为不符）。先对照下面的[排查表](#安装后没有背景)。

```bash
# 1) 直接从 GitHub 安装
dsh plugin --profile desktop add https://github.com/diudiu666/dsh-wallpaper

# 2) 或先打包再装（离线机器、内网分发）
git clone https://github.com/diudiu666/dsh-wallpaper && cd dsh-wallpaper
npm pack                                  # -> dsh-wallpaper-diudiu-0.2.1.tgz
dsh plugin --profile desktop add ./dsh-wallpaper-diudiu-0.2.1.tgz
```

`dsh` 是 DSH Desktop 自带的 CLI：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <spec>
```

卸载：`dsh plugin --profile desktop remove dsh-wallpaper-diudiu`（会同时清掉 profile 里的依赖与 bundle 选择）。

## 安装后没有背景？

先看诊断接口，90% 的问题一眼就能定位：

```bash
curl http://127.0.0.1:<DSH 端口>/dsh-wallpaper/status
```

它返回 `we.found` / `we.source` / `we.configPath`（找到没有、从哪儿找到的）、`selected`（最终选中的文件）、`trace`（每一步的成功/失败原因）、`tools`（`python`+opencv、RePKG 是否可用）。

| 症状 | 常见原因 | 处理 |
| --- | --- | --- |
| 启动失败，对话框报 `web boot: 1 entry did not activate` / `dsh-wallpaper-diudiu: import failed` | 0.2.0 的 `lib/client.js` 用 cordis 行 id（`dsh-wallpaper`）注册，而 harness 以**包名**（`dsh-wallpaper-diudiu`）作为客户端模块行的键，行永远等不到工厂，loader 重放 bundle 后撞上 `duplicate factory registration for "dsh-wallpaper"` | 升级到 ≥ 0.2.1；这一行已按包名注册，并有回归测试钉住 |
| 点过崩溃对话框的「禁用第三方插件、备份 profile patch 并重启」之后插件彻底不生效 | 该按钮把 `dsh-wallpaper-diudiu` 从 `dsh.profile.bundles` 移除，并重写 `cordis.patch.yml`（实测不会生成备份文件，自定义条目会丢） | 把 `"dsh-wallpaper-diudiu"` 加回 `dsh.profile.bundles`，或重跑 `dsh plugin --profile desktop add …` |
| 界面变半透明深色，没有壁纸 | 没找到 WE，也没配 `image` | 看 `status.we.found`；配 `config.json` 的 `image` 或放 `image.png` |
| `we.found=true` 但没有背景 | WE 当前壁纸是 `exe` 类型（无静态素材） | 换视频/图片/场景壁纸，或手动 `image` |
| 场景墙纸显示低清封面 | RePKG 解包失败（非 Windows / 文件损坏） | 看 `status.tools.scene`；换视频壁纸 |
| 视频壁纸不播，只有静帧 | `videoLive:false`，或编码不被 Chromium 支持 | 改回 `videoLive:true`，或用 H.264 的 mp4 |
| 文字看不清 | 壁纸偏亮 | 调大 `--dsh-wallpaper-tint`（见下） |
| `config-we-path: MISS` | 你写的 `weConfigPath` 不存在 | 删掉该键走自动探测，或改成正确路径 |

## 配置

全部可选，写在 `<DSH_HOME>/wallpaper/config.json`（Windows 一般是 `C:\Users\<你>\.dsh\wallpaper\config.json`）：

```json
{
  "weSync": true,
  "weConfigPath": "D:\\SteamLibrary\\steamapps\\common\\wallpaper_engine\\config.json",
  "monitor": "Monitor0",
  "videoLive": true,
  "pythonCmd": "python",
  "repkgPath": "C:\\tools\\RePKG.exe",
  "image": "D:\\pics\\my-wallpaper.jpg"
}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `weSync` | `true` | 关闭后完全不碰 WE，只用 `image` / `image.png` |
| `weConfigPath` | 自动探测 | 显式指定 WE 的 `config.json`（或 WE 安装目录）；写错时仍会回退自动探测，并在 `/status` 记一条 `config-we-path: MISS` |
| `monitor` | 第一个显示器 | 多屏时跟随哪一块 WE 屏幕，如 `Monitor1` |
| `videoLive` | `true` | `false` 时视频壁纸改为抽一帧当静态图（省 GPU，防闪退） |
| `pythonCmd` | `python` | mov/avi/mkv 抽帧用的解释器，需要 `opencv-python` |
| `repkgPath` | 内置 | 覆盖 `scripts/repkg/RePKG.exe` |
| `image` | 无 | 静态兜底图绝对路径（Windows 用双反斜杠） |

也可以直接把图放到 `<DSH_HOME>/wallpaper/image.png`，优先级低于 `image`、高于"什么都没有"。

### 透明度

在注入的 CSS 里（`lib/client.js` 的 `WALLPAPER_CSS`，改完保存大部分情况会热替换）：

| 变量 | 默认 | 控制 |
| --- | --- | --- |
| `--dsh-wallpaper-tint` | `23%` | 面板层（窗口背景 + 三栏）；**亮壁纸只靠它调**，提到 `42%` 左右正文就能读 |
| `--dsh-wallpaper-surface-tint` | `55%` | 内容表面：气泡、输入框、代码块、卡片、菜单、toast、diff 行等 |
| `--dsh-wallpaper-overlay-tint` | `88%` | 弹层：菜单/对话框/设置页 |
| `--dsh-wallpaper-solid-tint` | `100%` | 强调色/主按钮填充（`100%` = 不变） |

数值是塞进 `color-mix()` 的百分比，**必须带 `%`**。

## 它怎么找 Wallpaper Engine

`lib/locate.js` 按可信度逐个尝试，第一个命中的生效（`/status` 会告诉你命中的是哪一个）：

1. `config.json` 里的 `weConfigPath`；
2. 环境变量 `DSH_WALLPAPER_WE_CONFIG`；
3. Windows 注册表：`HKCU\Software\Valve\Steam` → `SteamPath`，`HKLM\SOFTWARE\WOW6432Node\Valve\Steam` → `InstallPath`；
4. 每个 Steam 根下的 `steamapps\libraryfolders.vdf` → **所有** Steam 库（Steam 在 D 盘、WE 装在第二个库都能找到）；
5. 常见默认位置：`%ProgramFiles(x86)%\Steam`、`%ProgramFiles%\Steam`、各盘 `\Steam`、`\SteamLibrary`、`\Games\Steam` …；
6. macOS：`~/Library/Application Support/Steam/...`；Linux：`~/.steam/steam/...`、`~/.local/share/Steam/...`。

找到 `config.json` 之后的传输链：`weSync` → `image` → `image.png` → **什么都没有**（`kind:"none"`，图片路由 404 并指向 `/status`）。不会再有"回退到作者机器上的某个路径"这种行为。

## HTTP 路由

| 路由 | 说明 |
| --- | --- |
| `GET /dsh-wallpaper/wallpaper.type` | `{ kind: "video" \| "image" \| "none", url }`，客户端据此决定建 `<video>` 还是用 CSS 背景 |
| `GET /dsh-wallpaper/wallpaper.mp4` | 视频文件，支持 `Range`（206/416）与 `HEAD` |
| `GET /dsh-wallpaper/wallpaper.png` | 静态图（视频壁纸时返回抽帧结果） |
| `GET /dsh-wallpaper/status` | 诊断 JSON（提 issue 请贴这个） |

## 兼容性

- **DSH**：`engines.dsh >= 0.1.5-rc.1`（客户端钩子适配 harness ≥ 0.2 的 React 三栏 `AppFrame`；`body` / `#root` 强制透明以露出 `z-index:-1` 的 `<video>`）。
- **平台**：Windows 功能完整。macOS/Linux 能跑（CSS 与视频链路与平台无关），但 `scene.pkg` 解包依赖 Windows 版 RePKG，会降级为封面图；`/status` 里 `tools.scene` 会标 `unsupported-platform`。
- **可选依赖**：`python` + `opencv-python`（mov/avi/mkv 抽帧）。缺了只是少一条路径，不会报错。

## 开发

```bash
npm test            # node --test：定位器 / 解析链 / HTTP 路由 / 客户端 bundle 契约，27 个用例
npm run pack:check  # 校验 npm pack 产物包含全部运行时文件
```

单文件自检（不启动 DSH）：

```bash
DSH_WALLPAPER_SELFTEST=1 node lib/index.js           # 解析结果 + 每步 trace
DSH_WALLPAPER_SELFTEST_STATUS=1 node lib/index.js    # 完整 status 文档
DSH_WALLPAPER_SELFTEST_SCENE=<a.pkg> node lib/index.js
DSH_WALLPAPER_SELFTEST_VIDEO=<a.mkv> node lib/index.js
```

目录结构：

```
lib/index.js    插件入口：注册 4 个路由
lib/client.js   客户端注入（CSS + <video>），非 ESM、由 harness 的模块加载器加载
lib/locate.js   WE/Steam 定位（纯函数 + 依赖注入，可单测）
lib/resolve.js  解析链
lib/scene.js    scene.pkg 解包
lib/frame.js    视频抽帧
lib/serve.js    文件/视频（Range）响应
lib/status.js   /status 诊断文档
lib/config.js   配置读取与规范化
```

贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[BSD-3-Clause](LICENSE)。内置的 `scripts/repkg/RePKG.exe` 及其第三方组件（CommandLineParser、K4os.Compression.LZ4、Newtonsoft.Json、ImageSharp、DXT 解压代码）各自遵循 MIT，全文见 `scripts/repkg/THIRD-PARTY-NOTICES.txt`。

---

## English

Custom wallpaper for the **DSH Desktop** shell: injects CSS that makes the three
columns translucent so a wallpaper shows through, and by default follows
**Wallpaper Engine** (live video wallpapers play inline, scene `.pkg` wallpapers
are unpacked to a high-resolution still, images are served as-is).

Not to be confused with the npm package `dsh-wallpaper` by `codeMonkey-Pine` —
this project is `dsh-wallpaper-diudiu` and lives at
<https://github.com/diudiu666/dsh-wallpaper>.

```bash
dsh plugin --profile desktop add https://github.com/diudiu666/dsh-wallpaper
```

Restart DSH Desktop completely afterwards. If nothing shows up, read
`GET /dsh-wallpaper/status`: it reports the discovered Wallpaper Engine path,
every path that was tried, the resolution trace, and which optional tool
(`python` + opencv, RePKG) is missing.

Wallpaper Engine is located through the Windows registry (`SteamPath` /
`InstallPath`), every Steam library listed in `steamapps/libraryfolders.vdf`,
well-known install locations, and the macOS/Linux Steam layouts — never through
a hard-coded `C:\Program Files (x86)\...`.

License: BSD-3-Clause (bundled RePKG binary: MIT third-party components, see
`scripts/repkg/THIRD-PARTY-NOTICES.txt`).
