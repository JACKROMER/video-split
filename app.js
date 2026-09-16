(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const setupEl = $('setup');
  const playerEl = $('player');
  const fileIn = $('file');
  const pickBtn = $('pick');
  const vL = $('vL');
  const vR = $('vR');
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

  let urlL = null;
  let urlR = null;

  function releaseUrls() {
    if (urlL) URL.revokeObjectURL(urlL);
    if (urlR) URL.revokeObjectURL(urlR);
    urlL = urlR = null;
  }

  const fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };

  function loadFile(file) {
    releaseUrls();

    // 两个 video 各自拿一个 blob URL：共用同一个 URL 时 iOS 上两个元素会争抢加载状态
    urlL = URL.createObjectURL(file);
    urlR = URL.createObjectURL(file);

    let pending = 2;
    const bothReady = () => {
      pending -= 1;
      if (pending > 0) return;
      vL.currentTime = 0;
      vR.currentTime = 0;
      // 两路必须同时起播。串成 vL.play().then(() => vR.play()) 会让右路天然晚几十到几百毫秒，
      // 这个偏差会一直挂着，看起来就是「右边的画面慢半拍」
      vL.play().catch(() => {});
      vR.play().catch(() => {});
    };

    vL.addEventListener('canplay', bothReady, { once: true });
    vR.addEventListener('canplay', bothReady, { once: true });

    vL.src = urlL;
    vR.src = urlR;
    vL.load();
    vR.load();

    seek.value = '0';
    timeEl.textContent = '0:00';

    setupEl.hidden = true;
    playerEl.hidden = false;

    showHud(false);
    requestWakeLock();
  }

  // ---------------------------------------------------------------- 同步

  vL.addEventListener('play', () => {
    playerEl.classList.add('is-playing');
    vR.play().catch(() => {});
    showHud();
  });

  vL.addEventListener('pause', () => {
    playerEl.classList.remove('is-playing');
    vR.pause();
    showHud();
  });

  vL.addEventListener('seeked', () => {
    vR.currentTime = vL.currentTime;
    setRightRate(1);
    lastSyncAt = performance.now();
    syncHold = performance.now() + 400;
  });

  let lastSyncAt = 0;
  let dragging = false;

  const DRIFT_LIMIT = 0.05; // 同一份画面，融合观看时 50ms 以上的错位就开始看得出来
  const SEEK_LIMIT = 0.3;   // 差到这个程度微调追不回来，只能硬对齐
  const NUDGE = 0.05;       // 微调幅度；右路全程静音，变速没有听感代价

  let vRRate = 1;

  function setRightRate(rate) {
    if (vRRate === rate) return;
    vRRate = rate;
    vR.playbackRate = rate;
  }

  let syncHold = 0;

  // 用倍速追帧，而不是每次都 seek：seek 会清空解码缓冲，在 iOS 上就是一次可见的卡顿。
  // 原先是靠频繁 seek 纠偏，结果每次纠偏都让右路卡一下，反而更像「右边在延迟」
  function syncRight() {
    const drift = vL.currentTime - vR.currentTime; // 正数 = 右路落后

    if (Math.abs(drift) > SEEK_LIMIT) {
      vR.currentTime = vL.currentTime;
      setRightRate(1);
      syncHold = performance.now() + 400; // 给右路一点重新缓冲的时间，否则会连着 seek
      return;
    }

    if (drift > DRIFT_LIMIT) setRightRate(1 + NUDGE);       // 落后就加速追
    else if (drift < -DRIFT_LIMIT) setRightRate(1 - NUDGE); // 超前就减速等
    else setRightRate(1);
  }

  function tick() {
    if (!playerEl.hidden) {
      if (!dragging && vL.duration && isFinite(vL.duration)) {
        seek.value = String(Math.round((vL.currentTime / vL.duration) * 1000));
        timeEl.textContent = fmtTime(vL.currentTime) + ' / ' + fmtTime(vL.duration);
      }

      if (!vL.paused && performance.now() > syncHold && performance.now() - lastSyncAt > 250) {
        syncRight();
        lastSyncAt = performance.now();
      }
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
    if (vL.paused) {
      vL.play().catch(() => {});
    } else {
      vL.pause();
    }
    showHud();
  });

  seek.addEventListener('input', () => {
    dragging = true;
    showHud();
    const d = vL.duration;
    if (!d || !isFinite(d)) return;
    const t = (Number(seek.value) / 1000) * d;
    vL.currentTime = t;
    vR.currentTime = t;
  });

  const endDrag = () => {
    dragging = false;
    lastSyncAt = performance.now();
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
    vL.currentTime = 0;
    vR.currentTime = 0;
    vL.play().catch(() => {});
    vR.play().catch(() => {});
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

  window.addEventListener('resize', updateReadout);
  window.addEventListener('orientationchange', () => setTimeout(updateReadout, 300));

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
