(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const setupEl = $('setup');
  const playerEl = $('player');
  const fileIn = $('file');
  const pickBtn = $('pick');
  const v = $('v');
  const cR = $('cR');
  const tapzone = $('tapzone');
  const hud = $('hud');
  const hudPanel = hud.querySelector('.hud__panel');
  const playpauseBtn = $('playpause');
  const seek = $('seek');
  const timeEl = $('time');
  const wIn = $('w');
  const gIn = $('g');
  const wOut = $('wOut');
  const gOut = $('gOut');
  const readout = $('readout');
  const restartBtn = $('restart');
  const changeBtn = $('change');

  const GAP_SLIDER_MAX = 30;
  const STORE_KEY = 'pingxingyan.settings';

  // ---------------------------------------------------------------- 机型表

  // [短边 CSS px, 长边 CSS px, devicePixelRatio, 屏幕长边物理毫米]
  const DEVICES = [
    [393, 852, 3, 147.6], // 15 / 15 Pro / 14 Pro
    [402, 874, 3, 151.9], // 16 Pro
    [390, 844, 3, 146.7], // 14 / 13 / 13 Pro / 12 Pro
    [375, 812, 3, 146.7], // 13 mini / 12 mini / X / XS
    [430, 932, 3, 159.9], // 15 Pro Max / 14 Pro Max
    [428, 926, 3, 160.8], // 13 Pro Max / 12 Pro Max
    [440, 956, 3, 163.0], // 16 Pro Max
    [414, 896, 2, 150.9], // 11 / XR
    [375, 667, 2, 138.4], // SE 2/3 / 8
  ];

  function screenLongMm() {
    const a = window.screen.width;
    const b = window.screen.height;
    const short = Math.min(a, b);
    const long = Math.max(a, b);
    const dpr = window.devicePixelRatio || 1;

    for (const [s, l, d, mm] of DEVICES) {
      if (Math.abs(s - short) <= 2 && Math.abs(l - long) <= 2 && Math.abs(d - dpr) < 0.1) {
        return mm;
      }
    }
    return dpr >= 3 ? 147.6 : 150.9;
  }

  // ---------------------------------------------------------------- 设置

  const state = { w: 40, gap: 3 };

  function loadSettings() {
    let raw;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (typeof s.w === 'number') state.w = s.w;
      if (typeof s.gap === 'number') state.gap = s.gap;
    } catch {
      /* 设置损坏就沿用默认值 */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* 无痕模式下写不进去，忽略 */
    }
  }

  // 左画面最左边缘 = 50% - w - gap/2，要留在屏幕内，所以 w + gap/2 <= 50
  const maxGapFor = (w) => Math.max(0, 2 * (50 - w));

  function applySettings() {
    const root = document.documentElement.style;
    root.setProperty('--w', state.w + '%');
    root.setProperty('--gap', state.gap + '%');

    wIn.value = String(state.w);
    wOut.textContent = state.w + '%';

    gIn.max = String(Math.min(GAP_SLIDER_MAX, maxGapFor(state.w)));
    gIn.value = String(state.gap);
    gOut.textContent = state.gap + '%';

    updateReadout();
    sizeCanvas(); // 画面宽度变了，右画面的画布尺寸要跟着走，否则会被拉伸
  }

  function updateReadout() {
    // 中心距 = 两份画面中心的距离 = w + gap
    const centerPct = state.w + state.gap;
    const mm = (centerPct / 100) * screenLongMm();

    if (mm >= 55 && mm <= 72) {
      readout.classList.add('is-ok');
      readout.textContent = '双眼中心距≈' + mm.toFixed(0) + 'mm，接近瞳距，可以试融合';
      return;
    }

    readout.classList.remove('is-ok');
    const hint = mm > 72 ? '偏大，视线要更发散，会更费力' : '偏小，会变成交叉眼';
    readout.textContent = '双眼中心距≈' + mm.toFixed(0) + 'mm（' + hint + '）';
  }

  // ---------------------------------------------------------------- 加载视频

  let url = null;

  function releaseUrl() {
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };

  const ctxR = cR.getContext('2d');
  let drawnAt = -1;

  function sizeCanvas() {
    const r = cR.parentElement.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;

    // 上限 2 倍：右画面只占屏宽四成、又是缩小绘制，3 倍纯属浪费填充率
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cR.width === w && cR.height === h) return;

    cR.width = w;
    cR.height = h;
    drawnAt = -1; // 改尺寸会清空画布，作废「已画过」的记录，否则暂停时会留下一块空白
    drawRight();
  }

  // 按 object-fit: contain 的规则把当前帧等比放进右画面——
  // 必须是 contain，才能和左边 video 自己的 letterbox 几何完全重合
  function drawRight() {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh || cR.width < 2) return;

    // 暂停且这一帧已经画过就不再重复画，省得暂停时也一直占着 GPU
    if (v.paused && drawnAt === v.currentTime) return;

    const s = Math.min(cR.width / vw, cR.height / vh);
    const dw = vw * s;
    const dh = vh * s;
    ctxR.drawImage(v, (cR.width - dw) / 2, (cR.height - dh) / 2, dw, dh);
    drawnAt = v.currentTime;
  }

  // 每帧把左画面正在显示的那一帧抄到右画面。左右共用同一个解码时钟、同一帧图像，
  // 结构上不可能漂移，所以整个 App 里没有任何对时 / 纠偏逻辑。
  //
  // 用 rAF 而不是 requestVideoFrameCallback：rAF 无论有没有片源都一定会触发，
  // 而 rVFC 在片源就绪前注册就永远不会回调，整套画面会静静地不再更新。
  function pump() {
    drawRight();
    requestAnimationFrame(pump);
  }
  requestAnimationFrame(pump);

  function loadFile(file) {
    releaseUrl();
    url = URL.createObjectURL(file);

    v.addEventListener('loadedmetadata', sizeCanvas, { once: true });
    v.addEventListener(
      'canplay',
      () => {
        v.currentTime = 0;
        v.play().catch(() => {});
      },
      { once: true }
    );

    v.src = url;
    v.load();

    seek.value = '0';
    timeEl.textContent = '0:00';

    setupEl.hidden = true;
    playerEl.hidden = false;

    sizeCanvas();
    showHud(false);
    requestWakeLock();
  }

  // ---------------------------------------------------------------- 播放状态

  v.addEventListener('play', () => {
    playerEl.classList.add('is-playing');
    showHud();
  });

  v.addEventListener('pause', () => {
    playerEl.classList.remove('is-playing');
    showHud();
  });

  let dragging = false;

  // 只负责进度条和时间的刷新；画面同步由 frame() 负责
  function tick() {
    if (!playerEl.hidden && !dragging && v.duration && isFinite(v.duration)) {
      seek.value = String(Math.round((v.currentTime / v.duration) * 1000));
      timeEl.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(v.duration);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- 控制浮层

  let hudTimer = 0;

  function hideHud() {
    clearTimeout(hudTimer);
    hud.classList.add('is-dim');
  }

  // 首次加载时不自动隐藏：面板一旦自己消失，屏幕上就没有任何线索告诉用户点一下能叫回来
  function showHud(autoHide = true) {
    hud.hidden = false;
    hud.classList.remove('is-dim');
    clearTimeout(hudTimer);
    if (autoHide) hudTimer = setTimeout(hideHud, 3000);
  }

  function toggleHud() {
    if (hud.classList.contains('is-dim')) showHud();
    else hideHud();
  }

  tapzone.addEventListener('click', toggleHud);

  // 面板上的任何操作都重置自动隐藏计时，但拖滑杆时不要触发画面点击
  hudPanel.addEventListener('pointerdown', () => showHud());
  hudPanel.addEventListener('click', (e) => e.stopPropagation());

  // ---------------------------------------------------------------- 控件

  playpauseBtn.addEventListener('click', () => {
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    showHud();
  });

  seek.addEventListener('input', () => {
    dragging = true;
    showHud();
    const d = v.duration;
    if (!d || !isFinite(d)) return;
    v.currentTime = (Number(seek.value) / 1000) * d;
  });

  const endDrag = () => {
    dragging = false;
  };
  seek.addEventListener('change', endDrag);
  seek.addEventListener('pointerup', endDrag);
  seek.addEventListener('pointercancel', endDrag);

  wIn.addEventListener('input', () => {
    state.w = Number(wIn.value);

    // 画面变宽会挤压可用的黑边空间，超出就往下压
    const afford = Math.min(GAP_SLIDER_MAX, maxGapFor(state.w));
    if (state.gap > afford) state.gap = afford;

    applySettings();
    saveSettings();
    showHud();
  });

  gIn.addEventListener('input', () => {
    state.gap = Number(gIn.value);
    applySettings();
    saveSettings();
    showHud();
  });

  restartBtn.addEventListener('click', () => {
    v.currentTime = 0;
    v.play().catch(() => {});
    showHud();
  });

  function pickFile() {
    fileIn.value = '';
    fileIn.click();
  }

  pickBtn.addEventListener('click', () => {
    requestWakeLock();
    pickFile();
  });

  changeBtn.addEventListener('click', () => {
    showHud();
    pickFile();
  });

  fileIn.addEventListener('change', () => {
    const file = fileIn.files && fileIn.files[0];
    if (file) loadFile(file);
  });

  // ---------------------------------------------------------------- 屏幕常亮

  let wakeLock = null;

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      /* iOS 16.4–18.3 的独立 PWA 上会失败，只能靠用户关掉自动锁定 */
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !playerEl.hidden) requestWakeLock();
  });

  // ---------------------------------------------------------------- 启动

  const onViewportChange = () => {
    updateReadout();
    sizeCanvas();
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(onViewportChange, 300));

  loadSettings();
  state.gap = Math.min(state.gap, Math.min(GAP_SLIDER_MAX, maxGapFor(state.w)));
  applySettings();

  // 走 http 局域网时不满足 secure context，注册会失败，静默跳过即可
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
