/* AvPlay+ · core helpers & app state */
(function () {
  'use strict';

  var DEFAULT_SETTINGS = {
    theme: 'dark',
    accent: '#ffd54a',
    scale: 100,
    proxy: '',
    gateway: '',
    autoplay: false,
    adblock: true,
    gesture: true,
    pip: true,
    chineseFirst: true,
    ltxTop: true,
    xunleiLast: true,
    subtitleSize: 24,
    subtitleOffset: 0,
    subtitleSourcesOff: [],
    siteGroupsOn: { play: true, lib: true, magnet: true, sub: true }
  };

  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('avp_settings') || '{}') || {}; } catch (e) {}
    var s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      s[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULT_SETTINGS[k];
    });
    return s;
  }

  function normalizeCode(s) {
    var id = String(s == null ? '' : s).trim();
    if (!id) return '';
    if (/^https?:\/\//i.test(id) || id.indexOf('/') >= 0) {
      try {
        var parts = id.split('?')[0].split('#')[0].split('/').filter(Boolean);
        if (parts.length) id = decodeURIComponent(parts[parts.length - 1]);
      } catch (e) {}
    }
    try { id = decodeURIComponent(id); } catch (e) {}
    id = id.replace(/[-_](?:uncensored|hd|720p|1080p|4k|ch|eng|sub|cn|zh|tw|kr|jp|fc2|ppv)$/ig, '');
    var fc2 = id.match(/^(fc2(?:-ppv)?-[0-9]+)/i);
    if (fc2) return fc2[1].toUpperCase();
    var std = id.match(/^([a-z0-9]+-[a-z0-9]+)/i);
    if (std) return std[1].toUpperCase();
    return id.toUpperCase();
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (!n) return '—';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, type) {
    var box = document.getElementById('toastBox');
    if (!box) return;
    var t = el('div', 'toast ' + (type || ''), esc(msg));
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 350); }, 3200);
  }

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('avp_' + k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('avp_' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('avp_' + k); } catch (e) {} }
  };

  function proxyUrl(url) {
    try {
      var p = String((window.AV_SETTINGS && window.AV_SETTINGS.proxy) || '').trim();
      if (!p) return url;
      if (p.indexOf('{url}') >= 0) return p.replace('{url}', encodeURIComponent(url));
      return p + encodeURIComponent(url);
    } catch (e) { return url; }
  }

  function openExternal(url) {
    if (!url) return;
    var w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请长按复制'); }
    ta.remove();
  }

  function modal(title, contentNode, opts) {
    opts = opts || {};
    var root = document.getElementById('modalRoot');
    if (!root) return null;
    root.innerHTML = '';
    var mask = el('div', 'modal-mask');
    var box = el('div', 'modal' + (opts.wide ? ' wide' : ''));
    var head = el('div', 'modal-head');
    head.appendChild(el('span', 'modal-title', esc(title)));
    var close = el('button', 'modal-x', '×');
    head.appendChild(close);
    box.appendChild(head);
    var body = el('div', 'modal-body');
    if (typeof contentNode === 'string') body.innerHTML = contentNode;
    else if (contentNode) body.appendChild(contentNode);
    box.appendChild(body);
    mask.appendChild(box);
    root.appendChild(mask);
    function hide() { mask.remove(); }
    close.addEventListener('click', hide);
    mask.addEventListener('click', function (e) { if (e.target === mask) hide(); });
    root.__hide = hide;
    return { hide: hide, body: body, box: box };
  }

  function confirmBox(msg, onYes) {
    var n = el('div');
    n.appendChild(el('p', '', esc(msg)));
    var row = el('div', 'modal-actions');
    var yes = el('button', 'btn primary', '确定');
    var no = el('button', 'btn ghost', '取消');
    row.appendChild(no); row.appendChild(yes);
    n.appendChild(row);
    var m = modal('确认', n);
    yes.addEventListener('click', function () { m.hide(); onYes && onYes(); });
    no.addEventListener('click', function () { m.hide(); });
  }

  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (e) { toast('下载失败：' + e.message, 'error'); }
  }

  function applySettings() {
    var s = window.AV_SETTINGS;
    document.documentElement.style.setProperty('--accent', s.accent || '#ffd54a');
    document.documentElement.style.fontSize = ((s.scale || 100) / 100) + 'rem';
    document.documentElement.setAttribute('data-theme', s.theme || 'dark');
    var ad = document.getElementById('adblockState');
    if (ad) ad.textContent = s.adblock ? '已开启' : '已关闭';
  }

  function saveSettings() {
    try { localStorage.setItem('avp_settings', JSON.stringify(window.AV_SETTINGS)); } catch (e) {}
    applySettings();
  }

  function favorites() { return store.get('favorites', []); }
  function toggleFavorite(item) {
    var list = favorites();
    var key = item.code || item.id || item.url;
    var i = list.findIndex(function (x) { return (x.code || x.id || x.url) === key; });
    if (i >= 0) { list.splice(i, 1); toast('已取消收藏'); }
    else { list.unshift(Object.assign({}, item, { ts: Date.now() })); toast('已收藏'); }
    store.set('favorites', list);
    return i < 0;
  }
  function history() { return store.get('history', []); }
  function addHistory(item) {
    if (!item) return;
    var key = item.code || item.url || item.title;
    var list = history().filter(function (x) { return (x.code || x.url || x.title) !== key; });
    list.unshift(Object.assign({}, item, { ts: Date.now() }));
    store.set('history', list.slice(0, 200));
  }

  var AV = {
    D: window.AV_DATA,
    LTX: window.AV_LTX || [],
    $: function (s, r) { return (r || document).querySelector(s); },
    $$: function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); },
    el: el,
    esc: esc,
    toast: toast,
    store: store,
    normalizeCode: normalizeCode,
    fmtSize: fmtSize,
    openExternal: openExternal,
    copy: copy,
    modal: modal,
    confirm: confirmBox,
    download: download,
    proxyUrl: proxyUrl,
    applySettings: applySettings,
    saveSettings: saveSettings,
    favorites: favorites,
    toggleFavorite: toggleFavorite,
    history: history,
    addHistory: addHistory,
    tabs: {},
    goto: function (tab, code) {
      if (window.App && window.App.show) window.App.show(tab, code);
    }
  };

  window.AV_SETTINGS = loadSettings();
  window.AV = AV;
  applySettings();
})();
