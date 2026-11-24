/* AvPlay+ · player.js
 * 独立 Web/PWA 播放器：网关转发 / HLS 多清晰度 / 断点续播 / 自动重试 /
 * 画中画 / 全屏 / 悬浮小窗（拖动+缩放）/ 触屏手势。
 * 仅依赖运行时全局：window.AV、window.AV_SETTINGS、window.AV_DATA、window.Hls。
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 状态 */
  var S = {
    root: null, video: null, stage: null, gesture: null,
    el: {},                    // 控件引用
    opts: {},                  // mount/play 传入的参数（title/code/onTime ...）
    source: '',                // 原始地址
    actual: '',                // 当前实际载入的地址（直连或网关 play_url）
    resumeKey: '',             // 'resume:' + key
    hls: null,
    renditions: [],
    retries: 0,
    gwTried: false,
    switching: false,          // 换源瞬间屏蔽 error 事件
    destroyed: false,
    mini: false,
    lastSave: 0,
    listeners: [],
    timers: [],
    hideTimer: null,
    loadTimer: null,
    retryTimer: null
  };

  /* -------------------------------------------------------------- 小工具 */
  function A() { return window.AV || {}; }
  function t(msg) { try { A().toast(msg); } catch (e) {} }
  function cfg() { return window.AV_SETTINGS || {}; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function on(target, ev, fn, opt) {
    if (!target) return;
    target.addEventListener(ev, fn, opt);
    S.listeners.push([target, ev, fn, opt]);
  }
  function later(fn, ms) {
    var id = setTimeout(function () { fn(); }, ms);
    S.timers.push(id);
    return id;
  }
  function clearTimers() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    clearTimeout(S.hideTimer); clearTimeout(S.loadTimer); clearTimeout(S.retryTimer);
    S.hideTimer = S.loadTimer = S.retryTimer = null;
  }
  function gatewayBase() {
    var d = window.AV_DATA && window.AV_DATA.apis;
    var g = (d && d.gateway) || cfg().gateway || '';
    return String(g || '').trim().replace(/\/+$/, '');
  }
  function isM3u8(url) { return /\.m3u8(?:[?#]|$)/i.test(String(url || '')) || /mpegurl/i.test(String(url || '')); }

  /* 网关返回的 play_url 通常是 http://127.0.0.1:<port>/gw/...
   * iOS PWA 访问的是局域网地址，127.0.0.1 会指向手机自身，故换成网关来源。 */
  function rewritePlayUrl(url, gw) {
    try {
      if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(url)) {
        var g = new URL(gw), u = new URL(url);
        u.protocol = g.protocol; u.host = g.host;
        return u.href;
      }
    } catch (e) {}
    return url;
  }

  /* ------------------------------------------------------- 内联兜底样式 */
  function injectStyle() {
    if (document.getElementById('pl-fallback-style')) return;
    var css = [
      '.pl-root{position:relative;width:100%;aspect-ratio:16/9;min-height:220px;background:#000;color:#fff;overflow:hidden;border-radius:10px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}',
      '.pl-root *{box-sizing:border-box}',
      '.pl-stage{position:absolute;inset:0;overflow:hidden}',
      '.pl-video{width:100%;height:100%;object-fit:contain;display:block;background:#000}',
      '.pl-gesture{position:absolute;inset:0;z-index:2;touch-action:none}',
      '.pl-center{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;pointer-events:none}',
      '.pl-bigplay{pointer-events:auto;width:64px;height:64px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:26px;line-height:64px;cursor:pointer;backdrop-filter:blur(4px)}',
      '.pl-loading{position:absolute;z-index:4;top:50%;left:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border:3px solid rgba(255,255,255,.25);border-top-color:#ffd54a;border-radius:50%;animation:pl-spin .8s linear infinite;pointer-events:none}',
      '@keyframes pl-spin{to{transform:rotate(360deg)}}',
      '.pl-msg{position:absolute;z-index:6;top:12px;left:50%;transform:translateX(-50%);max-width:90%;padding:6px 12px;background:rgba(0,0,0,.72);border-radius:16px;font-size:12px;text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pl-error{position:absolute;z-index:7;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,.82);padding:20px;text-align:center}',
      '.pl-error p{max-width:460px;line-height:1.6;font-size:14px;margin:0}',
      '.pl-error .pl-ebtn{padding:8px 18px;border:0;border-radius:6px;background:#ffd54a;color:#111;font-size:13px;cursor:pointer}',
      '.pl-bar{position:absolute;z-index:5;left:0;right:0;bottom:0;padding:26px 10px 8px;background:linear-gradient(transparent,rgba(0,0,0,.85));transition:opacity .2s}',
      '.pl-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.pl-row+.pl-row{margin-top:6px}',
      '.pl-time{font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;color:#ddd}',
      '.pl-seek{position:relative;flex:1;height:16px;display:flex;align-items:center;cursor:pointer;touch-action:none}',
      '.pl-seektrack{position:relative;width:100%;height:4px;background:rgba(255,255,255,.25);border-radius:2px;overflow:visible}',
      '.pl-buf{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.4)}',
      '.pl-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:#ffd54a}',
      '.pl-dot{position:absolute;top:50%;left:0;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#ffd54a;box-shadow:0 0 0 2px rgba(0,0,0,.4)}',
      '.pl-btn{flex:0 0 auto;min-width:30px;height:28px;padding:0 6px;border:0;border-radius:5px;background:rgba(255,255,255,.12);color:#fff;font-size:13px;cursor:pointer}',
      '.pl-btn:active{background:rgba(255,255,255,.28)}',
      '.pl-vol{width:66px;flex:0 0 auto;accent-color:#ffd54a}',
      'select.pl-sel{flex:0 0 auto;max-width:78px;height:28px;border:0;border-radius:5px;background:rgba(255,255,255,.14);color:#fff;font-size:12px;padding:0 2px}',
      'select.pl-sel option{background:#1b1b1b;color:#fff}',
      '.pl-titlebar{display:none;align-items:center;gap:8px;height:32px;padding:0 10px;background:#181818;cursor:move;touch-action:none;font-size:12px}',
      '.pl-titlebar .pl-ttl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pl-resize{display:none;position:absolute;z-index:8;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,#ffd54a 50%,#ffd54a 70%,transparent 70%,transparent 85%,#ffd54a 85%)}',
      '.pl-hidden{display:none!important}',
      '.pl-hide-ui .pl-bar,.pl-hide-ui .pl-titlebar{opacity:0;pointer-events:none}',
      '.pl-root.pl-mini{position:fixed;right:16px;bottom:16px;width:380px;height:auto;aspect-ratio:16/9;z-index:9999;box-shadow:0 12px 44px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.16)}',
      '.pl-mini .pl-titlebar{display:flex}',
      '.pl-mini .pl-resize{display:block}',
      '.pl-root.pl-fs{position:fixed!important;inset:0;width:100%!important;height:100%!important;aspect-ratio:auto!important;z-index:10000;border-radius:0}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'pl-fallback-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------- mount */
  function mount(container, opts) {
    if (S.destroyed) S.destroyed = false;
    if (S.root) destroy();
    injectStyle();
    opts = opts || {};
    S.opts = Object.assign({}, opts);
    S.listeners = []; S.timers = [];

    var root = A().el ? A().el('div', 'pl-root') : document.createElement('div');
    root.setAttribute('data-player', 'avplay');
    var stage = document.createElement('div'); stage.className = 'pl-stage';
    var video = document.createElement('video');
    video.className = 'pl-video';
    video.controls = false;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x5-playsinline', '');
    video.preload = 'metadata';
    // 不设 crossOrigin：很多直连流没有 CORS 头，设了会直接加载失败。
    if (opts.poster) video.poster = opts.poster;
    stage.appendChild(video);

    var gesture = document.createElement('div'); gesture.className = 'pl-gesture';
    var center = document.createElement('div'); center.className = 'pl-center';
    var big = document.createElement('button');
    big.className = 'pl-bigplay'; big.type = 'button'; big.textContent = '▶';
    big.title = '播放 / 暂停';
    center.appendChild(big);
    var spinner = document.createElement('div'); spinner.className = 'pl-loading pl-hidden';
    var msg = document.createElement('div'); msg.className = 'pl-msg pl-hidden';
    var err = document.createElement('div'); err.className = 'pl-error pl-hidden';
    var errP = document.createElement('p');
    var errBtn = document.createElement('button'); errBtn.className = 'pl-ebtn'; errBtn.type = 'button'; errBtn.textContent = '重试';
    var errClose = document.createElement('button'); errClose.className = 'pl-ebtn'; errClose.type = 'button'; errClose.textContent = '关闭';
    err.appendChild(errP); err.appendChild(errBtn); err.appendChild(errClose);
    var resize = document.createElement('div'); resize.className = 'pl-resize'; resize.title = '拖动缩放小窗';
    stage.appendChild(gesture); stage.appendChild(center); stage.appendChild(spinner);
    stage.appendChild(msg); stage.appendChild(err); stage.appendChild(resize);

    var bar = document.createElement('div'); bar.className = 'pl-bar';
    var row1 = document.createElement('div'); row1.className = 'pl-row';
    var cur = document.createElement('span'); cur.className = 'pl-time'; cur.textContent = '00:00';
    var seek = document.createElement('div'); seek.className = 'pl-seek';
    var track = document.createElement('div'); track.className = 'pl-seektrack';
    var buf = document.createElement('div'); buf.className = 'pl-buf';
    var fill = document.createElement('div'); fill.className = 'pl-fill';
    var dot = document.createElement('div'); dot.className = 'pl-dot';
    track.appendChild(buf); track.appendChild(fill); track.appendChild(dot); seek.appendChild(track);
    var dur = document.createElement('span'); dur.className = 'pl-time'; dur.textContent = '00:00';
    row1.appendChild(cur); row1.appendChild(seek); row1.appendChild(dur);

    var row2 = document.createElement('div'); row2.className = 'pl-row';
    function button(label, title, cls) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pl-btn' + (cls ? ' ' + cls : '');
      b.textContent = label; b.title = title;
      return b;
    }
    var bPlay = button('▶', '播放 / 暂停');
    var bVol = button('🔊', '静音 / 取消静音');
    var vol = document.createElement('input');
    vol.type = 'range'; vol.className = 'pl-vol'; vol.min = '0'; vol.max = '1'; vol.step = '0.05'; vol.value = '1';
    vol.title = '音量';
    var speed = document.createElement('select'); speed.className = 'pl-sel'; speed.title = '倍速';
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].forEach(function (v) {
      var o = document.createElement('option'); o.value = String(v); o.textContent = v + '×'; speed.appendChild(o);
    });
    speed.value = '1';
    var quality = document.createElement('select'); quality.className = 'pl-sel'; quality.title = '清晰度';
    quality.appendChild(new Option('自动', '-1'));
    var bPip = button('⤢', '画中画');
    var bFull = button('⛶', '全屏');
    var bMini = button('▣', '悬浮小窗');
    var bRetry = button('↻', '重新加载');
    row2.appendChild(bPlay); row2.appendChild(bVol); row2.appendChild(vol);
    row2.appendChild(speed); row2.appendChild(quality); row2.appendChild(bPip);
    row2.appendChild(bFull); row2.appendChild(bMini); row2.appendChild(bRetry);
    bar.appendChild(row1); bar.appendChild(row2);

    var titlebar = document.createElement('div'); titlebar.className = 'pl-titlebar';
    var ttl = document.createElement('span'); ttl.className = 'pl-ttl';
    ttl.textContent = opts.title || opts.code || '正在播放';
    var bMiniClose = button('✕', '关闭小窗');
    titlebar.appendChild(ttl); titlebar.appendChild(bMiniClose);

    root.appendChild(stage); root.appendChild(bar); root.appendChild(titlebar);
    (container || document.body).appendChild(root);

    S.root = root; S.stage = stage; S.video = video; S.gesture = gesture; S.destroyed = false;
    S.el = {
      big: big, spinner: spinner, msg: msg, err: err, errP: errP, errBtn: errBtn, errClose: errClose,
      bar: bar, cur: cur, dur: dur, seek: seek, buf: buf, fill: fill, dot: dot,
      bPlay: bPlay, bVol: bVol, vol: vol, speed: speed, quality: quality,
      bPip: bPip, bFull: bFull, bMini: bMini, bRetry: bRetry,
      resize: resize, titlebar: titlebar, ttl: ttl, bMiniClose: bMiniClose
    };

    bindUI();
    bindVideo();
    bindGestures();
    makeDraggable(titlebar, 'move');
    makeDraggable(resize, 'resize');
    setControlsOptions();
    if (opts.title) ttl.textContent = opts.title;
    return root;
  }

  /* --------------------------------------------------------- UI 事件绑定 */
  function setControlsOptions() {
    var s = S.el;
    if (s.speed) s.speed.value = '1';
    if (s.quality) s.quality.innerHTML = '';
    if (s.quality) s.quality.appendChild(new Option('自动', '-1'));
  }
  function bindUI() {
    var e = S.el;
    on(e.big, 'click', function (ev) { ev.stopPropagation(); togglePlay(); });
    on(e.bPlay, 'click', togglePlay);
    on(e.bVol, 'click', function () {
      S.video.muted = !S.video.muted;
      e.bVol.textContent = S.video.muted || S.video.volume === 0 ? '🔇' : '🔊';
    });
    on(e.vol, 'input', function () {
      var v = clamp(Number(e.vol.value) || 0, 0, 1);
      S.video.volume = v; S.video.muted = v === 0;
      e.bVol.textContent = v === 0 ? '🔇' : '🔊';
    });
    on(e.speed, 'change', function () { setSpeed(e.speed.value); });
    on(e.quality, 'change', function () { setQuality(e.quality.value); });
    on(e.bPip, 'click', togglePip);
    on(e.bFull, 'click', toggleFullscreen);
    on(e.bMini, 'click', toggleMini);
    on(e.bRetry, 'click', retry);
    on(e.errBtn, 'click', retry);
    on(e.errClose, 'click', function () { e.err.classList.add('pl-hidden'); });
    on(e.bMiniClose, 'click', toggleMini);
    // 进度条点击 / 拖动
    var scrubbing = false;
    function seekFromEvent(ev) {
      if (!isFinite(S.video.duration) || !S.video.duration) return;
      var r = e.seek.getBoundingClientRect();
      var p = clamp((ev.clientX - r.left) / (r.width || 1), 0, 1);
      S.video.currentTime = Math.min(p * S.video.duration, Math.max(0, S.video.duration - 0.15));
      updateProgress();
    }
    on(e.seek, 'pointerdown', function (ev) {
      scrubbing = true;
      try { e.seek.setPointerCapture(ev.pointerId); } catch (err) {}
      seekFromEvent(ev);
    });
    on(e.seek, 'pointermove', function (ev) { if (scrubbing) seekFromEvent(ev); });
    on(e.seek, 'pointerup', function () { scrubbing = false; });
    on(e.seek, 'pointercancel', function () { scrubbing = false; });
  }
  function bindVideo() {
    var v = S.video;
    on(v, 'loadedmetadata', function () {
      S.switching = false;
      clearTimeout(S.loadTimer);
      S.el.spinner.classList.add('pl-hidden');
      if (isFinite(v.duration)) S.el.dur.textContent = fmt(v.duration);
      // 断点续播：存的是秒数，兼容别人写的 {t/pos} 对象
      var saved = 0;
      try { saved = A().store.get(S.resumeKey, 0); } catch (err) {}
      if (saved && typeof saved === 'object') saved = Number(saved.t || saved.pos || 0);
      saved = Number(saved) || 0;
      if (saved > 5 && isFinite(v.duration)) {
        try { v.currentTime = Math.min(saved, Math.max(0, v.duration - 0.15)); } catch (err) {}
        showMessage('已从 ' + fmt(saved) + ' 继续播放');
      }
      if (cfg().autoplay) tryPlay(v, true);
    });
    on(v, 'canplay', function () { S.el.spinner.classList.add('pl-hidden'); });
    on(v, 'playing', function () {
      S.switching = false;
      clearTimeout(S.loadTimer);
      S.el.spinner.classList.add('pl-hidden');
      S.el.err.classList.add('pl-hidden');
      S.el.big.textContent = '❚❚';
      S.el.bPlay.textContent = '❚❚';
      scheduleHide();
    });
    on(v, 'pause', function () {
      if (S.destroyed) return;
      S.el.big.textContent = '▶'; S.el.bPlay.textContent = '▶';
      S.root.classList.remove('pl-hide-ui');
      clearTimeout(S.hideTimer);
    });
    on(v, 'timeupdate', function () {
      updateProgress();
      var now = Date.now();
      if (v.currentTime > 3 && now - S.lastSave >= 5000) {
        S.lastSave = now;
        try { A().store.set(S.resumeKey, Math.floor(v.currentTime)); } catch (err) {}
      }
      if (S.opts && typeof S.opts.onTime === 'function') {
        try { S.opts.onTime(v.currentTime, v.duration, v); } catch (err) {}
      }
    });
    on(v, 'progress', updateBuffered);
    on(v, 'volumechange', function () {
      S.el.vol.value = String(v.muted ? 0 : v.volume);
      S.el.bVol.textContent = (v.muted || v.volume === 0) ? '🔇' : '🔊';
    });
    on(v, 'ended', function () {
      S.el.big.textContent = '▶'; S.el.bPlay.textContent = '▶';
      try { A().store.del(S.resumeKey); } catch (err) {}
      showMessage('播放结束');
    });
    on(v, 'error', function () {
      if (S.switching || S.destroyed) return;
      handlePlayError('视频加载失败或格式不受支持');
    });
    on(v, 'waiting', function () { S.el.spinner.classList.remove('pl-hidden'); });
    on(v, 'ratechange', function () {
      if (S.el && S.el.speed) S.el.speed.value = String(v.playbackRate);
    });
  }
  function updateProgress() {
    var v = S.video, e = S.el;
    if (!v || !e) return;
    e.cur.textContent = fmt(v.currentTime);
    if (isFinite(v.duration)) e.dur.textContent = fmt(v.duration);
    var p = (isFinite(v.duration) && v.duration) ? clamp(v.currentTime / v.duration * 100, 0, 100) : 0;
    e.fill.style.width = p + '%'; e.dot.style.left = p + '%';
  }
  function updateBuffered() {
    var v = S.video, e = S.el;
    if (!v || !e || !v.buffered || !v.buffered.length || !v.duration) return;
    var end = 0;
    for (var i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 1) end = Math.max(end, v.buffered.end(i));
    }
    e.buf.style.width = clamp(end / v.duration * 100, 0, 100) + '%';
  }
  function tryPlay(v, muted) {
    if (!v) return;
    if (muted) { try { v.muted = true; } catch (e) {} }
    var p;
    try { p = v.play(); } catch (e) { p = null; }
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        // iOS 自动播放被拦：先静音再试，仍失败就显示大播放按钮，不假装成功
        if (muted) { S.el.spinner.classList.add('pl-hidden'); showMessage('点击中间按钮开始播放'); }
        else tryPlay(v, true);
      });
    }
  }
  function scheduleHide() {
    clearTimeout(S.hideTimer);
    if (!S.root) return;
    S.root.classList.remove('pl-hide-ui');
    if (S.video && !S.video.paused) {
      S.hideTimer = setTimeout(function () {
        if (S.root && S.video && !S.video.paused) S.root.classList.add('pl-hide-ui');
      }, 3500);
    }
  }
  function toggleControls() {
    if (!S.root) return;
    S.root.classList.toggle('pl-hide-ui');
    if (!S.root.classList.contains('pl-hide-ui')) scheduleHide();
    else clearTimeout(S.hideTimer);
  }

  /* ------------------------------------------------------------ HLS / 源 */
  function destroyHls() {
    if (S.hls) { try { S.hls.destroy(); } catch (e) {} S.hls = null; }
  }
  function fillQualityFromRenditions() {
    var sel = S.el.quality;
    if (!sel) return;
    var levels = (S.hls && S.hls.levels) || [];
    var cur = sel.value;
    sel.innerHTML = '';
    sel.appendChild(new Option('自动', '-1'));
    if (levels.length) {
      levels.forEach(function (l, i) {
        sel.appendChild(new Option((l.height ? l.height + 'p' : '档位 ' + (i + 1)), String(i)));
      });
    } else if (S.renditions.length) {
      S.renditions.forEach(function (r) {
        sel.appendChild(new Option((r.height ? r.height + 'p' : '变体 ' + r.level), String(r.level)));
      });
    }
    sel.value = cur || '-1';
  }
  function attachSource(url) {
    destroyHls();
    clearTimeout(S.loadTimer);
    S.switching = true;
    S.actual = url;
    S.el.err.classList.add('pl-hidden');
    S.el.spinner.classList.remove('pl-hidden');
    try { S.video.removeAttribute('src'); S.video.load(); } catch (e) {}
    try { S.video.poster = S.opts.poster || ''; } catch (e) {}
    later(function () { S.switching = false; }, 1200);

    var Hls = window.Hls;
    if (isM3u8(url) && Hls && typeof Hls.isSupported === 'function' && Hls.isSupported()) {
      try {
        // iOS/MSE 经验：关 worker、关低延迟，缓冲保守一些
        S.hls = new Hls({
          debug: false, enableWorker: false, lowLatencyMode: false,
          backBufferLength: 60, maxBufferLength: 30
        });
        S.hls.loadSource(url);
        S.hls.attachMedia(S.video);
        S.hls.on(Hls.Events.MANIFEST_PARSED, function () {
          S.el.spinner.classList.add('pl-hidden');
          fillQualityFromRenditions();
          showMessage('HLS 已就绪 · ' + ((S.hls && S.hls.levels) || []).length + ' 档清晰度');
          tryPlay(S.video, !!cfg().autoplay);
        });
        S.hls.on(Hls.Events.ERROR, function (ev, d) {
          if (!d) return;
          if (!d.fatal) {
            if (Hls.ErrorTypes && d.type === Hls.ErrorTypes.NETWORK_ERROR && S.hls) {
              try { S.hls.startLoad(); } catch (e2) {}
            }
            return;
          }
          if (Hls.ErrorTypes && d.type === Hls.ErrorTypes.MEDIA_ERROR && S.hls) {
            try { S.hls.recoverMediaError(); return; } catch (e2) {}
          }
          handlePlayError('HLS ' + (d.details || '发生致命错误'));
        });
      } catch (e) {
        handlePlayError('HLS 初始化失败：' + (e && e.message ? e.message : '未知错误'));
      }
    } else {
      // 原生播放（iOS Safari 自带 HLS 支持，或普通 MP4/WebM）
      S.video.src = url;
      S.video.load();
      if (cfg().autoplay) {
        var once = function () { tryPlay(S.video, true); };
        on(S.video, 'loadedmetadata', once, { once: true });
      }
    }
    S.loadTimer = setTimeout(function () {
      if (!S.destroyed && S.video && S.video.readyState < 2) showMessage('加载较慢，仍在等待响应…');
    }, 12000);
    S.timers.push(S.loadTimer);
  }

  /* --------------------------------------------------------- 重试 / 网关 */
  function handlePlayError(detail) {
    if (S.destroyed) return;
    S.el.spinner.classList.add('pl-hidden');
    if (S.retries < 2) {
      var n = ++S.retries;
      var delay = 500 * Math.pow(2, n - 1); // 500ms / 1000ms 指数退避
      showMessage('播放出错（' + detail + '），' + (delay / 1000) + ' 秒后重试 ' + n + '/2…');
      clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(function () { if (!S.destroyed) attachSource(S.source); }, delay);
      return;
    }
    var gw = gatewayBase();
    if (gw && !S.gwTried) {
      S.gwTried = true;
      showMessage('直连失败，正在尝试网关转发…');
      gatewayPlay(S.source, gw);
      return;
    }
    showError('播放失败：' + detail + '。已重试 2 次' + (gw ? '并经网关转发仍失败' : '') +
      '。请点「重试」，或换一个线路 / 网络再试。');
  }
  function gatewayPlay(src, gw) {
    var url = gw + '/api/play?url=' + encodeURIComponent(src) +
      (S.opts.title ? '&title=' + encodeURIComponent(S.opts.title) : '');
    var fetchFn = window.fetch;
    if (typeof fetchFn !== 'function') { showError('当前浏览器不支持 fetch，无法使用网关'); return; }
    fetchFn(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (S.destroyed) return;
        if (!res.ok) throw new Error((res.j && res.j.error) || ('HTTP ' + res.ok));
        var j = res.j || {};
        if (!j.play_url) throw new Error('网关没有返回播放地址');
        S.renditions = Array.isArray(j.renditions) ? j.renditions : [];
        fillQualityFromRenditions();
        showMessage(j.kind === 'hls' ? '网关已解析 HLS 流' : '网关已解析视频文件');
        attachSource(rewritePlayUrl(j.play_url, gw));
      })
      .catch(function (e) {
        if (S.destroyed) return;
        showError('网关也失败了：' + (e && e.message ? e.message : '无法连接') +
          '。请确认网关服务已启动、地址填写正确。');
      });
  }

  /* --------------------------------------------------------------- play */
  function play(src, opts) {
    opts = opts || {};
    if (!S.root) mount(document.body, opts);
    S.opts = Object.assign({}, S.opts, opts);
    S.source = String(src || opts.src || '').trim();
    if (!S.source) { showError('没有可播放的地址'); return; }
    S.retries = 0; S.gwTried = false; S.renditions = [];
    S.lastSave = 0;
    clearTimeout(S.retryTimer);
    var key = S.opts.resumeKey ||
      (S.opts.code ? (function () { try { return A().normalizeCode(S.opts.code); } catch (e) { return S.opts.code; } })() : S.source);
    S.resumeKey = 'resume:' + key;
    setControlsOptions();
    if (S.opts.title && S.el.ttl) S.el.ttl.textContent = S.opts.title;
    var direct = S.source;
    try { if (A().proxyUrl) direct = A().proxyUrl(direct); } catch (e) {}
    showMessage('正在连接视频源…');
    attachSource(direct);
  }

  /* ------------------------------------------------------------ 控制 API */
  function togglePlay() {
    var v = S.video;
    if (!v) return;
    if (v.paused || v.ended) { S.el.err.classList.add('pl-hidden'); tryPlay(v, false); }
    else v.pause();
  }
  function seek(t) {
    var v = S.video;
    if (!v) return;
    t = Number(t) || 0;
    if (!isFinite(v.duration)) { showMessage('还不知道视频总时长，暂时无法跳转'); return; }
    try { v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.15)); }
    catch (e) { showMessage('跳转失败：视频还在缓冲'); }
    updateProgress();
  }
  function setSpeed(v) {
    v = Number(v);
    if (!isFinite(v) || v < 0.5 || v > 3) { showMessage('倍速范围 0.5× ~ 3×'); return false; }
    if (S.video) { S.video.playbackRate = v; S.video.preservesPitch = true; }
    if (S.el.speed) S.el.speed.value = String(v);
    showMessage('倍速 ' + v + '×');
    return true;
  }
  function setQuality(q) {
    if (q === '' || q == null) q = '-1';
    var sel = S.el.quality;
    if (sel) sel.value = String(q);
    if (!S.hls) {
      if (String(q) === '-1') return true;
      showMessage('当前视频没有可调清晰度（自动）');
      return false;
    }
    var levels = S.hls.levels || [];
    if (String(q) === '-1' || q === 'auto') {
      S.hls.currentLevel = -1;
      showMessage('画质：自动');
      return true;
    }
    var idx = -1;
    // 优先按档位下标，其次按高度（720 / 1080）
    if (Number(q) < levels.length) idx = Number(q);
    if (idx < 0) {
      for (var i = 0; i < levels.length; i++) {
        if (String(levels[i].height) === String(q)) { idx = i; break; }
      }
    }
    if (idx >= 0 && levels[idx]) {
      S.hls.currentLevel = idx;
      showMessage('画质：' + (levels[idx].height ? levels[idx].height + 'p' : '档位 ' + idx));
      return true;
    }
    showMessage('没有这个清晰度');
    return false;
  }
  function togglePip() {
    var v = S.video;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        var ex = document.exitPictureInPicture;
        if (ex) { var p = ex.call(document); if (p && p.catch) p.catch(function (e) { t('退出画中画失败：' + (e.message || '浏览器限制')); }); }
        return;
      }
      if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') {
        var pr = v.requestPictureInPicture();
        if (pr && pr.then) pr.then(function () {
          t('已进入画中画（系统通道，字幕可能不跟随）');
        });
        if (pr && pr.catch) pr.catch(function (e) {
          t('无法进入画中画：' + (e && e.message ? e.message : '浏览器限制'));
        });
      } else {
        t('当前浏览器不支持画中画（iOS Safari 请用「全屏」或「小窗」）');
      }
    } catch (e) {
      t('画中画不可用：' + (e && e.message ? e.message : '浏览器限制'));
    }
  }
  function fallbackFullscreen() {
    if (!S.root) return;
    S.root.classList.toggle('pl-fs');
    t('此浏览器不支持系统全屏，已切换网页全屏（再点还原）');
  }
  function toggleFullscreen() {
    if (!S.root) return;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) ex.call(document);
        return;
      }
      var r = S.root;
      var rq = r.requestFullscreen || r.webkitRequestFullscreen || r.msRequestFullscreen;
      if (rq) {
        var p = rq.call(r);
        if (p && p.catch) p.catch(function () { fallbackFullscreen(); });
        return;
      }
      if (S.video && S.video.webkitEnterFullscreen) {
        try { S.video.webkitEnterFullscreen(); t('已进入 iOS 全屏（系统播放器）'); return; } catch (e) {}
      }
      fallbackFullscreen();
    } catch (e) { fallbackFullscreen(); }
  }
  function toggleMini() {
    if (!S.root) return;
    S.mini = !S.mini;
    S.root.classList.toggle('pl-mini', S.mini);
    if (!S.mini) {
      // 还原到普通流：清掉拖动/缩放留下的内联几何
      ['left', 'top', 'width', 'height', 'right', 'bottom'].forEach(function (k) {
        S.root.style[k] = '';
      });
    }
    t(S.mini ? '已切换到悬浮小窗：拖标题栏移动，拖右下角缩放' : '已退出悬浮小窗');
  }
  function retry() {
    if (!S.root) return;
    S.retries = 0; S.gwTried = false;
    clearTimeout(S.retryTimer);
    S.el.err.classList.add('pl-hidden');
    showMessage('正在重新加载…');
    attachSource(S.source);
  }

  /* ------------------------------------------------- makeDraggable / 手势 */
  // mode: 'move' 拖动整个小窗；'resize' 拖右下角改尺寸
  function makeDraggable(handle, mode) {
    if (!handle) return;
    var act = false, sx = 0, sy = 0, sw = 0, sh = 0, sl = 0, stp = 0;
    on(handle, 'pointerdown', function (e) {
      if (mode === 'resize' && !S.mini) return;
      act = true;
      sx = e.clientX; sy = e.clientY;
      sw = S.root.offsetWidth; sh = S.root.offsetHeight;
      sl = S.root.offsetLeft; stp = S.root.offsetTop;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    on(handle, 'pointermove', function (e) {
      if (!act || !S.root) return;
      if (mode === 'move') {
        var x = clamp(sl + e.clientX - sx, 0, Math.max(0, window.innerWidth - S.root.offsetWidth));
        var y = clamp(stp + e.clientY - sy, 0, Math.max(0, window.innerHeight - S.root.offsetHeight));
        S.root.style.left = x + 'px'; S.root.style.top = y + 'px';
        S.root.style.right = 'auto'; S.root.style.bottom = 'auto';
      } else {
        var w = clamp(sw + e.clientX - sx, 220, Math.max(220, window.innerWidth - 16));
        var h = clamp(sh + e.clientY - sy, 130, Math.max(130, window.innerHeight - 16));
        S.root.style.width = w + 'px'; S.root.style.height = h + 'px';
      }
    });
    function end() { act = false; }
    on(handle, 'pointerup', end);
    on(handle, 'pointercancel', end);
  }

  function bindGestures() {
    var g = S.gesture;
    if (!g) return;
    var pts = {};              // pointerId -> 坐标与起点
    var pinch = null;          // {d,w,h}
    var tapTimer = null, lastTap = null;

    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function ids() { return Object.keys(pts); }
    function handleTap(x) {
      var now = Date.now();
      var rect = S.root.getBoundingClientRect();
      var side = x < rect.left + rect.width / 2 ? -1 : 1; // 左半快退 / 右半快进
      if (lastTap && now - lastTap.t < 320 && Math.abs(x - lastTap.x) < 60) {
        clearTimeout(tapTimer); tapTimer = null; lastTap = null;
        seek((S.video.currentTime || 0) + side * 10);
        showMessage(side < 0 ? '快退 10 秒' : '快进 10 秒');
        return;
      }
      lastTap = { t: now, x: x };
      tapTimer = setTimeout(function () { tapTimer = null; toggleControls(); }, 320);
    }
    on(g, 'pointerdown', function (e) {
      if (cfg().gesture === false) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, t: Date.now(), moved: false };
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      if (ids().length === 2) {
        clearTimeout(tapTimer); tapTimer = null; lastTap = null;
        var k = ids(), a = pts[k[0]], b = pts[k[1]];
        pinch = { d: dist(a, b) || 1, w: S.root.offsetWidth, h: S.root.offsetHeight };
      }
    });
    on(g, 'pointermove', function (e) {
      if (cfg().gesture === false) return;
      var p = pts[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.ox, dy = e.clientY - p.oy;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) p.moved = true;
      var k = ids();
      if (k.length >= 2 && pinch) {
        // 双指捏合：缩放悬浮小窗（非小窗模式下不动，避免误触画面）
        if (S.mini) {
          var a = pts[k[0]], b = pts[k[1]];
          var scale = clamp(dist(a, b) / pinch.d, 0.5, 3);
          S.root.style.width = clamp(Math.round(pinch.w * scale), 220, window.innerWidth - 16) + 'px';
          S.root.style.height = clamp(Math.round(pinch.h * scale), 130, window.innerHeight - 16) + 'px';
        }
        return;
      }
      if (!p.moved) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        // 横滑：相对快进 / 快退
        seek((S.video.currentTime || 0) + dx / 8);
        p.ox = e.clientX; p.oy = e.clientY;
      } else {
        // 竖滑：音量（右半区，符合常见播放器习惯；此处全区域可调）
        var vol = clamp(S.video.volume - dy / 220, 0, 1);
        S.video.volume = vol; S.video.muted = vol === 0;
        showMessage('音量 ' + Math.round(vol * 100) + '%');
        p.ox = e.clientX; p.oy = e.clientY;
      }
    });
    function up(e) {
      var p = pts[e.pointerId];
      if (!p) return;
      delete pts[e.pointerId];
      if (pinch) { if (ids().length < 2) pinch = null; return; }
      if (!p.moved && Date.now() - p.t < 350 && cfg().gesture !== false) handleTap(e.clientX);
    }
    on(g, 'pointerup', up);
    on(g, 'pointercancel', up);
  }

  /* ------------------------------------------------------------ 浮层提示 */
  function showMessage(msg) {
    var m = S.el && S.el.msg;
    if (!m) return;
    m.textContent = String(msg || '');
    m.classList.remove('pl-hidden');
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(function () {
      if (S.el && S.el.msg) S.el.msg.classList.add('pl-hidden');
    }, 2600);
  }
  function showError(msg) {
    var e = S.el;
    if (!e || !e.err) { t(msg); return; }
    e.spinner.classList.add('pl-hidden');
    e.errP.textContent = String(msg || '播放失败');
    e.err.classList.remove('pl-hidden');
  }

  /* -------------------------------------------------------------- destroy */
  function destroy() {
    clearTimers();
    clearTimeout(showMessage._t);
    S.listeners.forEach(function (x) { try { x[0].removeEventListener(x[1], x[2], x[3]); } catch (e) {} });
    S.listeners = [];
    destroyHls();
    if (S.video) {
      try { S.video.pause(); } catch (e) {}
      try { S.video.removeAttribute('src'); S.video.load(); } catch (e) {}
    }
    if (S.root && S.root.parentNode) { try { S.root.parentNode.removeChild(S.root); } catch (e) {} }
    S.root = S.video = S.stage = S.gesture = null;
    S.el = {}; S.opts = {}; S.source = S.actual = S.resumeKey = '';
    S.mini = false; S.destroyed = true;
  }

  /* -------------------------------------------------------- 对外全局接口 */
  window.Player = {
    mount: mount,
    play: play,
    togglePlay: togglePlay,
    seek: seek,
    setSpeed: setSpeed,
    setQuality: setQuality,
    togglePip: togglePip,
    toggleFullscreen: toggleFullscreen,
    toggleMini: toggleMini,
    retry: retry,
    destroy: destroy,
    getVideo: function () { return S.video; },
    showMessage: showMessage,
    showError: showError,
    makeDraggable: makeDraggable
  };
})();
