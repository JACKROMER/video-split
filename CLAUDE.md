# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「平行眼」——把同一个画面左右各放一份，用户放松眼睛让视线发散，两份融合成一幅。纯静态 PWA，无构建步骤、无依赖、无 package.json、无测试。所有逻辑在 `app.js`，样式在 `styles.css`，结构在 `index.html`。

视频来自用户手机的**本地文件**（`<input type="file">` + `URL.createObjectURL`），不上传、不持久化。网页外壳托管在 GitHub Pages，只负责提供播放器本身。

## 命令

```bash
node server.js              # 本地开发服务器，http://localhost:5173（同时监听局域网）
node tools/make-icons.js    # 重新生成 icon-180/192/512.png
```

部署就是 `git push origin main`，GitHub Pages 直接服务 `main` 分支根目录，无 CI。

## 布局数学：改之前先读这段

播放器的全部布局由两个 CSS 变量驱动，定义在 `:root`：

- `--w` —— 每份画面的宽度（占屏宽百分比）
- `--gap` —— 中间黑边的宽度

`styles.css` 里的定位公式：

```css
.pane--left  { left: calc(50% - var(--w) - var(--gap) / 2); }
.pane--right { left: calc(50% + var(--gap) / 2); }
```

由此推出一条**不变量：两份画面中心的距离恒等于 `w + gap`，黑边宽度恒等于 `gap`**。改动这几个 calc 时务必保持它，否则整个 App 的物理前提就崩了。

**为什么要盯着中心距：** 平行眼融合要求两份画面「对应点」的间距 ≈ 瞳距（成人平均 63mm）。手机横屏长边约 148mm，所以目标中心距约 43% 屏宽。**加黑边会增大中心距、让融合更难——黑边是调完的结果，不是手段**，这点和直觉相反。

**由此产生的硬物理上限（不是 bug，不要试图用代码绕开）：** 为了让中心距落在 63mm，每份画面宽度不能超过约 43% 屏宽，16:9 视频因此最多占屏幕高度的一半左右。竖屏更不行——两份中心距只有约 34mm，远小于瞳距。

`app.js` 中的相关约束：

- `maxGapFor(w) = max(0, 2 * (50 - w))` —— 保证左画面最左边缘不出屏（要求 `w + gap/2 <= 50`）。画面变宽时会自动把 `gap` 往下压。
- `DEVICES` 表按 `screen.width × screen.height + devicePixelRatio` 匹配机型，查出屏幕长边物理毫米数，用于把百分比换算成 mm 读数。匹配不到就按 DPR 猜。**mm 读数只是便利，不是机制**——真正让用户找到融合点的是手动微调，设置存在 localStorage。

## 单解码器 + canvas 镜像（不要再回到两个 video）

**只有一个 `<video>`（`#v`），在左画面里，有声。右画面是一块 `<canvas id="cR">`。**
`pump()` 这个 rAF 循环每帧把左画面正在显示的那一帧 `drawImage` 到右画面。

**这不是为了省事，是为了消除一整类 bug。** 两份画面显示的是同一个解码时钟的同一帧图像，
**结构上不可能漂移**，所以整个 App 里没有任何对时 / 纠偏代码。

历史教训——不要重走：

1. 最早是两个 `<video>` 各自解码，靠事件 + 定期 seek 纠偏。seek 会清空解码缓冲，
   每次「修正」都让右路卡一下，反而更像「右边在延迟」。
2. 改成用 `playbackRate` 在 0.95/1/1.05 三挡微调追帧后，用户报告**两边的播放速度对不上**——
   iOS 不保证兑现 `playbackRate` 写入，纠偏本身变成了新的偏差来源。
3. 结论：两个独立解码器必然会漂，而纠偏手段（seek / 变速）各自都有 iOS 上的坑。
   与其修不完地补纠偏逻辑，不如让「漂移」这件事在架构上无法发生。

**`pump()` 必须用 rAF，不能用 `requestVideoFrameCallback`。** rVFC 在片源就绪前注册就
永远不回调，整套画面会静静地停止更新；rAF 无论有没有片源都一定会触发。
暂停时用 `drawnAt === v.currentTime` 去重，避免静止画面也一直占着 GPU。

**`drawRight()` 的 letterbox 几何必须和左边 video 的 `object-fit: contain` 完全一致**，
否则两份画面在融合时对不上。左边由浏览器算，右边由 `sizeCanvas()` / `drawRight()`
按 `Math.min(w/vw, h/vh)` 手算，两边都是居中 contain。

`sizeCanvas()` 在三个时机调用：`loadFile()` 解除隐藏之后、`applySettings()` 里
（`--w` 变化会改 pane 宽度）、以及 resize / orientationchange。
改画布尺寸会清空内容，所以内部要 `drawnAt = -1` 再补画一次。

`loadFile()` 只调一次 `createObjectURL`——现在只有一个 video 元素，不再需要两个 URL 绕开
iOS 的加载状态争抢。

## iOS / PWA 容易踩的坑

- **`playsinline` 是必须的**。缺了它 iOS 会强制全屏播放单个 video，整个 App 直接失效。
- **HTTPS 是硬前提**。iOS 上 http 页面即使加到主屏也会退化成带地址栏的普通 Safari 标签页，且 Service Worker 注册不了。`server.js` 只用于 Windows 本地调试，装到手机必须走 GitHub Pages。仓库**必须保持 public**——私有仓库的 Pages 要付费。
- **`#hud` 的可见性只由 `.is-dim`（opacity）控制，绝对不要再给它加 `hidden` 属性**。曾经同时用了两个机制，而 `showHud()` 只清 `is-dim` 不清 `hidden`，导致控制面板永久 `display:none`，用户完全找不到调节入口。
- **`.hud.is-dim .hud__panel { pointer-events: none }` 不能删**。`.hud` 常驻 `pointer-events: none`、面板常驻 `auto`；淡出后若不单独放开面板的命中，那层看不见的面板会一直吃掉屏幕底部的点击，用户再也点不出控制面板。
- `showHud(autoHide = true)` 的第一个参数是布尔值。**当事件处理器用时必须包一层** `() => showHud()`，直接传 `showHud` 会把事件对象当参数传进去（truthy），行为就错了。
- 首次加载用 `showHud(false)` 不自动隐藏。面板一旦自己消失，屏幕上没有任何线索提示用户点一下能叫回来，这个设计本身就不成立。
- 屏幕常亮用 `navigator.wakeLock`，已知 iOS 16.4–18.3 的独立 PWA 上失效，失败时静默降级。

## 设计系统

`DESIGN.md` 是所有 UI 取值的唯一来源（Apple 风格：单一蓝色强调 `#0066cc`、SF Pro、胶囊按钮、按下 `transform: scale(0.95)`、正文 17px）。**不要自创颜色、间距或圆角**，从 DESIGN.md 的 token 里取。

两个页面按 `DESIGN.md` 的面模式区分：选择页走亮面（`canvas-parchment` / `ink`），播放页走 `surface-black` 纯黑，控制浮层用 `sub-nav-frosted` 的磨砂配方。

控制浮层刻意压成 3 行——横屏屏高只有约 393px，行数一多就会盖住视频，而用户调间距时恰恰需要盯着画面。

## 图标

`icon-180/192/512.png` 由 `tools/make-icons.js` 生成（用 `zlib` 手写 PNG chunk，零依赖）。**改图标要改脚本再重跑，不要手工编辑 PNG**。

## 已知限制

浏览器不记得本地文件，用户每次打开 App 都要重新选一次视频。这是网页版的固有限制。滑杆设置会记住（localStorage），所以间距只需调一次。

真机行为无法在 Windows 上验证——本地 Chrome 只能验证逻辑和布局，iOS 上的解码性能、同步表现、Wake Lock 都必须由用户在真机上确认。
