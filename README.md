# dsh-wallpaper

为 DSH Desktop 设置自定义背景图（壁纸）。通过向桌面客户端注入一小段 CSS，把三栏面板改为半透明，让背景图从窗口透出。

## 安装

```bash
dsh plugin --profile desktop add C:\Users\diu\.dsh\plugins\dsh-wallpaper
```

安装后**完全退出并重新打开 DSH Desktop**（插件在启动时打包进客户端，必须重启）。若背景未出现，再按 `Ctrl+Shift+R` 强制刷新一次。

## 兼容性（harness ≥ 0.2）

新版桌面端改成了 React 三栏 `AppFrame`，面板类名是 CSS Modules 哈希（`BynINW_frame` / `BynINW_sidebarCol` / `BynINW_centerCol` / `BynINW_rightbarCol` / `BynINW_overlayLayer`），所以旧版钩子（`.dshDesktopFrame`、`.dshDesktopSidebarSurface`、`[data-dsh-desktop-mode]` …）在新界面上**一个都匹配不到**，遮罩规则全部失效——这就是壁纸“突然不显示”的原因。0.1.1 起改用三层钩子：

1. **结构钩子**：`:is(div:has(> [data-rightbar-col]), div:has(> [data-shell-overlay]))` 精确命中外层 frame（不依赖类名）；
2. **类名后缀钩子**：`[class*="_centerCol"]` / `[class*="_sidebarCol"]` / `[class*="_rightbarCol"]`（哈希变了也不会失效，这三个后缀经全量脚本扫描确认全局唯一）；
3. **旧版钩子**：`.dshDesktop*` 保留，向下兼容老版本。

> ⚠️ 不要用 `[class*="_frame"]`：另有 14 个模块自带 `*_frame` 类（聊天、附件、子智能体、提问卡片、侧栏浏览器、文档预览、web 前端…），用它会误伤这些组件的背景。0.1.2 已改为上面的结构锚点。

同时必须把 `body` / `#root` 强制透明（新版外壳给它们画了不透明底色，会盖住 `z-index:-1` 的 `<video>`），并把 overlay 层（`[data-shell-overlay]`）里的令牌重新调回近不透明，保证菜单/弹窗/设置页仍然清晰可读。

> 自 0.2 起 harness 带 `client-hmr`：**改完 `lib\client.js` 保存后，已打开的窗口会自动热替换（几秒内生效），一般不需要重启**；没生效再按 `Ctrl+Shift+R`。

## 换图（无需重启）

1. 编辑 `C:\Users\diu\.dsh\wallpaper\config.json`，把 `image` 改成你要的图片绝对路径（Windows 路径用双反斜杠 `\\`）；
2. 或在 `C:\Users\diu\.dsh\wallpaper\` 下放一张 `image.png`（会覆盖 config 之外再作为备选）。
3. 在窗口里 `Ctrl+Shift+R` 刷新即可。

默认使用：`C:\Users\diu\Pictures\111111\3ff502b2-0755-446e-8f47-aec55342648a.png`

## 跟随 Wallpaper Engine 同步（默认开启）

每次请求都会实时读取 WE 的 `config.json`（`C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\config.json`），自动跟随桌面当前壁纸：

- 壁纸是 **mp4/webm 视频** → **直接播放！** 客户端注入 `<video>` 元素（静音循环），背景和桌面一样是动态画面；服务端带 Range 支持（可拖拽/seek）。**这是推荐类型**——动态 + 原画清晰（实测 4K）
- 壁纸是**图片**（jpg/png/webp 等）→ 直接用它；
- 壁纸是其他视频（mov/avi/mkv）→ 用 `python scripts\frame.py`（cv2）抽一帧原画当静态图，缓存到 `<DSH_HOME>\wallpaper\cache\`；
- 壁纸是 **scene.pkg 场景** → **用 RePKG 解包**（`scripts\repkg\RePKG.exe`）提取高清背景素材图（实测 1929×1080 / 2602×2000 / 2196×2040），缓存到 `<DSH_HOME>\wallpaper\cache\scene_<md5>\`；选图规则：文件名含 `背景/bg/background/backdrop` 优先，否则取分辨率最大的 png；解包失败才回退 `preview.*` 封面（低清 gif 会糊）
  - **注意**：解包得到的是**静态素材**（场景里的动态特效/动画是 WE 实时渲染的，无法静态化；WE 渲染画面无窗口无 DC 可抓，实测抓不到）——scene 壁纸在 DSH 里是高清静态图；想要动态背景请用视频壁纸
- 壁纸是 **exe**（应用程序类）→ 用同目录 `preview.*` 封面图；
- 路径失效时自动在 `workshop\downloads\` 下按 item id 找回退；
- 全都失败 → 回退到下面的手动 `image` 模式。

服务端路由：
- `/dsh-wallpaper/wallpaper.type` → `{kind:"video"|"image", url}`，客户端据此决定建 `<video>` 还是用 CSS 背景
- `/dsh-wallpaper/wallpaper.mp4` → 视频文件（Range 支持）
- `/dsh-wallpaper/wallpaper.png` → 静态图（视频壁纸时返回抽帧帧兜底）

可用配置键（都写在 `C:\Users\diu\.dsh\wallpaper\config.json`，可选）：

```json
{
  "weSync": true,          // false 关闭 WE 同步，改用手动 image
  "weConfigPath": "...",   // 覆盖 WE config.json 路径（一般不用）
  "monitor": "Monitor0",   // 跟随 WE 的哪个显示器（缺省取第一个）
  "pythonCmd": "python",   // mov/avi/mkv 视频抽帧用的 python 解释器（需装有 opencv）
  "image": "C:\\...\\manual.png"  // WE 同步失败时的回退图
}
```

> 多显示器：`monitor` 指定跟随 WE 的哪块屏。**想让 DSH 背景是动态视频，就把该屏的壁纸换成 mp4 视频**；scene.pkg 场景壁纸现在会解包显示高清静态背景（比低清封面好得多），但场景的动态特效无法静态化。

## 调节清晰度（0.1.2：四档透明度）

现在**所有**面板都能透出壁纸，亮度由 4 个变量控制，都写在注入的 CSS 里（`lib\client.js` 的 `WALLPAPER_CSS`，改完保存即热替换）：

| 变量 | 默认 | 控制的区域 |
| --- | --- | --- |
| `--dsh-wallpaper-tint` | `23%` | **面板层**：整个窗口背景 + 左/中/右三栏（frame 和三栏各叠一层，所以面板实际不透明度 ≈ `1-(1-t)²`：`23%` → 约 `41%`） |
| `--dsh-wallpaper-surface-tint` | `55%` | **内容表面**：气泡、输入框、代码块（含标题条）、工具卡片、设置卡片、菜单、Toast、提示条、diff 行与行号、滚动条滑块等 46 个令牌（含「已编辑 N 个文件」卡片与文件列表，见下） |
| `--dsh-wallpaper-overlay-tint` | `88%` | **弹层**：菜单/对话框/设置页（它们是 frame 的子层，所以单独调回近不透明） |
| `--dsh-wallpaper-solid-tint` | `100%` | **强调色/按钮填充**（主按钮、状态标签、开关等 11 个令牌）；默认 100% = 不变，调小可做成“毛玻璃按钮” |

- 调小 = 背景更清晰、文字可读性下降；调大 = 更接近纯色。
- **必须写百分号**：数值是被塞进 `color-mix()` 的百分比，写成 `55` 会让整条声明失效（表面变全透明）。
- 实现方式：在 `<body>` 上把所有会画成实底的主题令牌**快照**一份（`--dsh-wp-*`），再在 frame 内用 `color-mix(in srgb, <快照> <tint>, transparent)` 替换。着色令牌的**不用 `!important`**（自定义属性继承，组件自己声明的同名令牌仍然优先），所以不会有 `!important` 打架的问题。
- 明确**不改**的令牌：文字色、边框色、遮罩、骨架屏、hover 洗色（本来就是半透明或文字色），以及主题里根本没定义的 7 个（`bg-layer-4`、`bg-l1/l2`、`fill-l1/l2/tertiary`、`fill-tsp-secondary`，它们的用处本来就是透明，硬套会反而变暗）。

### 0.1.3：「已编辑 17 个文件」/ 改动文件面板

这一块原来**绕过了令牌替换**：面板自己声明了局部变量，例如

```css
.kuvljq_card   { --changes-fill: var(--dsw-static-neutral-850); }   /* 暗色 #212123，实底 */
.kuvljq_header { background: var(--changes-fill); height: 60px; }   /* “已编辑 N 个文件” 横条 */
.flL80G_root   { --deliverable-fill: var(--dsw-static-neutral-850); }
.flL80G_file   { background: var(--deliverable-fill); height: 60px; } /* 文件列表每行 60px */
```

局部声明**永远优先于继承值**，所以改 `--dsw-alias-*` 够不到它。办法是把**上游的调色板令牌**（`--dsw-static-neutral-50 / -100 / -800 / -850`）本身放进 frame 作用域替换——局部变量在组件上求值，取到的就是替换后的半透明值：

```css
:is(div:has(> [data-rightbar-col]), …) { --dsw-static-neutral-850: color-mix(in srgb, #212123 55%, transparent); }
```

同时新纳入 surface 档的还有：`--dsw-alias-bg-multi-select`（多选行底色）、`--dsw-alias-file-diff-added-gutter` / `-deleted-gutter`（diff 行号列底色）、4 个滚动条滑块令牌（`--dsw-alias-scrollbar-bg-l1/l2`、`-hover-l1/l2`）。**`--dsw-static-neutral-00` 故意不动**：它同时是图标/文字颜色，而它仅有的两处背景用法写的就是 `color-mix(… 50%, transparent)`，本来就透。

实测（离线复刻，预置暗色主题 + 真实主题令牌 + 真实 layout CSS + mock 三栏 DOM）：

| 表面 | 修复前 | 修复后 |
| --- | --- | --- |
| `.kuvljq_header`「已编辑 N 个文件」 | `#212123` 实底 | `rgba(33,33,35,.55)` |
| `.flL80G_file` 文件行 | `#212123` 实底 | `rgba(33,33,35,.55)` |
| `._0SbxAa_add` / `_del` diff 行 | 实底 | `.55` |
| `._0SbxAa_add ._0SbxAa_number` 行号列 | 实底 | `.55` |
| `.kuvljq_tile` 预览小图 | 白 5% | 白 5%（原本就透） |

想要更透就把 `--dsh-wallpaper-surface-tint` 调小（这一块全归它管）。


> 亮壁纸的注意：**面板层（聊天正文、侧栏项之间那片空白）只叠到约 41%**，如果壁纸偏亮，直接画在面板上的白字对比度会不足（实测纯白壁纸时约 2.6:1）。把 `--dsh-wallpaper-tint` 提到 `42%`（叠加约 66%，实测 5.9:1）即可恢复可读性——**这一层只能靠 `--dsh-wallpaper-tint` 修，surface/overlay 两档帮不上忙**（它们只影响卡片、输入框、菜单等“浮起来的表面”）。视频壁纸遇到亮场景同理。
>
> 实测（纯白壁纸 + 本机 1440×900 预览，白字对比度）：面板 41% → 2.6:1；卡片/输入框/代码块（叠加 surface 55%）→ 73~93% → 5.9~10.9:1；菜单/弹窗（叠加 overlay 88%）→ 83~90% → 10.7~14:1。所以暗色壁纸用默认值就很清楚，亮壁纸只需动第一个变量。

## 可选：毛玻璃效果

把 `lib\client.js` 里 `_centerCol` 那段 `backdrop-filter: blur(8px)` 的注释去掉，中央面板背后会产生毛玻璃模糊。
