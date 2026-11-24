/* AvPlay+ · app shell / wiring */
(function () {
  'use strict';
  var A = window.AV;
  if (!A) { document.body.innerHTML = '<p style="padding:20px">核心脚本未加载。</p>'; return; }

  var TABS = [
    { id: 'home', name: '聚合', ic: '🏠' },
    { id: 'recommend', name: '推荐', ic: '✨' },
    { id: 'ltx', name: 'LTX库', ic: '💎' },
    { id: 'sub', name: '字幕', ic: '📄' },
    { id: 'play', name: '播放', ic: '▶️' },
    { id: 'javdb', name: 'JavDB', ic: '🔍' },
    { id: 'rank', name: '榜单', ic: '🏆' },
    { id: 'fav', name: '收藏', ic: '⭐' },
    { id: 'history', name: '记录', ic: '🕘' },
    { id: 'tools', name: '工具', ic: '🧰' },
    { id: 'settings', name: '设置', ic: '⚙️' }
  ];
  var BOTTOM = ['home', 'ltx', 'sub', 'play', 'fav'];
  var current = 'home';
  var currentCode = '';

  function $(s, r) { return A.$(s, r); }
  function el(t, c, h) { return A.el(t, c, h); }

  /* ---------------- tabs ---------------- */
  function buildTabs() {
    var tabs = $('#tabs'), nav = $('#bottomnav');
    TABS.forEach(function (t) {
      var b = el('button', 'tab', A.esc(t.name));
      b.dataset.tab = t.id;
      b.addEventListener('click', function () { show(t.id); });
      tabs.appendChild(b);
    });
    BOTTOM.forEach(function (id) {
      var t = TABS.find(function (x) { return x.id === id; });
      var b = el('button', '', '<span class="ic">' + t.ic + '</span><span>' + t.name + '</span>');
      b.dataset.tab = id;
      b.addEventListener('click', function () { show(id); });
      nav.appendChild(b);
    });
  }

  function show(tab, code) {
    if (!tab) tab = 'home';
    if (code) { currentCode = A.normalizeCode(code); $('#globalSearch').value = currentCode; }
    current = tab;
    A.$$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    A.$$('#tabs .tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    A.$$('#bottomnav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    render(tab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  A.tabs = { show: show, get current() { return current; }, get code() { return currentCode; } };

  function render(tab) {
    var v = $('#view-' + tab);
    if (!v) return;
    try {
      switch (tab) {
        case 'home': renderHome(v); break;
        case 'recommend': renderRecommend(v); break;
        case 'ltx': renderLtx(v); break;
        case 'sub': renderSub(v); break;
        case 'play': renderPlay(v); break;
        case 'javdb': renderJavdb(v); break;
        case 'rank': renderRank(v); break;
        case 'fav': renderList(v, A.favorites(), '收藏'); break;
        case 'history': renderList(v, A.history(), '历史记录'); break;
        case 'tools': renderTools(v); break;
        case 'settings': renderSettings(v); break;
      }
    } catch (e) {
      v.innerHTML = '<div class="empty">页面加载失败：' + A.esc(e.message) + '</div>';
      A.toast('页面出错：' + e.message, 'error');
    }
  }

  /* ---------------- home ---------------- */
  function renderHome(v) {
    v.innerHTML =
      '<div class="ag-hero">' +
        '<h2>全站聚合搜索</h2>' +
        '<p class="hint" id="homeHint">输入番号或片名，一键查 ' + (A.D.sites || []).length + ' 个站 · ' +
        (A.D.subtitleSites || []).length + ' 个字幕源 · LTX ' + (A.LTX || []).length + ' 部离线片库。</p>' +
        '<div class="row" style="margin-top:10px">' +
          '<button class="btn small" id="homeRec">✨ 推荐</button>' +
          '<button class="btn small" id="homeLtx">浏览 LTX 片库</button>' +
          '<button class="btn small ghost" id="homeImport">导入我的资源</button>' +
          '<span class="statusdot" id="adblockState"></span>' +
          '<span class="hint" id="adblockLabel">广告拦截</span>' +
        '</div>' +
      '</div>' +
      '<div id="homeResult"></div>';
    $('#homeRec').addEventListener('click', function () { show('recommend'); });
    $('#homeLtx').addEventListener('click', function () { show('ltx'); });
    $('#homeImport').addEventListener('click', importDialog);

    if (currentCode) {
      A.addHistory({ code: currentCode, title: currentCode, type: 'search' });
      $('#homeHint').innerHTML = '正在聚合 <b>' + A.esc(currentCode) + '</b> 的资源…';
      if (window.Search && Search.renderAggregate) Search.renderAggregate($('#homeResult'), currentCode);
      else $('#homeResult').innerHTML = '<div class="empty">搜索模块未加载。</div>';
    } else {
      $('#homeResult').innerHTML =
        '<div class="sec-title">快速开始</div>' +
        '<div class="grid">' +
          '<button class="card btn" data-q="SSIS-001"><div class="body"><div class="t">试试 SSIS-001</div><div class="m">番号聚合</div></div></button>' +
          '<button class="card btn" data-q="JAV"><div class="body"><div class="t">试试 JAV</div><div class="m">片名关键词</div></div></button>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<p class="hint">功能：' + A.D.sites.length + ' 个资源站并行聚合 · ' + A.D.subtitleSites.length + ' 源字幕（中文优先 / LTX 置顶 / 迅雷置后）· ' +
        'LTX 4310 部离线检索 · JavDB 详情 · JavRanking 榜单 · 多线路播放 / 断点 / 倍速 / 小窗 / PiP · ' +
        '收藏 / 历史 / 冲码 · 资源导入 · 广告拦截。全部资源来自脚本原文，不编造。</p>';
      A.$$('#homeResult [data-q]').forEach(function (b) {
        b.addEventListener('click', function () { $('#globalSearch').value = b.dataset.q; doSearch(); });
      });
    }
  }

  /* ---------------- 推荐 / 为你推荐 ---------------- */
  function renderRecommend(v) {
    var best = (A.LTX || []).slice().sort(function (a, b) {
      return (Number(b[6]) || 0) - (Number(a[6]) || 0);
    });
    var withSub = best.filter(function (r) { return r[8] && /\.srt/i.test(String(r[8])); });
    function card(r) {
      var code = r[0], title = r[1] || code, cover = r[5], score = r[6], sub = r[8];
      return '<button class="card rc-card" data-code="' + A.esc(code) + '">' +
        (cover ? '<img class="cover" src="' + A.esc(cover) + '" referrerpolicy="no-referrer" loading="lazy">' : '<div class="cover" style="display:grid;place-items:center;color:var(--mute)">暂无封面</div>') +
        '<div class="body"><div class="t">' + A.esc(title) + '</div>' +
        '<div class="m"><span>' + A.esc(code) + '</span><span>★ ' + A.esc(score || '—') + '</span></div>' +
        (sub ? '<span class="badge sub">有字幕</span>' : '') + '</div></button>';
    }
    var hist = A.history().filter(function (h) { return h.code; }).slice(0, 6);
    v.innerHTML =
      '<div class="ag-hero"><h2>为你推荐</h2>' +
      '<p class="hint">基于脚本内置的 LTX 4310 部评分数据（本地离线，不联网、不追踪），以及你自己的观看历史。没有真实数据时不会编造推荐。</p>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn small" id="rcSearch">去聚合搜索</button>' +
      '<button class="btn small ghost" id="rcBrowse">浏览 LTX 全库</button>' +
      '<button class="btn small ghost" id="rcRank">看榜单</button></div></div>' +
      '<div class="sec"><div class="sec-title">高分精选 <span class="cnt">按 LTX 评分排序 · 本地数据</span></div>' +
      '<div class="grid">' + best.slice(0, 24).map(card).join('') + '</div></div>' +
      '<div class="sec"><div class="sec-title">高分且带字幕直链 <span class="cnt">' + withSub.length + ' 部</span></div>' +
      '<div class="grid">' + withSub.slice(0, 24).map(card).join('') + '</div></div>' +
      (hist.length ? '<div class="sec"><div class="sec-title">继续观看 / 最近搜索</div><div class="chips">' +
        hist.map(function (h) { return '<button class="chip" data-h="' + A.esc(h.code) + '">' + A.esc(h.code) + '</button>'; }).join('') + '</div></div>' : '') +
      '<div class="sec"><div class="sec-title">JavRanking 总榜 <span class="cnt">接口数据，加载失败会明确提示</span></div><div id="rcRankBody"><p class="hint">加载中…</p></div></div>';

    A.$$('#view-recommend [data-code]').forEach(function (b) {
      b.addEventListener('click', function () { $('#globalSearch').value = b.dataset.code; doSearch(); show('home'); });
    });
    A.$$('#view-recommend [data-h]').forEach(function (b) {
      b.addEventListener('click', function () { $('#globalSearch').value = b.dataset.h; doSearch(); show('home'); });
    });
    $('#rcSearch').addEventListener('click', function () { show('home'); $('#globalSearch').focus(); });
    $('#rcBrowse').addEventListener('click', function () { show('ltx'); });
    $('#rcRank').addEventListener('click', function () { show('rank'); });
    if (window.Search && Search.javRankingTop) {
      Search.javRankingTop('top', 0, 12).then(function (d) {
        var body = $('#rcRankBody'); if (!body) return;
        if (!d || !d.ok || !(d.items || []).length) { body.innerHTML = '<p class="hint">榜单暂不可用（不编造数据）。可去「榜单」页重试。</p>'; return; }
        body.innerHTML = '<div class="list">' + d.items.map(function (it, i) {
          return '<div class="li"><span class="badge">' + (i + 1) + '</span><div class="grow"><div class="t">' +
            A.esc(it.title || it.code || '') + '</div><div class="s">' + A.esc(it.code || '') + '</div></div></div>';
        }).join('') + '</div>';
      });
    } else { $('#rcRankBody').innerHTML = '<p class="hint">榜单模块未加载。</p>'; }
  }

  /* ---------------- LTX ---------------- */
  function renderLtx(v) {
    v.innerHTML = '<div class="sec-title">LTX 离线片库 <span class="cnt">' + A.LTX.length + ' 部 · 本地秒搜</span></div>' +
      '<div id="ltxBody"></div>';
    if (window.Search && Search.renderLtxBrowser) Search.renderLtxBrowser($('#ltxBody'), '', 1);
    else $('#ltxBody').innerHTML = '<div class="empty">片库模块未加载。</div>';
  }

  /* ---------------- subtitles ---------------- */
  function renderSub(v) {
    v.innerHTML =
      '<div class="sec-title">字幕中心 <span class="cnt">32 源并行 · LTX 置顶 / 中文优先 / 迅雷置后</span></div>' +
      '<div class="pl-wrap" id="subVideo" style="display:none"></div>' +
      '<div id="subPanel"></div>';
    if (window.Subtitles && Subtitles.render) Subtitles.render($('#subPanel'), currentCode || '');
    else $('#subPanel').innerHTML = '<div class="empty">字幕模块未加载。</div>';
  }

  /* ---------------- player ---------------- */
  function renderPlay(v) {
    v.innerHTML =
      '<div class="sec-title">播放器 <span class="cnt">多线路 / 重试 / 断点 / 倍速 / 画质 / PiP / 小窗 / 手势</span></div>' +
      '<div class="row" style="margin-bottom:10px">' +
        '<input id="playUrl" type="text" class="mono" style="flex:1;min-width:200px;background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:10px" placeholder="粘贴 m3u8 / mp4 地址">' +
        '<button class="btn primary" id="playGo">播放</button>' +
      '</div>' +
      '<div id="playMount"></div>' +
      '<div class="sec-title" style="margin-top:18px">备用线路 / 网关解析</div>' +
      '<div id="playLines" class="list"></div>' +
      '<div class="row" style="margin-top:10px">' +
        '<input id="lineInput" type="text" style="flex:1;min-width:180px;background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:9px" placeholder="添加线路 URL">' +
        '<button class="btn small" id="addLine">添加</button>' +
      '</div>';
    if (window.Player && Player.mount) Player.mount($('#playMount'), { title: currentCode || '播放' });
    else $('#playMount').innerHTML = '<div class="empty">播放模块未加载。</div>';
    $('#playGo').addEventListener('click', function () {
      var u = $('#playUrl').value.trim();
      if (!u) return A.toast('先粘贴播放地址');
      if (window.Player) Player.play(u, { title: currentCode || '播放', resumeKey: 'play:' + u });
      A.addHistory({ title: u, url: u, type: 'play' });
    });
    renderLines();
    $('#addLine').addEventListener('click', function () {
      var u = $('#lineInput').value.trim();
      if (!u) return;
      var lines = A.store.get('lines', []);
      lines.push(u); A.store.set('lines', lines);
      $('#lineInput').value = ''; renderLines(); A.toast('已添加线路');
    });
  }

  function renderLines() {
    var box = $('#playLines'); if (!box) return;
    var lines = A.store.get('lines', []);
    box.innerHTML = '';
    if (!lines.length) { box.innerHTML = '<p class="hint">还没有备用线路。可添加多条 m3u8/mp4，播放失败时切换。</p>'; return; }
    lines.forEach(function (u, i) {
      var li = el('div', 'li',
        '<div class="grow"><div class="t mono">' + A.esc(u) + '</div></div>' +
        '<button class="btn small" data-i="' + i + '">播放</button>' +
        '<button class="btn small danger" data-d="' + i + '">删</button>');
      box.appendChild(li);
    });
    A.$$('#playLines [data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        var u = lines[+b.dataset.i];
        $('#playUrl').value = u;
        if (window.Player) Player.play(u, { title: currentCode || '播放', resumeKey: 'play:' + u });
      });
    });
    A.$$('#playLines [data-d]').forEach(function (b) {
      b.addEventListener('click', function () {
        lines.splice(+b.dataset.d, 1); A.store.set('lines', lines); renderLines();
      });
    });
  }

  /* ---------------- JavDB ---------------- */
  function renderJavdb(v) {
    v.innerHTML =
      '<div class="sec-title">JavDB 详情 <span class="cnt">走脚本原接口 jdforrepam.com</span></div>' +
      '<p class="hint" id="jdStatus">' + (currentCode ? '正在查询 ' + A.esc(currentCode) + ' …' : '请在顶部输入番号后搜索。') + '</p>' +
      '<div id="jdBody"></div>';
    if (!currentCode || !window.Search) return;
    Search.javdb(currentCode).then(function (d) {
      var st = $('#jdStatus'), body = $('#jdBody');
      if (!st || !body) return;
      if (d && d.__error) { st.textContent = '查询失败：' + d.message + '（可在设置里配置 CORS 代理）'; return; }
      if (!d) { st.textContent = '没找到匹配的影片。'; return; }
      st.textContent = '';
      body.innerHTML =
        '<div class="card" style="display:flex;gap:14px;padding:14px;flex-wrap:wrap">' +
          (d.cover ? '<img src="' + A.esc(d.cover) + '" style="width:150px;border-radius:10px" referrerpolicy="no-referrer">' : '') +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-weight:700;line-height:1.4">' + A.esc(d.title || d.number) + '</div>' +
            '<p class="hint">番号 ' + A.esc(d.number || '') + ' · 评分 ' + (d.score || '—') + ' · 日期 ' + A.esc(d.date || '') + '</p>' +
            '<p class="hint">演员：' + A.esc((d.actors || []).join(' / ')) + ' · 厂商：' + A.esc(d.maker || '—') + '</p>' +
            '<div class="row">' +
              '<button class="btn small" id="jdFav">⭐ 收藏</button>' +
              '<button class="btn small" id="jdSub">📄 找字幕</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        ((d.stills || []).length ? '<div class="sec-title" style="margin-top:16px">剧照</div><div class="grid">' +
          d.stills.slice(0, 8).map(function (u) { return '<img class="cover" src="' + A.esc(u) + '" referrerpolicy="no-referrer">'; }).join('') + '</div>' : '') +
        ((d.reviews || []).length ? '<div class="sec-title" style="margin-top:16px">评论</div><div class="list">' +
          d.reviews.slice(0, 5).map(function (r) { return '<div class="li"><div class="grow"><div class="s">' + A.esc(r.author || '') + '</div><div class="t">' + A.esc(r.content || r.text || '') + '</div></div></div>'; }).join('') + '</div>' : '');
      $('#jdFav').addEventListener('click', function () {
        A.toggleFavorite({ code: d.number || currentCode, title: d.title || currentCode, cover: d.cover, type: 'javdb' });
        render('fav');
      });
      $('#jdSub').addEventListener('click', function () { show('sub', d.number || currentCode); });
      A.addHistory({ code: d.number || currentCode, title: d.title, cover: d.cover, type: 'javdb' });
    });
  }

  /* ---------------- ranking ---------------- */
  function renderRank(v) {
    v.innerHTML = '<div class="sec-title">JavRanking 榜单 <span class="cnt">app.keylee.eu.cc 官方 Worker</span></div>' +
      '<div class="row" style="margin-bottom:10px">' +
        '<button class="chip on" data-m="top">总榜</button><button class="chip" data-m="random">随机</button>' +
        '<button class="btn small" id="rankMine">🔎 查我的番号</button>' +
      '</div><div id="rankBody"><p class="hint">加载中…</p></div>';
    var mode = 'top';
    A.$$('#view-rank [data-m]').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.dataset.m;
        A.$$('#view-rank [data-m]').forEach(function (x) { x.classList.toggle('on', x === b); });
        loadRank();
      });
    });
    $('#rankMine').addEventListener('click', function () {
      if (!currentCode) return A.toast('先搜索一个番号');
      if (!window.Search) return;
      Search.javRanking(currentCode).then(function (d) {
        A.modal('JavRanking · ' + currentCode,
          d && d.ok === false ? '<p class="hint">榜单暂不可用或该番号未上榜（不编造数据）。</p>' :
          '<p>名次：' + (d && d.rank ? '第 ' + A.esc(d.rank) + ' 名' : '暂无总排名') + '</p>' +
          '<p class="hint">' + (d && d.inIndex ? '在 JavRanking 索引里' : '未在索引里') + '</p>' +
          (d && d.previewUrl ? '<a class="btn small" href="' + A.esc(d.previewUrl) + '" target="_blank" rel="noopener">看预告 ▶</a>' : ''),
          {});
      });
    });
    function loadRank() {
      if (!window.Search) { $('#rankBody').innerHTML = '<div class="empty">榜单模块未加载。</div>'; return; }
      Search.javRankingTop(mode, 0, 24).then(function (d) {
        var body = $('#rankBody'); if (!body) return;
        if (!d || !d.ok || !(d.items || []).length) { body.innerHTML = '<div class="empty">榜单暂不可用（不编造数据）。</div>'; return; }
        body.innerHTML = '<div class="list">' + d.items.map(function (it, i) {
          var code = it.code || it.videoId || (String(it.title || '').match(/[A-Za-z]{2,6}-\d{2,5}/) || [''])[0];
          return '<div class="li"><div style="width:34px;text-align:center;font-weight:800;color:var(--accent)">' + (i + 1) + '</div>' +
            '<div class="grow"><div class="t">' + A.esc(it.title || code) + '</div><div class="s">' + A.esc(code) + ' · 评分 ' + A.esc(it.score || '—') + '</div></div>' +
            (code ? '<button class="btn small" data-c="' + A.esc(code) + '">搜索</button>' : '') + '</div>';
        }).join('') + '</div>';
        A.$$('#rankBody [data-c]').forEach(function (b) {
          b.addEventListener('click', function () { $('#globalSearch').value = b.dataset.c; doSearch(); show('home'); });
        });
      });
    }
    loadRank();
  }

  /* ---------------- fav / history ---------------- */
  function renderList(v, list, title) {
    v.innerHTML = '<div class="sec-title">' + title + ' <span class="cnt">' + list.length + ' 条</span></div>' +
      (list.length ? '<div class="list" id="itemList"></div>' : '<div class="empty">还没有' + title + '。搜索影片后点收藏即可。</div>');
    var box = $('#itemList'); if (!box) return;
    list.forEach(function (it) {
      var code = it.code || '';
      var li = el('div', 'li',
        (it.cover ? '<img src="' + A.esc(it.cover) + '" style="width:42px;height:56px;object-fit:cover;border-radius:6px" referrerpolicy="no-referrer">' : '') +
        '<div class="grow"><div class="t">' + A.esc(it.title || code) + '</div><div class="s">' +
        (code ? A.esc(code) + ' · ' : '') + (it.type || '') + ' · ' + new Date(it.ts || Date.now()).toLocaleString() + '</div></div>' +
        '<button class="btn small" data-open="' + A.esc(code) + '">聚合</button>' +
        '<button class="btn small ghost" data-sub="' + A.esc(code) + '">字幕</button>' +
        '<button class="btn small danger" data-del="' + A.esc(it.code || it.url || it.title || '') + '">删</button>');
      box.appendChild(li);
    });
    A.$$('#itemList [data-open]').forEach(function (b) {
      b.addEventListener('click', function () { $('#globalSearch').value = b.dataset.open; doSearch(); show('home'); });
    });
    A.$$('#itemList [data-sub]').forEach(function (b) {
      b.addEventListener('click', function () { show('sub', b.dataset.sub); });
    });
    A.$$('#itemList [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.del;
        var next = (title === '收藏' ? A.favorites() : A.history()).filter(function (x) {
          return (x.code || x.url || x.title) !== key;
        });
        A.store.set(title === '收藏' ? 'favorites' : 'history', next);
        render(title === '收藏' ? 'fav' : 'history'); A.toast('已删除');
      });
    });
  }

  /* ---------------- tools ---------------- */
  function renderTools(v) {
    v.innerHTML =
      '<div class="sec-title">资源与工具</div>' +
      '<div class="list">' +
        '<div class="li"><div class="grow"><div class="t">导入我的资源</div><div class="s">JSON 文件：自定义站点 / 字幕源 / 线路</div></div><button class="btn small" id="toolImport">导入</button></div>' +
        '<div class="li"><div class="grow"><div class="t">导出我的数据</div><div class="s">收藏 / 历史 / 线路 / 自定义资源</div></div><button class="btn small" id="toolExport">导出</button></div>' +
        '<div class="li"><div class="grow"><div class="t">广告拦截</div><div class="s" id="adDesc">' + (AV_SETTINGS.adblock ? '已开启：拦截弹窗与常见广告域名' : '已关闭') + '</div></div><button class="switch ' + (AV_SETTINGS.adblock ? 'on' : '') + '" id="adSwitch"></button></div>' +
        '<div class="li"><div class="grow"><div class="t">资源统计</div><div class="s">' + A.D.sites.length + ' 站 · ' + A.D.subtitleSites.length + ' 字幕源 · ' + A.LTX.length + ' LTX 条目</div></div></div>' +
        '<div class="li"><div class="grow"><div class="t">数据源</div><div class="s">全部站点 / 字幕源 / 接口来自 手艺活 v1.3 脚本原文，未猜测未编造</div></div></div>' +
        '<div class="li"><div class="grow"><div class="t">MikuTools JAV 搜索（你的会员）</div><div class="s">okmiku.com · JP/US 第三方源 + 磁力；登录后搜，把番号/磁力复制回本 App</div></div><button class="btn small" id="toolMiku">打开</button></div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<p class="hint">说明：本站为纯前端 PWA。字幕/站点的跨域抓取依赖浏览器 CORS，失败时可在设置里填 CORS 代理；' +
      'JavRanking 走脚本自带的 app.keylee.eu.cc Worker，通常可直接请求。播放地址由你提供或来自网关。</p>';
    $('#toolImport').addEventListener('click', importDialog);
    $('#toolMiku').addEventListener('click', function () {
      A.openExternal('https://okmiku.com/t/jav-search');
    });
    $('#toolExport').addEventListener('click', function () {
      var data = {
        sites: A.store.get('customSites', []),
        subtitles: A.store.get('customSubs', []),
        lines: A.store.get('lines', []),
        favorites: A.favorites(), history: A.history()
      };
      A.download('avplay-backup.json', JSON.stringify(data, null, 2), 'application/json');
    });
    $('#adSwitch').addEventListener('click', function () {
      AV_SETTINGS.adblock = !AV_SETTINGS.adblock; A.saveSettings(); renderTools(v);
    });
  }

  function importDialog() {
    var wrap = el('div');
    wrap.innerHTML =
      '<p class="hint">粘贴 JSON，支持：{"sites":[{id,name,host,group,url}]}、{"subtitles":[{id,name,url,searchUrl,note}]}、{"lines":["url"]}。会追加到现有资源，不会删除脚本内置数据。</p>' +
      '<textarea id="impText" rows="9" style="width:100%;background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:10px;font-family:monospace;font-size:.78rem" placeholder=' + JSON.stringify('{"sites":[]}') + '></textarea>' +
      '<div class="modal-actions"><button class="btn primary" id="impGo">导入</button></div>';
    var m = A.modal('导入我的资源', wrap);
    $('#impGo').addEventListener('click', function () {
      try {
        var d = JSON.parse($('#impText').value);
        var n = 0;
        if (Array.isArray(d.sites)) { var s = A.store.get('customSites', []).concat(d.sites); A.store.set('customSites', s); n += d.sites.length; mergeCustomSites(); }
        if (Array.isArray(d.subtitles)) { var su = A.store.get('customSubs', []).concat(d.subtitles); A.store.set('customSubs', su); n += d.subtitles.length; mergeCustomSubs(); }
        if (Array.isArray(d.lines)) { var l = A.store.get('lines', []).concat(d.lines); A.store.set('lines', l); n += d.lines.length; }
        m.hide(); A.toast('已导入 ' + n + ' 项资源');
        if (current === 'home') render('home');
      } catch (e) { A.toast('JSON 解析失败：' + e.message, 'error'); }
    });
  }

  function mergeCustomSites() {
    var custom = A.store.get('customSites', []);
    custom.forEach(function (s) {
      if (!A.D.sites.some(function (x) { return x.id === s.id; })) A.D.sites.push(s);
    });
  }
  function mergeCustomSubs() {
    var custom = A.store.get('customSubs', []);
    custom.forEach(function (s) {
      if (!A.D.subtitleSites.some(function (x) { return x.id === s.id; })) A.D.subtitleSites.push(s);
    });
  }

  /* ---------------- settings ---------------- */
  function renderSettings(v) {
    var s = AV_SETTINGS;
    function toggle(key, label, desc) {
      return '<div class="set-row"><label>' + label + '<span class="desc">' + desc + '</span></label>' +
        '<button class="switch ' + (s[key] ? 'on' : '') + '" data-tg="' + key + '"></button></div>';
    }
    v.innerHTML =
      '<div class="sec-title">外观</div>' +
      '<div class="set-row"><label>主题</label><select id="setTheme"><option value="dark">深色</option><option value="light">浅色</option></select></div>' +
      '<div class="set-row"><label>主题色</label><input type="text" id="setAccent" value="' + A.esc(s.accent) + '"></div>' +
      '<div class="set-row"><label>界面缩放</label><input type="number" id="setScale" min="80" max="140" value="' + s.scale + '"></div>' +
      '<div class="divider"></div><div class="sec-title">网络 / 播放</div>' +
      '<div class="set-row"><label>CORS 代理<span class="desc">Cloudflare Pages 部署后填 https://你的项目.pages.dev/api/proxy?url= （结尾是 ?url=）；留空则直连</span></label><input type="text" id="setProxy" value="' + A.esc(s.proxy) + '" placeholder="留空则直连"></div>' +
      '<div class="set-row"><label>播放网关<span class="desc">可选，形如 https://你的网关</span></label><input type="text" id="setGateway" value="' + A.esc(s.gateway) + '"></div>' +
      toggle('autoplay', '自动播放', '部分浏览器会阻止，不保证生效') +
      toggle('adblock', '广告拦截', '拦截弹窗与常见广告域名') +
      toggle('gesture', '播放手势', '双击快进 / 滑动调音量与进度') +
      toggle('pip', '画中画', '支持时显示 PiP 按钮') +
      '<div class="divider"></div><div class="sec-title">字幕排序</div>' +
      toggle('ltxTop', 'LTX 置顶', 'LTX 直链排在最前') +
      toggle('chineseFirst', '中文优先', '中文字幕排在前面') +
      toggle('xunleiLast', '迅雷置后', '迅雷字幕排在最后') +
      '<div class="set-row"><label>字幕字号</label><input type="number" id="setSubSize" min="14" max="48" value="' + s.subtitleSize + '"></div>' +
      '<div class="divider"></div>' +
      '<div class="row"><button class="btn primary" id="saveSet">保存设置</button><button class="btn ghost" id="resetSet">恢复默认</button></div>' +
      '<p class="hint" style="margin-top:14px">当前代理：' + (s.proxy ? A.esc(s.proxy) : '未设置（直连）') + '</p>';

    $('#setTheme').value = s.theme;
    $('#saveSet').addEventListener('click', function () {
      s.theme = $('#setTheme').value;
      s.accent = $('#setAccent').value.trim() || '#ffd54a';
      s.scale = Math.max(80, Math.min(140, +$('#setScale').value || 100));
      s.proxy = $('#setProxy').value.trim();
      s.gateway = $('#setGateway').value.trim();
      s.subtitleSize = Math.max(14, Math.min(48, +$('#setSubSize').value || 24));
      A.saveSettings(); A.toast('设置已保存'); A.D.apis.gateway = s.gateway; renderSettings(v);
    });
    $('#resetSet').addEventListener('click', function () {
      A.confirm('恢复默认设置？', function () {
        localStorage.removeItem('avp_settings');
        location.reload();
      });
    });
    A.$$('#view-settings [data-tg]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.tg; s[k] = !s[k]; A.saveSettings(); renderSettings(v);
      });
    });
  }

  /* ---------------- global actions ---------------- */
  function doSearch() {
    var q = $('#globalSearch').value.trim();
    if (!q) { A.toast('先输入番号或片名'); return; }
    currentCode = A.normalizeCode(q);
    $('#globalSearch').value = currentCode;
    A.addHistory({ code: currentCode, title: currentCode, type: 'search' });
    show('home', currentCode);
  }

  $('#btnSearch').addEventListener('click', doSearch);
  $('#globalSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  $('#btnClear').addEventListener('click', function () { $('#globalSearch').value = ''; currentCode = ''; render('home'); });
  $('#btnSettings').addEventListener('click', function () { show('settings'); });

  var quick = $('#quickBar');
  function toggleQuick(force) {
    var open = typeof force === 'boolean' ? force : !quick.classList.contains('open');
    quick.classList.toggle('open', open);
  }
  $('#goldBtn').addEventListener('click', function () { toggleQuick(); });
  $('#btnQuick').addEventListener('click', function () { toggleQuick(); });
  A.$$('#quickBar [data-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.dataset.act;
      if (a === 'copycode') {
        if (!currentCode) return A.toast('还没有番号');
        A.copy(currentCode);
      } else if (a === 'mini' && window.Player && Player.toggleMini) {
        Player.toggleMini(); A.toast('小窗已切换');
      } else show(a);
      toggleQuick(false);
    });
  });

  // Basic ad/popup blocking inside the app's own webview context.
  if (AV_SETTINGS.adblock) {
    var origOpen = window.open;
    window.open = function (url, name, feats) {
      try {
        var u = String(url || '');
        if (/^https?:/i.test(u)) {
          var ad = /(^|\.)(ads?|adservice|googlesyndication|doubleclick|popads|popunder|adfly|exoclick|juicyads|advertising)\./i.test(u);
          if (ad && name !== '_self') { A.toast('已拦截广告弹窗'); return null; }
        }
      } catch (e) {}
      return origOpen.apply(window, arguments);
    };
  }

  A.D.apis.gateway = AV_SETTINGS.gateway || '';
  buildTabs();
  mergeCustomSites();
  mergeCustomSubs();
  render('home');
  window.App = { show: show, render: render, get code() { return currentCode; } };
})();
