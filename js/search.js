/* AvPlay+ · search.js
 * ---------------------------------------------------------------------------
 * 聚合搜索 / LTX 本地离线检索 / JavDB / JavRanking / 冲码 / 两个渲染器。
 * 依赖 core.js 暴露的 window.AV、data.js 的 window.AV_DATA、ltx.js 的 window.AV_LTX。
 * 不引入任何库；所有网络请求都走 fetch(AV.proxyUrl(url)) + AbortController 超时。
 * 原则：拿不到数据就如实说拿不到，绝不编造结果。
 * --------------------------------------------------------------------------- */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- helpers */
  function A() { return window.AV || {}; }
  function D() { return window.AV_DATA || {}; }
  function S() { return window.AV_SETTINGS || (window.AV_SETTINGS = {}); }

  function el(tag, cls, html) {
    var av = A();
    if (av.el) return av.el(tag, cls, html);
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    var av = A();
    if (av.esc) return av.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, type) { var av = A(); if (av.toast) av.toast(msg, type); }
  function norm(s) {
    var av = A();
    if (av.normalizeCode) { try { return av.normalizeCode(s) || ''; } catch (e) {} }
    return String(s == null ? '' : s).trim().toUpperCase();
  }
  function fmtSize(n) { var av = A(); return av.fmtSize ? av.fmtSize(n) : String(n || 0); }
  function openExternal(url) { var av = A(); if (av.openExternal) av.openExternal(url); }
  function copyText(t) { var av = A(); if (av.copy) av.copy(t); }
  function modal(title, node, opts) { var av = A(); return av.modal ? av.modal(title, node, opts) : null; }
  function proxy(url) { var av = A(); return av.proxyUrl ? av.proxyUrl(url) : url; }
  function $(sel, root) { var av = A(); return av.$ ? av.$(sel, root) : (root || document).querySelector(sel); }

  /* ---------------------------------------------------------- network layer */
  /* fetch + 超时。headers/body 原样透传；被 CORS 拦下时由调用方如实报错。 */
  function fetchText(url, opts, timeout) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout || 10000) : null;
    var init = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      credentials: 'omit'
    };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body != null) {
      init.body = (typeof opts.body === 'string') ? opts.body : JSON.stringify(opts.body);
    }
    return fetch(proxy(url), init).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      if (timer) clearTimeout(timer);
      return t;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }
  function fetchJson(url, opts, timeout) {
    return fetchText(url, opts, timeout).then(function (t) {
      var o;
      try { o = JSON.parse(t); } catch (e) { throw new Error('响应不是合法 JSON'); }
      if (!o || typeof o !== 'object') throw new Error('响应格式异常');
      return o;
    });
  }

  /* --------------------------------------------------------------- md5 (RFC1321)
   * 紧凑实现，和油猴脚本 suaJavdbApiMd5 完全一致（已对过 Python hashlib）。
   * 只用于 JavDB 的 jdsignature，不做通用哈希库。
   */
  function md5Hex(str) {
    var utf8 = unescape(encodeURIComponent(String(str)));
    var len = utf8.length;
    var words = [];
    var i, j;
    for (i = 0; i < len; i++) words[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
    words[len >> 2] |= 0x80 << ((len % 4) * 8);
    words[(((len + 8) >> 6) << 4) + 14] = len * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    var sh = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var kk = [];
    for (j = 0; j < 64; j++) kk[j] = Math.floor(Math.abs(Math.sin(j + 1)) * 4294967296) | 0;
    var rotl = function (x, n) { return (x << n) | (x >>> (32 - n)); };
    for (var off = 0; off < words.length; off += 16) {
      var aa = a, bb = b, cc = c, dd = d;
      for (var r = 0; r < 64; r++) {
        var f, g;
        if (r < 16) { f = (bb & cc) | (~bb & dd); g = r; }
        else if (r < 32) { f = (dd & bb) | (~dd & cc); g = (5 * r + 1) % 16; }
        else if (r < 48) { f = bb ^ cc ^ dd; g = (3 * r + 5) % 16; }
        else { f = cc ^ (bb | ~dd); g = (7 * r) % 16; }
        var tmp = dd;
        dd = cc;
        cc = bb;
        var sum = (aa + f + kk[r] + (words[off + g] | 0)) | 0;
        bb = (bb + rotl(sum, sh[r])) | 0;
        aa = tmp;
      }
      a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
    }
    function hex(n) {
      var h = '';
      for (var q = 0; q < 4; q++) {
        h += ('0' + ((n >> (q * 8 + 4)) & 15).toString(16)).slice(-1);
        h += ('0' + ((n >> (q * 8)) & 15).toString(16)).slice(-1);
      }
      return h;
    }
    return hex(a) + hex(b) + hex(c) + hex(d);
  }

  /* JavDB 签名：{unix秒}.lpw6vgqzsp.{md5(秒 + 密钥)}，300 秒缓存。
   * 缓存按契约放进 window.AV_SETTINGS.javdbSignature。 */
  var JDSIGN_SUFFIX = '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa';
  function jdsignature() {
    var ts = Math.floor(Date.now() / 1000);
    var c = S().javdbSignature;
    if (c && c.ts && ts - c.ts <= 300) return c.value;
    var value = ts + '.lpw6vgqzsp.' + md5Hex(String(ts) + JDSIGN_SUFFIX);
    S().javdbSignature = { ts: ts, value: value };
    return value;
  }
  function jdHeaders() {
    return {
      'User-Agent': 'Dart/3.5 (dart:io)',
      'Accept': 'application/json',
      'jdsignature': jdsignature()
    };
  }

  function apiBase() {
    var apis = D().apis || {};
    return apis.javRankingWorker || 'https://app.keylee.eu.cc';
  }
  function javdbBase() {
    var apis = D().apis || {};
    return apis.javdb || 'https://jdforrepam.com';
  }

  /* ------------------------------------------------------------------ 1. URL */
  function siteUrl(site, q) {
    if (!site) return '';
    var url = String(site.url || '');
    if (url.indexOf('{q}') < 0) return url; // 例如 ltxlib 的站内首页，没有查询占位符
    // 注意：avwiki 在数据里标了 enc:"eucjp"，但油猴脚本对所有站点一律用
    // encodeURIComponent，不按站点猜编码。这里保持一致，不做 charset 转换。
    return url.replace(/\{q\}/g, encodeURIComponent(q == null ? '' : String(q)));
  }

  /* ------------------------------------------------- 2. LTX 本地（离线、瞬时） */
  function ltx(code, limit) {
    var rows = window.AV_LTX || [];
    var q = String(code == null ? '' : code).trim();
    if (!q || !rows.length) return [];
    var lim = (limit == null) ? 60 : (Number(limit) || 0);
    var ql = q.toLowerCase();
    var nq = norm(q) || ql;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[0]) continue;
      var rowCode = String(r[0]);
      var exact = rowCode.toUpperCase() === nq || norm(rowCode) === nq;
      var title = String(r[1] || '');
      var actors = Array.isArray(r[2]) ? r[2].join(' ') : String(r[2] || '');
      var hay = (title + ' ' + actors).toLowerCase();
      // 精确番号 或 标题/演员子串命中（番号本身也允许子串搜）
      if (!exact && hay.indexOf(ql) < 0 && rowCode.toLowerCase().indexOf(ql) < 0) continue;
      out.push({
        code: rowCode,
        title: title,
        actors: Array.isArray(r[2]) ? r[2].slice() : (r[2] ? [String(r[2])] : []),
        date: String(r[3] || ''),
        maker: String(r[4] || ''),
        cover: String(r[5] || ''),
        score: Number(r[6]) || 0,
        votes: Number(r[7]) || 0,
        subtitle: String(r[8] || ''),
        link: String(r[9] || ''),
        size: Number(r[10]) || 0,
        linkName: String(r[11] || ''),
        __exact: exact ? 1 : 0
      });
    }
    // 精确番号优先，其次评分降序
    out.sort(function (a, b) {
      if (a.__exact !== b.__exact) return b.__exact - a.__exact;
      var sa = a.score, sb = b.score;
      if (sa !== sb) return sb - sa;
      return 0;
    });
    return out.slice(0, lim > 0 ? lim : out.length).map(function (o) {
      delete o.__exact;
      return o;
    });
  }

  /* ---------------------------------------------------------------- 3. JavDB */
  function parseActors(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (a) {
      if (typeof a === 'string') return a.trim();
      if (a && typeof a === 'object') return String(a.name || a.actor_name || a.nickname || '').trim();
      return '';
    }).filter(Boolean);
  }
  function firstOf(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj && obj[keys[i]];
      if (v != null && String(v) !== '') return v;
    }
    return '';
  }
  function jackpotScore(v) {
    var raw = parseFloat(String(v == null ? '' : v));
    if (!isFinite(raw) || raw <= 0) return 0;
    return (raw <= 5) ? Number((raw * 2).toFixed(1)) : Number(Math.min(10, raw).toFixed(1));
  }

  /* async → {id,number,title,cover,score,actors,date,maker,stills,reviews,related}
   * 失败 → {__error:true, message:'...'}（明确告知，不返回半截假数据）。 */
  function javdb(code) {
    var raw = String(code == null ? '' : code).trim();
    var nq = norm(raw);
    if (!nq) return Promise.resolve({ __error: true, message: '请先输入番号' });
    var clean = nq.replace(/[-_]/g, '').toLowerCase();
    var base = javdbBase();
    var qs = new URLSearchParams({
      q: nq, page: '1', type: 'movie', limit: '5', movie_type: 'all',
      from_recent: 'false', movie_filter_by: 'all', movie_sort_by: 'relevance'
    }).toString();

    var movie = null;
    return fetchText(base + '/api/v2/search?' + qs, { headers: jdHeaders() }, 9000)
      .then(function (txt) {
        var body = JSON.parse(txt);
        var movies = (body && body.data && Array.isArray(body.data.movies)) ? body.data.movies : [];
        movie = movies.find(function (m) {
          return String((m && m.number) || '').replace(/[-_]/g, '').toLowerCase() === clean;
        }) || null;
        if (!movie || !movie.id) throw new Error('JavDB 搜索未找到匹配的影片');

        var id = encodeURIComponent(String(movie.id));
        var h = jdHeaders(); // 每条请求重新取签名，避免 ts 跨过 300 秒窗口
        var detailU = base + '/api/v2/movies/' + id;
        var reviewsU = base + '/api/v1/movies/' + id + '/reviews?' + new URLSearchParams({
          page: '1', sort_by: 'hotly', limit: '20'
        }).toString();
        var relatedU = base + '/api/v1/lists/related?' + new URLSearchParams({
          movie_id: String(movie.id), page: '1', limit: '20'
        }).toString();
        // 单条失败不拖垮整体：空串意为“这条没拿到”，后续如实呈现
        return Promise.all([
          fetchText(detailU, { headers: h }, 9000).catch(function () { return ''; }),
          fetchText(reviewsU, { headers: h }, 9000).catch(function () { return ''; }),
          fetchText(relatedU, { headers: h }, 9000).catch(function () { return ''; })
        ]);
      })
      .then(function (parts) {
        var d0 = null;
        try { d0 = JSON.parse(parts[0] || 'null'); } catch (e) {}
        var detail = (d0 && d0.data && d0.data.movie) || null;
        var m = detail || movie;

        var stills = [];
        if (detail && Array.isArray(detail.preview_images)) {
          detail.preview_images.forEach(function (img) {
            var u = img && (img.large_url || img.thumb_url);
            if (u && stills.indexOf(u) < 0) stills.push(u);
          });
        }
        var cover = String(firstOf(m, ['cover_url', 'thumb_url']) || '');
        if (!stills.length && cover) stills.push(cover);

        var reviews = [];
        if (parts[1]) {
          try {
            var rvBody = JSON.parse(parts[1]);
            var rl = (rvBody && rvBody.data && rvBody.data.reviews) || [];
            (Array.isArray(rl) ? rl : []).forEach(function (rv) {
              var content = String(rv && rv.content || '').trim();
              if (!content) return;
              reviews.push({
                user: String(rv.username || '匿名'),
                date: rv.created_at ? String(rv.created_at).slice(0, 10) : '',
                content: content,
                score: (typeof rv.score === 'number' && rv.score > 0) ? rv.score : 0
              });
            });
          } catch (e) {}
        }
        var related = [];
        if (parts[2]) {
          try {
            var relBody = JSON.parse(parts[2]);
            var lists = (relBody && relBody.data && relBody.data.lists) || [];
            (Array.isArray(lists) ? lists : []).forEach(function (it) {
              if (!it || !it.id) return;
              related.push({
                id: String(it.id),
                name: String(it.name || '未命名影单').trim(),
                movieCount: Number(it.movies_count || 0),
                shareUrl: 'https://javdb.com/lists/' + encodeURIComponent(String(it.id))
              });
            });
          } catch (e) {}
        }

        return {
          id: String(movie.id),
          number: String(firstOf(m, ['number']) || nq),
          title: String(firstOf(m, ['title', 'origin_title', 'name']) || nq),
          cover: cover,
          score: jackpotScore(firstOf(m, ['score', 'rating'])),
          actors: parseActors(detail && detail.actors || m.actors),
          date: String(firstOf(m, ['date', 'release_date', 'upload_date', 'movie_date']) || ''),
          maker: String(firstOf(m, ['maker', 'studio', 'maker_name', 'label']) || ''),
          stills: stills,
          reviews: reviews,
          related: related
        };
      })
      .catch(function (e) {
        return {
          __error: true,
          message: 'JavDB 暂不可用：' + String((e && e.message) || e || '未知错误') + '（可能是网络、CORS 代理或签名已轮换）'
        };
      });
  }

  /* ---------------------------------------------------------- 4. JavRanking */
  function javRanking(code) {
    var c = norm(code);
    if (!c) return Promise.resolve({ ok: false });
    var url = apiBase() + '/api/ranking?code=' + encodeURIComponent(c);
    return fetchJson(url, {}, 12000).catch(function () { return { ok: false }; });
  }
  function javRankingTop(mode, offset, limit) {
    var m = (mode === 'random') ? 'random' : 'top';
    var off = Math.max(0, Number(offset) || 0);
    var lim = Math.max(1, Math.min(48, Number(limit) || 24));
    var url = apiBase() + '/api/ranking/top?mode=' + m + '&offset=' + off + '&limit=' + lim;
    return fetchJson(url, {}, 15000).catch(function () {
      return { ok: false, mode: m, offset: off, limit: lim, items: [] };
    });
  }

  /* --------------------------------------------------------------- 5. 冲码 */
  function chong(code, action) {
    var c = norm(code);
    if (!c) return Promise.resolve({ ok: false, message: '番号无效' });
    var act = String(action || 'check').toLowerCase();
    var url, opts, timeout;
    if (act === 'sync') {
      // 注意路由：自家 Worker 的同步端点是 POST /api/chong/sync，code 在 body 里。
      url = apiBase() + '/api/chong/sync';
      opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: { code: c }
      };
      timeout = 15000;
    } else {
      url = apiBase() + '/api/chong?code=' + encodeURIComponent(c);
      opts = { headers: { 'Accept': 'application/json' } };
      timeout = 10000;
    }
    return fetchJson(url, opts, timeout).catch(function (e) {
      return { ok: false, message: '冲码接口暂不可用：' + String((e && e.message) || e || '未知错误') };
    });
  }

  /* ------------------------------------------------------------- style hook */
  /* 只在文件里补 ag-* 的少量样式；已存在的 .ag-hero/.ag-site/.ag-ltx 等沿用 app.css */
  function injectStyles() {
    if (document.getElementById('agSearchStyles')) return;
    var css = [
      '.ag-code{color:var(--accent);font-weight:700}',
      '.ag-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.ag-status{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:var(--mute);min-width:62px}',
      '.ag-status.verify,.ag-status.manual{color:#ffb454}',
      '.ag-status.ok{color:var(--ok)}',
      '.ag-status.none{color:var(--danger)}',
      '.ag-status.loading{color:var(--mute)}',
      '.ag-ltx-sub{color:var(--ok);font-size:.7rem;margin-top:4px}',
      '.ag-jd-body{padding:4px 0}.ag-jd-top{display:flex;gap:12px;align-items:flex-start}',
      '.ag-jd-cover{width:96px;border-radius:10px;background:var(--bg3);flex:none}',
      '.ag-jd-meta{font-size:.82rem;line-height:1.7;color:var(--mute);min-width:0}',
      '.ag-jd-meta b{color:var(--fg)}.ag-jd-stills{display:flex;gap:6px;overflow-x:auto;margin-top:10px}',
      '.ag-jd-stills img{width:74px;height:104px;object-fit:cover;border-radius:8px;flex:none}',
      '.ag-jd-note{color:var(--mute);font-size:.8rem;line-height:1.6}',
      '.ag-rank{display:inline-flex;align-items:center;gap:6px;margin-top:7px;font-size:.74rem;',
      'padding:3px 9px;border-radius:8px;background:rgba(123,92,255,.16);color:#c9b8ff}',
      '.ag-ltxbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
      '.ag-ltxbar input{flex:1;min-width:150px;height:38px;border-radius:10px;border:1px solid var(--line);',
      'background:var(--bg3);padding:0 11px;outline:none}.ag-ltxbar input:focus{border-color:var(--accent)}',
      '.ag-ltxbar select{height:38px;border-radius:10px;border:1px solid var(--line);background:var(--card);padding:0 8px}',
      '.ag-pager{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px;color:var(--mute);font-size:.8rem}',
      '.ag-detail-top{display:flex;gap:14px}.ag-detail-cover{width:120px;border-radius:12px;flex:none;background:var(--bg3)}',
      '.ag-detail-meta{font-size:.84rem;line-height:1.8;min-width:0}.ag-detail-meta .big{font-size:1rem;font-weight:700;color:var(--fg)}',
      '.ag-linkbox{width:100%;height:64px;resize:none;margin-top:8px;border-radius:10px;border:1px solid var(--line);',
      'background:var(--bg3);padding:8px;font-size:.7rem;word-break:break-all;color:var(--mute)}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'agSearchStyles';
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------- shared LTX utils */
  function rowObject(r) {
    return {
      code: String(r[0] || ''), title: String(r[1] || ''),
      actors: Array.isArray(r[2]) ? r[2].slice() : (r[2] ? [String(r[2])] : []),
      date: String(r[3] || ''), maker: String(r[4] || ''), cover: String(r[5] || ''),
      score: Number(r[6]) || 0, votes: Number(r[7]) || 0,
      subtitle: String(r[8] || ''), link: String(r[9] || ''),
      size: Number(r[10]) || 0, linkName: String(r[11] || ''), pending: Number(r[12]) || 0
    };
  }
  function linkType(link) {
    var s = String(link || '').trim().toLowerCase();
    if (s.indexOf('ed2k://') === 0) return '电驴';
    if (s.indexOf('magnet:?') === 0) return '磁力';
    return '';
  }
  function isPlayable(link) {
    return /^https?:\/\//i.test(String(link || '')) || /\.m3u8(\?|$)/i.test(String(link || ''));
  }

  function loadSubtitle(row) {
    if (!row.subtitle) { toast('该条目没有字幕直链'); return; }
    var av = A();
    ['loadSubtitle', 'setSubtitle', 'addSubtitle'].some(function (fn) {
      if (av.Player && typeof av.Player[fn] === 'function') {
        try { av.Player[fn](row.subtitle); toast('字幕已提交给播放器'); return true; } catch (e) {}
      }
      if (window.Player && typeof window.Player[fn] === 'function') {
        try { window.Player[fn](row.subtitle); toast('字幕已提交给播放器'); return true; } catch (e) {}
      }
      return false;
    }) || openExternal(row.subtitle);
  }

  function showLinkModal(row) {
    var body = el('div', 'ag-detail');
    var type = linkType(row.link) || '下载链接';
    body.appendChild(el('p', 'ag-jd-note', '该条目不是 http/m3u8 直链，无法在内置播放器里直接播放。可复制 ' + esc(type) + ' 链接到下载工具：'));
    var ta = el('textarea', 'ag-linkbox');
    ta.value = row.link;
    ta.readOnly = true;
    body.appendChild(ta);
    var row2 = el('div', 'modal-actions');
    var bCopy = el('button', 'btn primary', '复制链接');
    var bHelper = el('button', 'btn', '在线播放助手');
    var bClose = el('button', 'btn ghost', '关闭');
    row2.appendChild(bClose); row2.appendChild(bHelper); row2.appendChild(bCopy);
    body.appendChild(row2);
    var m = modal(row.code + ' · ' + type, body, { wide: true });
    bCopy.addEventListener('click', function () { copyText(row.link); });
    bHelper.addEventListener('click', function () {
      if (window.Extra && window.Extra.ed2k) window.Extra.ed2k(row.link);
    });
    bClose.addEventListener('click', function () { if (m) m.hide(); });
  }

  function playLtx(row) {
    if (isPlayable(row.link)) {
      var p = window.Player;
      if (p && typeof p.play === 'function') {
        try {
          p.play(row.link, {
            code: row.code, title: row.title, cover: row.cover,
            subtitle: row.subtitle, size: row.size, linkName: row.linkName
          });
          return;
        } catch (e) { /* 落到外部打开 */ }
      }
      openExternal(row.link);
      return;
    }
    showLinkModal(row);
  }

  function openLtxDetail(row) {
    var body = el('div', 'ag-detail');
    var top = el('div', 'ag-detail-top');
    var img = el('img', 'ag-detail-cover');
    img.src = row.cover; img.alt = ''; img.loading = 'lazy';
    top.appendChild(img);
    var meta = el('div', 'ag-detail-meta');
    meta.innerHTML =
      '<div class="big">' + esc(row.title) + '</div>' +
      '<div>番号：' + esc(row.code) + '</div>' +
      '<div>评分：★ ' + esc(row.score) + ' <span class="ag-jd-note">(' + esc(row.votes) + ' 票)</span></div>' +
      '<div>演员：' + esc(row.actors.length ? row.actors.join(' / ') : '—') + '</div>' +
      '<div>发行：' + esc(row.date || '—') + ' · ' + esc(row.maker || '—') + '</div>' +
      '<div>大小：' + esc(fmtSize(row.size)) + '</div>';
    top.appendChild(meta);
    body.appendChild(top);

    var actions = el('div', 'ag-actions');
    var bPlay = el('button', 'btn primary', '去播放');
    bPlay.addEventListener('click', function () { playLtx(row); });
    actions.appendChild(bPlay);
    if (row.subtitle) {
      var bSub = el('button', 'btn', '加载字幕');
      bSub.addEventListener('click', function () { loadSubtitle(row); });
      actions.appendChild(bSub);
    }
    var type = linkType(row.link);
    if (type) {
      var bCopy = el('button', 'btn ghost', '复制' + type + '链接');
      bCopy.addEventListener('click', function () { copyText(row.link); });
      actions.appendChild(bCopy);
      var bHelper = el('button', 'btn ghost', '在线播放助手');
      bHelper.addEventListener('click', function () {
        if (window.Extra && window.Extra.ed2k) window.Extra.ed2k(row.link);
      });
      actions.appendChild(bHelper);
    }
    body.appendChild(actions);

    if (type) {
      var ta = el('textarea', 'ag-linkbox');
      ta.value = row.link; ta.readOnly = true;
      body.appendChild(ta);
    }
    var m = modal(row.code + ' · 详情', body, { wide: true });
    return m;
  }

  /* --------------------------------------- 6. renderAggregate（聚合搜索页） */
  var GROUP_LABEL = {
    play: '在线播放', lib: '番号资料', magnet: '磁力 / 论坛', sub: '字幕 / 社群'
  };

  function setProbe(card, elDot, elTxt, statusMap, siteId, key, text) {
    statusMap[siteId] = key; // 供“仅打开有结果”使用；只有真正 ok 才算
    elDot.className = 'statusdot' + (key === 'ok' ? ' ok' : (key === 'none' ? ' err' : ''));
    elTxt.textContent = text;
    card.querySelector('.ag-status').className = 'ag-status ' + key;
  }

  function probeSite(site, url, query, card, dot, txt, statusMap) {
    if (url.indexOf('{q}') >= 0 || !query) {
      // 没有查询占位符（如 ltxlib 首页）时，抓取没有可比性，不假装判断。
      setProbe(card, dot, txt, statusMap, site.id, 'manual', '需手动打开');
      return;
    }
    setProbe(card, dot, txt, statusMap, site.id, 'loading', '抓取中…');
    fetchText(url, { headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' } }, 9000)
      .then(function (html) {
        var h = String(html || '');
        if (/driver-verify|验证码|captcha|cloudflare|access denied|just a moment|所在地區年齡檢測|forbidden|<title>\s*403/i.test(h) || h.length < 120) {
          setProbe(card, dot, txt, statusMap, site.id, 'verify', '需验证');
          return;
        }
        // 唯一可信的“有结果”信号：页面 HTML 里确实出现了所搜番号
        var hit = h.toLowerCase().indexOf(query.toLowerCase()) >= 0 ||
          h.toLowerCase().indexOf(query.replace(/[-_]/g, '').toLowerCase()) >= 0;
        setProbe(card, dot, txt, statusMap, site.id, hit ? 'ok' : 'none', hit ? '有结果' : '无结果');
      })
      .catch(function () {
        // 代理/CORS 失败时不猜结果，明确告诉用户手动打开
        setProbe(card, dot, txt, statusMap, site.id, 'manual', '需手动打开');
      });
  }

  function renderAggregate(container, code, opts) {
    injectStyles();
    var root = (typeof container === 'string') ? $(container) : container;
    if (!root) return;
    opts = opts || {};
    var query = String(code == null ? '' : code).trim();
    var sites = (D().sites || []).slice();
    var state = { group: opts.group || 'all', status: Object.create(null) };
    var groups = (D().groups || GROUP_LABEL);
    var ltxLimit = opts.ltxLimit || 12;
    root.innerHTML = '';

    /* hero + JavRanking 角标 */
    var hero = el('div', 'ag-hero');
    hero.innerHTML =
      '<h2>聚合搜索 · <span class="ag-code">' + esc(query || '—') + '</span></h2>' +
      '<div class="stats">共 ' + sites.length + ' 个站点 · LTX 库 ' + (window.AV_LTX || []).length + ' 部（本地离线）</div>';
    var rank = el('span', 'ag-rank', '榜单：查询中…');
    hero.appendChild(rank);
    root.appendChild(hero);
    javRanking(query).then(function (d) {
      if (!d || !d.ok || !d.ranked) { rank.textContent = '榜单：暂无数据'; return; }
      rank.textContent = '榜单 #' + (d.rank || '—') + (d.score ? ' · ' + d.score + ' 分' : '');
    });

    /* 本地 LTX 命中区（killer offline feature，置顶） */
    var hits = ltx(query, ltxLimit);
    if (hits.length) {
      var lsec = el('div', 'ag-section');
      lsec.innerHTML = '<div class="sec-title"><span class="badge ltx">LTX 本地</span> 离线命中 <span class="cnt">' + hits.length + ' 条</span></div>';
      var lgrid = el('div', 'ag-ltx-grid');
      hits.forEach(function (r) {
        var c = el('div', 'card ag-ltx-card');
        c.innerHTML =
          '<img class="cover" loading="lazy" src="' + esc(r.cover) + '" alt="">' +
          '<div class="body"><div class="t">' + esc(r.title) + '</div>' +
          '<div class="m"><span>' + esc(r.code) + '</span><span>★ ' + esc(r.score) + '</span></div>' +
          (r.subtitle ? '<div class="ag-ltx-sub">✓ 字幕直链</div>' : '') +
          '</div>';
        var b = el('button', 'btn small primary ag-ltx-play', '播放/下载');
        b.style.width = 'calc(100% - 18px)';
        b.style.margin = '0 9px 9px';
        b.addEventListener('click', function () { playLtx(r); });
        c.appendChild(b);
        c.addEventListener('click', function (e) {
          if (!e.target.closest('button')) openLtxDetail(r);
        });
        lgrid.appendChild(c);
      });
      lsec.appendChild(lgrid);
      root.appendChild(lsec);
    }

    /* JavDB 区（异步，失败显示真实原因） */
    var jsec = el('div', 'ag-section');
    var jstate = el('span', 'cnt', '加载中…');
    var jhead = el('div', 'sec-title');
    jhead.appendChild(document.createTextNode('JavDB 详情 '));
    jhead.appendChild(jstate);
    jsec.appendChild(jhead);
    var jbody = el('div', 'ag-jd-body');
    jsec.appendChild(jbody);
    root.appendChild(jsec);
    javdb(query).then(function (d) {
      if (!d || d.__error) {
        jstate.textContent = '不可用';
        jbody.innerHTML = '<div class="ag-jd-note">' + esc((d && d.message) || 'JavDB 暂不可用') + '</div>';
        return;
      }
      jstate.textContent = d.id ? 'ID ' + esc(d.id) : '';
      var top = el('div', 'ag-jd-top');
      if (d.cover) {
        var im = el('img', 'ag-jd-cover');
        im.src = d.cover; im.alt = ''; im.loading = 'lazy';
        top.appendChild(im);
      }
      var meta = el('div', 'ag-jd-meta');
      meta.innerHTML =
        '<div class="big">' + esc(d.title) + '</div>' +
        '<div>番号 <b>' + esc(d.number) + '</b>' + (d.score ? ' · 评分 <b>' + esc(d.score) + '</b>' : '') + '</div>' +
        '<div>演员：' + esc(d.actors.length ? d.actors.join(' / ') : '—') + '</div>' +
        '<div>发行：' + esc(d.date || '—') + ' · 制作：' + esc(d.maker || '—') + '</div>' +
        '<div>剧照 ' + d.stills.length + ' 张 · 影评 ' + d.reviews.length + ' 条 · 相关影单 ' + d.related.length + ' 个</div>';
      top.appendChild(meta);
      jbody.appendChild(top);
      if (d.stills.length) {
        var strip = el('div', 'ag-jd-stills');
        d.stills.slice(0, 12).forEach(function (u) {
          var s = el('img'); s.src = u; s.alt = ''; s.loading = 'lazy';
          strip.appendChild(s);
        });
        jbody.appendChild(strip);
      }
    });

    /* 工具栏：分组筛选 + 打开按钮 */
    var bar = el('div', 'ag-hero');
    var chips = el('div', 'chips');
    var defs = [{ k: 'all', label: '全部' }].concat(['play', 'lib', 'magnet', 'sub'].map(function (k) {
      return { k: k, label: (groups[k] || GROUP_LABEL[k] || k) };
    }));
    var chipEls = {};
    defs.forEach(function (d) {
      var b = el('button', 'chip' + (state.group === d.k ? ' on' : ''), d.label);
      b.setAttribute('aria-pressed', state.group === d.k ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.group = d.k;
        defs.forEach(function (x) {
          chipEls[x.k].classList.toggle('on', x.k === d.k);
          chipEls[x.k].setAttribute('aria-pressed', x.k === d.k ? 'true' : 'false');
        });
        renderSites();
      });
      chipEls[d.k] = b;
      chips.appendChild(b);
    });
    bar.appendChild(chips);
    var count = el('div', 'stats');
    count.style.marginTop = '8px';
    bar.appendChild(count);
    var actions = el('div', 'ag-actions');
    var bAll = el('button', 'btn small primary', '全部打开');
    var bHit = el('button', 'btn small', '仅打开有结果');
    actions.appendChild(bAll); actions.appendChild(bHit);
    bar.appendChild(actions);
    root.appendChild(bar);

    var listBox = el('div', 'list');
    root.appendChild(listBox);

    function filtered() {
      return state.group === 'all' ? sites : sites.filter(function (s) { return s.group === state.group; });
    }

    function renderSites() {
      var list = filtered();
      count.textContent = '当前显示 ' + list.length + ' / ' + sites.length + ' 个站点（点“试抓取”验证是否有结果，失败不猜）';
      listBox.innerHTML = '';
      if (!query) {
        listBox.appendChild(el('div', 'empty', '输入番号后即可在这里看到全站聚合入口'));
        return;
      }
      list.forEach(function (site) {
        var g = site.group || 'play';
        var url = siteUrl(site, query);
        var card = el('div', 'ag-site li');
        card.innerHTML =
          '<span class="badge ' + esc(g) + '">' + esc(groups[g] || GROUP_LABEL[g] || g) + '</span>' +
          '<div class="grow"><div class="t">' + esc(site.name || site.id) + '</div>' +
          '<div class="host">' + esc(site.host || '') + '</div></div>';
        var bOpen = el('button', 'btn small primary ag-open', '打开');
        bOpen.addEventListener('click', function () { openExternal(url); });
        card.appendChild(bOpen);
        var bProbe = el('button', 'btn small ghost ag-probe', '试抓取');
        card.appendChild(bProbe);
        var st = el('span', 'ag-status');
        var dot = el('i', 'statusdot');
        var txt = el('span', '', '');
        st.appendChild(dot); st.appendChild(txt);
        card.appendChild(st);
        bProbe.addEventListener('click', function () { probeSite(site, url, query, card, dot, txt, state.status); });
        listBox.appendChild(card);
      });
    }

    bAll.addEventListener('click', function () {
      filtered().forEach(function (s) { openExternal(siteUrl(s, query)); });
      toast('已尝试打开 ' + filtered().length + ' 个站点');
    });
    bHit.addEventListener('click', function () {
      var ok = filtered().filter(function (s) { return state.status[s.id] === 'ok'; });
      if (!ok.length) { toast('还没有站点被确认“有结果”，请先点“试抓取”'); return; }
      ok.forEach(function (s) { openExternal(siteUrl(s, query)); });
      toast('已打开 ' + ok.length + ' 个有结果站点');
    });

    renderSites();
  }

  /* --------------------------------------------- 7. renderLtxBrowser（离线库） */
  var PAGE_SIZE = 60;

  function normalizeFilter(filter) {
    if (typeof filter === 'string') return { q: filter, sort: 'score' };
    filter = filter || {};
    return {
      q: filter.q != null ? filter.q : (filter.query != null ? filter.query : ''),
      sort: filter.sort || 'score'
    };
  }

  function renderLtxBrowser(container, filter, page) {
    injectStyles();
    var root = (typeof container === 'string') ? $(container) : container;
    if (!root) return;
    var f = normalizeFilter(filter);
    var old = root.__ltxState || {};
    var state = {
      q: (f.q != null && f.q !== '') ? String(f.q) : (old.q || ''),
      sort: f.sort || old.sort || 'score',
      page: Math.max(1, Number(page) || old.page || 1),
      shell: null, timer: null
    };
    // 显式换容器时重建骨架
    if (old.shell && old.shell.root !== root) state.shell = null;
    root.__ltxState = state;

    function buildShell() {
      root.innerHTML = '';
      var bar = el('div', 'ag-ltxbar');
      var input = el('input');
      input.type = 'search';
      input.placeholder = '搜番号 / 标题 / 演员…';
      input.value = state.q;
      var sort = el('select');
      [['score', '按评分'], ['date', '按发行日期']].forEach(function (o) {
        var op = el('option', '', o[1]); op.value = o[0]; sort.appendChild(op);
      });
      sort.value = state.sort;
      var info = el('span', 'cnt', '');
      bar.appendChild(input); bar.appendChild(sort); bar.appendChild(info);
      root.appendChild(bar);
      var grid = el('div', 'grid');
      root.appendChild(grid);
      var pager = el('div', 'ag-pager');
      root.appendChild(pager);
      state.shell = { root: root, input: input, sort: sort, info: info, grid: grid, pager: pager };

      input.addEventListener('input', function () {
        state.q = input.value; state.page = 1;
        clearTimeout(state.timer);
        state.timer = setTimeout(draw, 140);
      });
      sort.addEventListener('change', function () {
        state.sort = sort.value; state.page = 1; draw();
      });
    }

    function draw() {
      if (!state.shell || state.shell.root !== root) buildShell();
      var sh = state.shell;
      sh.input.value = state.q;
      sh.sort.value = state.sort;

      var q = state.q.trim().toLowerCase();
      var rows = window.AV_LTX || [];
      var found = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || !r[0]) continue;
        if (q) {
          var actors = Array.isArray(r[2]) ? r[2].join(' ') : String(r[2] || '');
          var hay = (String(r[0]) + ' ' + String(r[1] || '') + ' ' + actors + ' ' + String(r[4] || '')).toLowerCase();
          if (hay.indexOf(q) < 0) continue;
        }
        found.push(r);
      }
      found.sort(state.sort === 'date'
        ? function (a, b) { return String(b[3] || '').localeCompare(String(a[3] || '')); }
        : function (a, b) { return (Number(b[6]) || 0) - (Number(a[6]) || 0); });

      var pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      sh.info.textContent = found.length + ' 部 · ' + pages + ' 页';
      sh.grid.innerHTML = '';
      var start = (state.page - 1) * PAGE_SIZE;
      found.slice(start, start + PAGE_SIZE).forEach(function (r) {
        var card = el('div', 'card');
        card.innerHTML =
          '<img class="cover" loading="lazy" src="' + esc(r[5] || '') + '" alt="">' +
          '<div class="body"><div class="t">' + esc(r[1] || '') + '</div>' +
          '<div class="m"><span>' + esc(r[0] || '') + '</span><span>★ ' + esc(r[6] || 0) + '</span></div>' +
          (r[8] ? '<div class="ag-ltx-sub">✓ 字幕</div>' : '') +
          '</div>';
        card.addEventListener('click', function () { openLtxDetail(rowObject(r)); });
        sh.grid.appendChild(card);
      });
      if (!found.length) sh.grid.appendChild(el('div', 'empty', '离线库中没有匹配的条目'));

      sh.pager.innerHTML = '';
      var prev = el('button', 'btn small', '上一页');
      prev.disabled = state.page <= 1;
      prev.addEventListener('click', function () { state.page--; draw(); });
      var label = el('span', '', '第 ' + state.page + ' / ' + pages + ' 页');
      var next = el('button', 'btn small', '下一页');
      next.disabled = state.page >= pages;
      next.addEventListener('click', function () { state.page++; draw(); });
      sh.pager.appendChild(prev); sh.pager.appendChild(label); sh.pager.appendChild(next);
    }

    draw();
  }

  /* ------------------------------------------------------------------ export */
  window.Search = {
    siteUrl: siteUrl,
    ltx: ltx,
    javdb: javdb,
    javRanking: javRanking,
    javRankingTop: javRankingTop,
    chong: chong,
    renderAggregate: renderAggregate,
    renderLtxBrowser: renderLtxBrowser,
    // 非契约但便于调试：md5 仅供签名自查
    _md5: md5Hex
  };
})();
