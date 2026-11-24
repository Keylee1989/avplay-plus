/* AvPlay+ · spec extras: adblock, quickbar 2.0, lock cycle, main panel, chong, image search */
(function () {
  'use strict';
  var A = window.AV; if (!A) return;
  var el = A.el, $ = A.$, $$ = A.$$;

  /* ---- adblock (script's 3795 domains + tokens + selectors) ---- */
  var AD = window.AV_ADBLOCK_DATA || { domains: [], tokens: [], selectors: [], live: [], css: '' };
  var domainSet = {}; AD.domains.forEach(function (d) { domainSet[d] = 1; });
  function hostOf(u) { try { return new URL(u, location.href).hostname.toLowerCase(); } catch (e) { return ''; } }
  function isAd(url) {
    var u = String(url || '').toLowerCase(), h = hostOf(u);
    if (!h) return false;
    if (domainSet[h] === 1) return true;
    var parts = h.split('.');
    for (var i = 1; i < parts.length; i++) { if (domainSet[parts.slice(i).join('.')] === 1) return true; }
    for (var j = 0; j < AD.tokens.length; j++) { if (u.indexOf(AD.tokens[j]) >= 0) return true; }
    return false;
  }
  window.AV_ADBLOCK = { isAd: isAd, domains: AD.domains.length, selectors: AD.selectors.concat(AD.live).length };
  var origOpen = window.open;
  window.open = function (url) {
    if (AV_SETTINGS.adblock && isAd(url)) { A.toast('已拦截广告：' + hostOf(url)); return null; }
    return origOpen.apply(window, arguments);
  };

  /* ---- JAVTool site (required by spec, not in script: bare homepage, unverified) ---- */
  if (!A.D.sites.some(function (s) { return s.id === 'javtool'; })) {
    A.D.sites.push({ id: 'javtool', name: 'JAVTool', host: 'javtool.com', group: 'lib', url: 'https://javtool.com', unverified: true });
  }

  /* ---- lock cycle: 未锁 → 锁屏 → 锁窗 → 未锁 ---- */
  var LOCK_KEY = 'lockState', states = ['none', 'screen', 'window'], labels = { none: '未锁', screen: '锁屏', window: '锁窗' };
  function lockState() { return A.store.get(LOCK_KEY, 'none'); }
  function setLock(s) {
    A.store.set(LOCK_KEY, s);
    document.body.classList.toggle('lockscreen', s === 'screen');
    document.body.classList.toggle('lockwindow', s === 'window');
    var b = $('#lockLabel'); if (b) b.textContent = labels[s];
    A.toast('已切到：' + labels[s]);
  }
  function cycleLock() { var i = states.indexOf(lockState()); setLock(states[(i + 1) % states.length]); }
  setLock(lockState());

  /* ---- quick bar 2.0: 2-column grid, 10 buttons ---- */
  var Q = [
    { t: '聚合', a: 'home', ic: '🏠' }, { t: '字幕', a: 'sub', ic: '📄' },
    { t: '下载', a: 'download', ic: '⬇' }, { t: '1×', a: 'speed', ic: '⏩' },
    { t: '收藏', a: 'fav', ic: '⭐' }, { t: '小窗', a: 'mini', ic: '🪟' },
    { t: '面板', a: 'panel', ic: '🗂' }, { t: '工具箱', a: 'tools', ic: '🧰' },
    { t: '锁屏', a: 'lock', ic: '🔒' }, { t: '搜索', a: 'search', ic: '🔍' }
  ];
  function buildQuick() {
    var bar = $('#quickBar'); if (!bar) return;
    bar.className = 'quickbar qbar2';
    bar.innerHTML = '';
    Q.forEach(function (q) {
      var b = el('button', '', '<span>' + q.ic + '</span> ' + q.t);
      b.dataset.act = q.a; bar.appendChild(b);
    });
    bar.querySelector('#lockLabel'); // placeholder no-op
    var lockBtn = $$('#quickBar button').find(function (b) { return b.dataset.act === 'lock'; });
    if (lockBtn) lockBtn.appendChild(el('span', 'ver-line', ''));
  }
  buildQuick();

  function qAction(a) {
    switch (a) {
      case 'home': case 'sub': case 'fav': case 'tools': window.App && App.show(a); break;
      case 'download': downloadDialog(); break;
      case 'speed': if (window.Player) { var v = Player.getVideo(); if (v) { v.playbackRate = v.playbackRate >= 3 ? 0.5 : v.playbackRate + 0.25; A.toast('倍速 ' + v.playbackRate + '×'); } } break;
      case 'mini': if (window.Player && Player.toggleMini) Player.toggleMini(); break;
      case 'panel': mainPanel(); break;
      case 'lock': cycleLock(); break;
      case 'search': var s = $('#globalSearch'); if (s) { s.focus(); s.scrollIntoView({ block: 'center' }); } break;
      case 'copycode': if (App && App.code) A.copy(App.code); break;
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#quickBar button[data-act]');
    if (b) { qAction(b.dataset.act); $('#quickBar').classList.remove('open'); }
  });

  /* ---- gold button: draggable + fade after 3s idle ---- */
  var gold = $('#goldBtn');
  if (gold) {
    var dragging = false, ox = 0, oy = 0, sx = 0, sy = 0, idleTimer = null;
    function wake() {
      gold.classList.remove('idle'); clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { if (!dragging) gold.classList.add('idle'); }, 3000);
    }
    wake();
    document.addEventListener('pointermove', wake, { passive: true });
    gold.addEventListener('pointerdown', function (e) {
      dragging = false; sx = e.clientX; sy = e.clientY;
      var r = gold.getBoundingClientRect(); ox = r.left; oy = r.top;
      gold.setPointerCapture && gold.setPointerCapture(e.pointerId);
      gold.addEventListener('pointermove', move);
      gold.addEventListener('pointerup', up);
    });
    function move(e) {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 8) { dragging = true; gold.classList.add('dragging'); }
      if (!dragging) return;
      var x = Math.max(4, Math.min(window.innerWidth - 60, ox + e.clientX - sx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy));
      gold.style.left = x + 'px'; gold.style.top = y + 'px'; gold.style.right = 'auto'; gold.style.bottom = 'auto';
    }
    function up() {
      gold.classList.remove('dragging');
      gold.removeEventListener('pointermove', move); gold.removeEventListener('pointerup', up);
      if (dragging) { ePrevent = true; setTimeout(function () { ePrevent = false; }, 250); }
    }
    var ePrevent = false;
    gold.addEventListener('click', function () { if (ePrevent) return; $('#quickBar').classList.toggle('open'); wake(); });
  }

  /* ---- main panel: spec's 10 named tabs mapped to working views ---- */
  function mainPanel() {
    var defs = [
      ['画面', 'play'], ['播放', 'play'], ['资源', 'home'], ['字幕', 'sub'], ['增强', 'tools'],
      ['下载', 'download'], ['收藏', 'fav'], ['记录', 'history'], ['站点', 'home'], ['净化', 'settings']
    ];
    var wrap = el('div');
    var tabs = el('div', 'panel-tabs');
    var body = el('div', 'panel-body');
    defs.forEach(function (d, i) {
      var b = el('button', i === 0 ? 'on' : '', d[0]);
      b.addEventListener('click', function () {
        $$('.panel-tabs button', wrap).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        body.innerHTML = '<p class="hint">「' + A.esc(d[0]) + '」对应功能页，点击下方按钮进入。</p>';
        var go = el('button', 'btn primary', '进入' + d[0]);
        go.addEventListener('click', function () { m.hide(); if (d[1] === 'download') downloadDialog(); else if (App) App.show(d[1]); });
        body.appendChild(go);
      });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs); wrap.appendChild(body);
    var m = A.modal('主面板 · 10 页签', wrap, { wide: true });
    body.innerHTML = '<p class="hint">选择一个页签。</p>';
  }

  /* ---- 冲码: mark cycle + generate/bind/sync ---- */
  function chongDialog(code) {
    code = code || (App && App.code) || '';
    var marks = A.store.get('chongMarks', {});
    var wrap = el('div');
    function render() {
      var cur = marks[code] || 'none';
      var next = { none: '已冲', done: '待冲', pending: '无' }[cur];
      wrap.innerHTML = '<p class="hint">番号：<b>' + A.esc(code || '（未设置）') + '</b> · 码是唯一凭证，6–16 位字母数字。</p>' +
        '<div class="row"><span class="badge">当前：' + ({ none: '无', done: '已冲', pending: '待冲' }[cur]) + '</span>' +
        '<button class="btn small" id="chNext">切到「' + next + '」</button></div>' +
        '<div class="divider"></div>' +
        '<div class="row"><input id="chCode" class="mono" style="flex:1;min-width:160px;background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:8px" placeholder="冲码（6–16 位字母数字）" value="' + A.esc(A.store.get('chongCode', '')) + '">' +
        '<button class="btn small" id="chGen">生成</button><button class="btn small" id="chBind">绑定</button><button class="btn small primary" id="chSync">同步</button></div>' +
        '<p class="hint" id="chMsg">LWW：以 markedAt 时间戳为准；POST /api/chong/sync。</p>';
      $('#chNext', wrap).addEventListener('click', function () {
        marks[code] = ({ none: 'done', done: 'pending', pending: 'none' })[cur];
        A.store.set('chongMarks', marks); render();
      });
      $('#chGen', wrap).addEventListener('click', function () {
        var s = ''; var cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 12; i++) s += cs[Math.floor(Math.random() * cs.length)];
        $('#chCode', wrap).value = s; A.store.set('chongCode', s); A.toast('已生成冲码');
      });
      $('#chBind', wrap).addEventListener('click', function () {
        var v = $('#chCode', wrap).value.trim();
        if (!/^[A-Za-z0-9]{6,16}$/.test(v)) return A.toast('码必须是 6–16 位字母数字', 'error');
        A.store.set('chongCode', v); A.toast('已绑定');
      });
      $('#chSync', wrap).addEventListener('click', function () {
        var v = $('#chCode', wrap).value.trim();
        if (!/^[A-Za-z0-9]{6,16}$/.test(v)) return A.toast('先填有效冲码', 'error');
        var payload = { code: v, videoId: code, mark: marks[code] || 'none', markedAt: Date.now() };
        $('#chMsg', wrap).textContent = '同步中…';
        fetch(A.proxyUrl(A.D.apis.javRankingWorker + '/api/chong/sync'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        }).then(function (r) { return r.text(); }).then(function (t) {
          $('#chMsg', wrap).textContent = '同步结果：' + t.slice(0, 200);
        }).catch(function (e) { $('#chMsg', wrap).textContent = '同步失败（可稍后重试）：' + e.message; });
      });
    }
    render();
    A.modal('冲码 · ' + (code || '未设置'), wrap);
  }
  window.Chong = { open: chongDialog };

  /* ---- image search (AvScan / whos.tv / javtool) ---- */
  function imageDialog() {
    var wrap = el('div');
    wrap.innerHTML =
      '<p class="hint">识图需要外部服务。以下入口按脚本/需求原样提供，不伪造识别结果。</p>' +
      '<div class="list">' +
        '<div class="li"><div class="grow"><div class="t">AvScan 找番号</div><div class="s">上传视频截图 → 番号 + 相似度</div></div><button class="btn small" data-i="avscan">打开</button></div>' +
        '<div class="li"><div class="grow"><div class="t">whos.tv 识图</div><div class="s">外部服务，浏览器打开</div></div><button class="btn small" data-i="whos">外跳</button></div>' +
        '<div class="li"><div class="grow"><div class="t">javtool 找女优</div><div class="s">上传照片 → 前 3 名 + 相似度（需 javtool 数据）</div></div><button class="btn small" data-i="javtool">打开</button></div>' +
      '</div><p class="hint" id="imgMsg"></p>';
    $$('[data-i]', wrap).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.i;
        if (k === 'whos') { A.openExternal('https://whos.tv/'); return; }
        var url = k === 'avscan' ? 'https://avscan.cc/' : 'https://javtool.com/';
        $('#imgMsg', wrap).textContent = '已打开 ' + url + '（识别在对方站点完成）。';
        A.openExternal(url);
      });
    });
    A.modal('识图', wrap);
  }

  /* ---- download tab: magnet copy + PikPak external ---- */
  function downloadDialog() {
    var wrap = el('div');
    wrap.innerHTML =
      '<p class="hint">磁力只做复制 + PikPak 外跳，不直接播。WebRTC 种子常 0 peers，播不了请用外跳。</p>' +
      '<input id="mgUrl" style="width:100%;background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:9px" placeholder="粘贴 magnet: / ed2k: 链接">' +
      '<div class="row" style="margin-top:10px"><button class="btn small" id="mgCopy">复制磁力</button>' +
      '<button class="btn small primary" id="mgPik">PikPak 外跳</button></div>';
    $('#mgCopy', wrap).addEventListener('click', function () {
      var v = $('#mgUrl', wrap).value.trim(); if (!v) return A.toast('先粘贴链接');
      A.copy(v);
    });
    $('#mgPik', wrap).addEventListener('click', function () {
      var v = $('#mgUrl', wrap).value.trim(); if (!v) return A.toast('先粘贴链接');
      A.openExternal('pikpakapp://open/?url=' + encodeURIComponent(v));
    });
    A.modal('下载 / 磁力', wrap);
  }
  window.Download = { open: downloadDialog };

  /* ---- list/grid toggle + extra buttons injected into views ---- */
  function addViewButtons() {
    var h = $('#view-home');
    if (h && !$('#viewToggle')) {
      var bar = el('div', 'row'); bar.id = 'viewToggle';
      bar.style.margin = '6px 0 10px';
      bar.innerHTML = '<button class="btn small" id="vgGrid">网格</button><button class="btn small" id="vgList">列表</button>' +
        '<button class="btn small" id="vgChong">冲码</button><button class="btn small" id="vgImg">识图</button>' +
        '<button class="btn small" id="vgDl">下载</button><button class="btn small" id="vgPanel">主面板</button>';
      var first = h.querySelector('.ag-hero');
      if (first) h.insertBefore(bar, first.nextSibling); else h.insertBefore(bar, h.firstChild);
      $('#vgGrid').addEventListener('click', function () { var r = $('#homeResult'); if (r) r.classList.remove('ag-list'); });
      $('#vgList').addEventListener('click', function () { var r = $('#homeResult'); if (r) r.classList.add('ag-list'); });
      $('#vgChong').addEventListener('click', function () { chongDialog(); });
      $('#vgImg').addEventListener('click', imageDialog);
      $('#vgDl').addEventListener('click', downloadDialog);
      $('#vgPanel').addEventListener('click', mainPanel);
    }
    var ltx = $('#view-ltx');
    if (ltx && !$('#ltxChong')) {
      var b = el('button', 'btn small', '冲码'); b.id = 'ltxChong';
      b.style.marginLeft = '8px';
      b.addEventListener('click', function () { chongDialog(); });
      var sec = ltx.querySelector('.sec-title');
      if (sec) sec.appendChild(b);
    }
    var s = $('#view-settings');
    if (s && !$('.ver-line', s)) {
      s.appendChild(el('p', 'ver-line', '应用版本 1.0 · 脚本基线 v6.40.27（需求描述 6.40.28）· iOS 最低 15.3 · 数据源：手艺活 v1.3 脚本原文'));
    }
    var j = $('#view-javdb');
    if (j && !$('#jdLogin')) {
      var lb = el('button', 'btn small ghost', 'JavDB 登录（本机）'); lb.id = 'jdLogin'; lb.style.marginLeft = '8px';
      lb.addEventListener('click', function () {
        var w = el('div');
        w.innerHTML = '<p class="hint">账号密码只存在这台设备上，不经过任何服务器。本 App 不上传凭据。</p>' +
          '<input id="jdu" placeholder="账号" style="width:100%;margin-bottom:8px;background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:8px">' +
          '<input id="jdp" type="password" placeholder="密码" style="width:100%;background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:8px">';
        var m = A.modal('JavDB 登录', w);
        var save = el('button', 'btn primary', '仅存本机'); save.style.marginTop = '10px';
        save.addEventListener('click', function () {
          A.store.set('javdbLocal', { u: $('#jdu', w).value, p: $('#jdp', w).value });
          m.hide(); A.toast('已存到本机（不上传）');
        });
        w.appendChild(save);
      });
      var t = j.querySelector('.sec-title'); if (t) t.appendChild(lb);
    }
  }
  // Run after each render so injected buttons survive tab switches.
  var origShow = window.App && window.App.show;
  if (origShow) {
    window.App.show = function (tab, code) { var r = origShow(tab, code); try { addViewButtons(); } catch (e) {} return r; };
  }
  document.addEventListener('DOMContentLoaded', function () { setTimeout(addViewButtons, 0); });
  setTimeout(addViewButtons, 50);

  /* ---- window chrome on player ---- */
  var seen = null;
  setInterval(function () {
    var mount = $('#playMount'); if (!mount) return;
    var wrap = mount.querySelector('.pl-wrap');
    if (!wrap || wrap === seen) return;
    seen = wrap;
    if ($('.pl-chrome', mount)) return;
    var bar = el('div', 'pl-chrome');
    bar.innerHTML = '<span class="dot"></span><span class="ttl">播放器窗口</span>' +
      '<select><option>100%</option><option>85%</option><option>70%</option><option>60%</option><option>50%</option></select>' +
      '<button class="y" title="最小化">−</button><button class="g" title="全屏">⛶</button><button class="r" title="关闭">×</button>';
    mount.insertBefore(bar, wrap);
    var sel = bar.querySelector('select');
    sel.addEventListener('change', function () {
      var v = parseInt(sel.value, 10) / 100;
      var app = document.querySelector('.app'); if (app) app.style.zoom = v;
      A.toast('缩放 ' + sel.value);
    });
    var bs = bar.querySelectorAll('button');
    bs[0].addEventListener('click', function () { if (window.Player) Player.toggleMini(); });
    bs[1].addEventListener('click', function () { if (window.Player) Player.toggleFullscreen(); });
    bs[2].addEventListener('click', function () { if (window.Player) Player.destroy(); A.toast('播放器已关闭'); });
  }, 800);

  /* ---- expose ---- */
  window.Extra = { isAd: isAd, mainPanel: mainPanel, chong: chongDialog, image: imageDialog, download: downloadDialog, cycleLock: cycleLock };
})();
