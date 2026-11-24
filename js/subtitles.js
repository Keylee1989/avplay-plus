/* AvPlay+ · 字幕模块 (subtitles.js)
 * 依赖（运行时由其它脚本提供，本文件绝不重新定义）：
 *   window.AV_DATA     = { subtitleSites:[...], srtIndex:[...], apis:{xunlei:"...{q}"}, ... }
 *   window.AV_LTX      = [[code,title,actors,date,maker,cover,score,votes,subtitleUrl,...], ...]
 *   window.AV_SETTINGS = { subtitleSourcesOff:[], proxy:"", subtitleOffset:0, subtitleSize:24, ... }
 *   window.AV          = { $, $$, el, esc, toast, store, normalizeCode, fmtSize, openExternal, proxyUrl, ... }
 *
 * 对外唯一接口：window.Subtitles（见文件末尾的导出对象）
 */
(function () {
  'use strict';

  /* ============================================================
     0. 环境封装 / 通用小工具
     ============================================================ */
  var FB = {
    $: function (s, r) { return (r || document).querySelector(s); },
    $$: function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); },
    el: function (tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; },
    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
    toast: function () {},
    store: { get: function (k, d) { return d; }, set: function () {}, del: function () {} },
    normalizeCode: function (s) { return String(s == null ? '' : s).trim().toUpperCase(); },
    fmtSize: function () { return ''; },
    openExternal: function (u) { window.open(u, '_blank', 'noopener,noreferrer'); },
    proxyUrl: function (u) { return u; }
  };

  function A() { return window.AV || FB; }
  function D() { return window.AV_DATA || {}; }
  function SET() { return window.AV_SETTINGS || {}; }
  function LTX() { return window.AV_LTX || []; }

  function esc(s) { try { return A().esc(s); } catch (e) { return FB.esc(s); } }
  function el(tag, cls, html) { try { return A().el(tag, cls, html); } catch (e) { return FB.el(tag, cls, html); } }
  function toast(msg, type) { try { A().toast(msg, type); } catch (e) { FB.toast(msg, type); } }
  function normCode(s) {
    try { return A().normalizeCode(s) || String(s == null ? '' : s).trim().toUpperCase(); }
    catch (e) { return FB.normalizeCode(s); }
  }
  function offset() { return Number(SET().subtitleOffset) || 0; }
  function fontSize() { return Number(SET().subtitleSize) || 24; }

  function sourceOff(id) {
    var off = SET().subtitleSourcesOff;
    return Array.isArray(off) && off.indexOf(id) >= 0;
  }
  function setSourceOff(id, off) {
    var arr = Array.isArray(SET().subtitleSourcesOff) ? SET().subtitleSourcesOff.slice() : [];
    var i = arr.indexOf(id);
    if (off && i < 0) arr.push(id);
    if (!off && i >= 0) arr.splice(i, 1);
    SET().subtitleSourcesOff = arr;
    try { if (A().saveSettings) A().saveSettings(); } catch (e) {}
  }

  // 统一的 RegExp.exec 收集器（避免老浏览器没有 String.prototype.matchAll）
  function reMatches(re, str) {
    var out = [], m, guard = 0;
    re.lastIndex = 0;
    while ((m = re.exec(str || '')) !== null) {
      out.push(m);
      if (++guard > 2000) break;
    }
    return out;
  }
  function flatten(arr) { return [].concat.apply([], arr); }
  function resolveUrl(rel, base) {
    try { return new URL(rel, base).href; } catch (e) { return String(rel); }
  }
  function humanError(err) {
    var msg = err && err.message ? String(err.message) : String(err || '未知错误');
    if (/abort/i.test(msg)) return '请求超时（6 秒）或已被取消';
    if (/failed to fetch|networkerror|load failed|typeerror/i.test(msg)) {
      return '网络 / CORS 被浏览器拦截，可在设置里配置 CORS 代理后重试';
    }
    return msg;
  }
  function assertNotChallenge(html) {
    if (/Attention Required!|Just a moment\.\.\.|cf-chl-|cf-turnstile|Access denied|Checking your browser|人机验证|请开启\s*JavaScript/i.test(html || '')) {
      throw new Error('站点触发人机验证 / 反爬拦截，请在浏览器打开来源站手动查找');
    }
  }

  /* ---- fetch：所有请求都经过 AV.proxyUrl，保证代理钩子生效 ---- */
  function fetchText(url, signal, accept) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前浏览器不支持 fetch，请使用现代浏览器'));
    var opts = { headers: { Accept: accept || 'text/plain, */*' } };
    if (signal) opts.signal = signal;
    return fetch(A().proxyUrl(url), opts).then(function (r) {
      if (!r.ok && !r.status) throw new TypeError('Failed to fetch'); // 不透明响应 = CORS 被拦截
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (r.statusText || ''));
      return r.text();
    });
  }
  function fetchBuffer(url, signal) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前浏览器不支持 fetch，请使用现代浏览器'));
    var opts = { headers: { Accept: 'text/plain, application/x-subrip, */*' } };
    if (signal) opts.signal = signal;
    return fetch(A().proxyUrl(url), opts).then(function (r) {
      if (!r.ok && !r.status) throw new TypeError('Failed to fetch'); // 不透明响应 = CORS 被拦截
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (r.statusText || ''));
      return r.arrayBuffer();
    });
  }
  // UTF-8 BOM / UTF-8 / GBK 解码（字幕文件常见 GBK）
  function decodeBytes(buf) {
    if (!buf) return '';
    var bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      bytes = bytes.subarray(3);
    }
    if (typeof TextDecoder === 'undefined') {
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(bytes); }
      catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }
  function allSettled(ps) {
    if (typeof Promise.allSettled === 'function') return Promise.allSettled(ps);
    return Promise.all(ps.map(function (p) {
      return Promise.resolve(p).then(
        function (v) { return { status: 'fulfilled', value: v }; },
        function (e) { return { status: 'rejected', reason: e }; }
      );
    }));
  }
  function abortCtrl() {
    if (typeof AbortController !== 'undefined') return new AbortController();
    return { signal: null, abort: function () {} };
  }

  /* ============================================================
     1. parseSRT —— SRT / VTT 解析
     ============================================================ */
  var TS_RE = /(\d{1,3}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}(?::\d{2})?[.,]\d{1,3})/;
  function tsToSec(ts) {
    var parts = String(ts).split(/[.,]/);
    var chunks = parts[0].split(':').map(Number);
    var sec = 0;
    for (var i = 0; i < chunks.length; i++) sec = sec * 60 + (chunks[i] || 0);
    var frac = parts[1] || '0';
    return sec + Number(frac) / Math.pow(10, frac.length);
  }
  function cleanCueText(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, '\n')      // <br> 转真换行
      .replace(/<[^>]*>/g, '')            // 去掉 <i>/<b>/<u>/<font color=...> 等标签，保留标签内文字
      .replace(/\\N/g, '\n')              // SRT 里的 \N 表示换行
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  function parseSRT(text) {
    if (!text) return [];
    var src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var cues = [], cur = null, skipping = false;
    function flush() {
      if (!cur) return;
      cur.text = cur.text.replace(/\s+$/, '').replace(/^\s+/, '');
      if (cur.text) cues.push(cur);
      cur = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (skipping) {
        if (line === '') skipping = false;   // NOTE / STYLE / REGION 块以空行结束
        continue;
      }
      if (/^WEBVTT\b/i.test(line)) continue; // VTT 头，仅跳过这一行
      if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
        flush();
        skipping = true;
        continue;
      }
      var m = TS_RE.exec(line);
      if (m) {
        flush();
        cur = { start: tsToSec(m[1]), end: tsToSec(m[2]), text: '' };
        continue;
      }
      if (!cur) continue;                    // 序号行 / VTT cue id / X-TIMESTAMP-MAP 等
      if (line === '') { flush(); continue; }
      cur.text += (cur.text ? '\n' : '') + cleanCueText(line);
    }
    flush();
    cues.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return cues;
  }

  /* ============================================================
     2. rank —— 与原脚本 rankSubtitleResults 完全一致
     ============================================================ */
  function matchesSubtitleCode(text, code) {
    var decoded = String(text == null ? '' : text);
    try { decoded = decodeURIComponent(decoded); } catch (e) {}
    var compact = decoded.replace(/[-_]/g, '').toUpperCase();
    var target = String(code || '').replace(/[-_\s]/g, '').toUpperCase()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Boolean(target) && new RegExp('(^|[^A-Z0-9])' + target + '(?![0-9])').test(compact);
  }
  // 站名本身就是中文（R3 字幕网 / 曲词和 / 伪射手网 / 迅雷…）
  function isZhSite(item) {
    var s = String((item && (item.source || item.src)) || '');
    if (/[\u4e00-\u9fff]/.test(s)) return true;
    return /subhd|assrt|\br3\b|javsub|jav\s*subtitled|jav\s*films|my\s*jav|javsubs|qucihe|zimuzimu|zimuku|a4k|subtitletrans/i.test(s);
  }
  function isChinese(item) {
    if (!item) return false;
    var lang = String(item.language || '');
    var name = String(item.name || '');
    var hay = lang + ' ' + name;
    if (/中文|简|繁|中英|chinese|chs|cht|chi(?![a-z])|zh(?:[-_]|$)/i.test(hay)) return true;
    if (!lang || /^(其他|other|unknown|)$/i.test(lang)) return isZhSite(item);
    return false;
  }
  function isXunlei(item) {
    if (!item) return false;
    var s = String((item.source || '') + ' ' + (item.src || '')).toLowerCase();
    return s.indexOf('迅雷') >= 0 || s.indexOf('xunlei') >= 0;
  }
  function rank(items, code) {
    var list = Array.isArray(items) ? items.slice() : [];
    return list.map(function (item) {
      var copy = Object.assign({}, item);
      copy.exactMatch = copy.exactMatch != null ? copy.exactMatch : matchesSubtitleCode(copy.name, code);
      return copy;
    }).sort(function (a, b) {
      // LTX 置顶 → 非迅雷优先 → 精确匹配 → 中文优先（与原脚本同序）
      return Number(b.ltx || 0) - Number(a.ltx || 0)
        || Number(isXunlei(a)) - Number(isXunlei(b))
        || Number(b.exactMatch) - Number(a.exactMatch)
        || Number(isChinese(b)) - Number(isChinese(a));
    });
  }

  /* ============================================================
     3. ltxHit —— 离线库命中
     ============================================================ */
  function ltxHit(code) {
    var target = normCode(code);
    if (!target) return null;
    var rows = LTX();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || normCode(row[0]) !== target) continue;
      var url = String(row[8] || '');
      if (!/\.srt(\?|#|$)/i.test(url)) return null;
      var name = String(row[11] || '') || (target + '.srt');
      return {
        url: url, name: name, language: '中文', source: 'LTX 直链', src: 'LTX 直链',
        description: 'LTX 离线库 · 中文字幕直达', ltx: true, exactMatch: true, code: target
      };
    }
    return null;
  }

  /* ============================================================
     4. search —— 四路并行 + LTX 命中 + 去重 + 排序
     ============================================================ */
  function searchXunlei(code, signal) {
    var tpl = String((D().apis && D().apis.xunlei) || '');
    if (!tpl) return Promise.reject(new Error('未配置迅雷字幕接口'));
    var url = tpl.replace(/\{q\}/g, encodeURIComponent(code));
    return fetchText(url, signal, 'application/json, text/plain, */*').then(function (text) {
      var payload;
      try { payload = JSON.parse(text); } catch (e) { throw new Error('迅雷接口返回的不是合法 JSON'); }
      if (!payload || payload.code !== 0 || !Array.isArray(payload.data)) throw new Error('迅雷字幕接口返回异常');
      return payload.data.filter(function (row) {
        return /\.srt/i.test(String(row.url || '')) && matchesSubtitleCode(String(row.name || ''), code);
      }).map(function (row) {
        var lang = String(row.language || '');
        return {
          url: String(row.url), name: String(row.name || '字幕'), language: lang,
          description: '迅雷字幕 · ' + lang, source: '迅雷字幕', src: '迅雷字幕'
        };
      });
    });
  }

  function subtitleCatLang(name) {
    // 顺序与原脚本一致：简中/繁中 → 中译 X → X 译中 → 单语
    var raw = String(name || '');
    if (/zh-cn|chs|simple|简体/i.test(raw)) return '简中';
    if (/zh-tw|cht|traditional|繁体/i.test(raw)) return '繁中';
    var zhTo = /(?:^|[._-])zh[_-]([a-z]{2})(?=[._-]|$)/i.exec(raw);
    if (zhTo) {
      var map = { en: '中译英', ar: '中译阿', ja: '中译日', ko: '中译韩', es: '中译西', fr: '中译法', de: '中译德', ru: '中译俄', pt: '中译葡', it: '中译意', th: '中译泰', vi: '中译越', id: '中译印尼', ms: '中译马来' };
      return map[zhTo[1].toLowerCase()] || ('中译' + zhTo[1].toUpperCase());
    }
    var toZh = /(?:^|[._-])([a-z]{2})[_-]zh(?=[._-]|$)/i.exec(raw);
    if (toZh) {
      var map2 = { en: '英译中', ja: '日译中', ko: '韩译中', ar: '阿译中', es: '西译中', fr: '法译中', de: '德译中', ru: '俄译中' };
      return map2[toZh[1].toLowerCase()] || (toZh[1].toUpperCase() + '译中');
    }
    if (/zh|chinese/i.test(raw)) return '中文';
    if (/en|eng|english/i.test(raw)) return '英文';
    if (/ja|jap|japanese/i.test(raw)) return '日文';
    return '其他';
  }
  var SC_BASE = 'https://www.subtitlecat.com/';
  function searchSubtitleCat(code, signal) {
    return fetchText(SC_BASE + 'index.php?search=' + encodeURIComponent(code), signal).then(function (html) {
      assertNotChallenge(html);
      var pages = reMatches(/href="([^"]*subs\/[^"]+\.html)"/gi, html).map(function (m) { return m[1]; });
      if (!pages.length) return [];
      var hit = pages.filter(function (p) { return matchesSubtitleCode(p, code); });
      var zhScore = function (p) { return /zh|chs|cht|chinese|%e4%b8%ad%e6%96%87|%e7%ae%80|%e7%b9%81/i.test(p) ? 1 : 0; };
      var top = (hit.length ? hit : pages).sort(function (a, b) { return zhScore(b) - zhScore(a); }).slice(0, 2);
      return allSettled(top.map(function (rel) {
        return fetchText(resolveUrl(rel, SC_BASE), signal).then(function (subHtml) {
          assertNotChallenge(subHtml);
          return reMatches(/href="(\/subs\/\d+\/([^"]+)\.srt)"/gi, subHtml).map(function (m) {
            var raw = decodeURIComponent(m[2]);
            var lang = subtitleCatLang(raw);
            return {
              url: resolveUrl(m[1], SC_BASE), name: raw + '.srt', language: lang,
              description: 'SubtitleCat · ' + lang, source: 'SubtitleCat', src: 'SubtitleCat',
              exactMatch: matchesSubtitleCode(rel, code)
            };
          });
        });
      })).then(function (settled) {
        return flatten(settled.filter(function (r) { return r.status === 'fulfilled'; }).map(function (r) { return r.value; }));
      });
    });
  }

  var AV_SUB_BASE = 'https://www.avsubtitles.com/';
  function searchAvSubtitles(code, signal) {
    return fetchText(AV_SUB_BASE + 'search_results.php?search=' + encodeURIComponent(code), signal).then(function (html) {
      assertNotChallenge(html);
      var seen = {}, links = [];
      reMatches(/href="(\/movie\d+\/[^"#]+)"/gi, html).forEach(function (m) {
        if (!seen[m[1]]) { seen[m[1]] = 1; links.push(m[1]); }
      });
      if (!links.length) return [];
      var movie = links.filter(function (l) { return matchesSubtitleCode(l, code); })[0] || links[0];
      return fetchText(resolveUrl(movie, AV_SUB_BASE), signal).then(function (page) {
        assertNotChallenge(page);
        return reMatches(/href="(\/movie\d+\/[^/]+\/subtitles\/([a-z]{2})\/(\d+))"/gi, page).map(function (m) {
          var lc = String(m[2]).toLowerCase();
          var lang = lc === 'zh' ? '中文' : lc === 'en' ? '英文' : lc === 'ja' ? '日文' : '其他';
          var slug = decodeURIComponent(movie.split('/').pop());
          return {
            url: resolveUrl(m[1], AV_SUB_BASE), name: '[' + slug + '] ' + lang + '字幕',
            language: lang, description: 'AVSubtitles · ' + lang,
            source: 'AVSubtitles', src: 'AVSubtitles', exactMatch: matchesSubtitleCode(movie, code)
          };
        });
      });
    });
  }

  // 直链索引站：用 BUILTIN_SUBTITLE_SITES 的 searchUrl 搜 .srt/.ass/.vtt/.zip
  function searchSrtLinks(site, code, signal) {
    if (!site) return Promise.resolve([]);
    var siteCode = normCode(code) || String(code || '').trim();
    if (!siteCode) return Promise.resolve([]);
    var searchUrl = String(site.searchUrl || '').replace(/\{id\}/g, encodeURIComponent(siteCode));
    var base = String(site.url || site.base || 'https://' + (site.host || '') + '/');
    return fetchText(searchUrl, signal).then(function (page) {
      assertNotChallenge(page);
      var seen = {}, items = [];
      var anchors = reMatches(/<a\b[^>]*href="([^"]+\.(?:srt|ass|vtt|zip))(?:\?[^"#]*)?"[^>]*>([\s\S]{0,160}?)<\/a>/gi, page);
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i][1].replace(/&amp;/g, '&');
        var abs = resolveUrl(href, base + '/');
        if (!/^https?:/i.test(abs) || seen[abs]) continue;
        var decoded = abs;
        try { decoded = decodeURIComponent(abs); } catch (e) {}
        var label = String(anchors[i][2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        var relevant = matchesSubtitleCode(decoded, siteCode) || matchesSubtitleCode(label, siteCode)
          || matchesSubtitleCode(anchors[i][0], siteCode);
        if (!relevant) continue;
        seen[abs] = 1;
        items.push({
          url: abs, name: label || decoded.split('/').pop() || '字幕文件',
          language: /zh|chs|cht|中文|简|繁/i.test(decoded + label) ? '中文' : '其他',
          description: site.name + ' · 直链', source: site.name, src: site.name, exactMatch: true
        });
        if (items.length >= 12) break;
      }
      return items;
    });
  }

  function search(code, onProgress) {
    var target = normCode(code) || String(code == null ? '' : code).trim();
    if (!target) return Promise.resolve([]);

    var all = [], errors = [], seen = {};
    function addItem(it) {
      if (!it || !it.url) return false;
      var key = String(it.url).toLowerCase();
      if (seen[key]) return false;
      seen[key] = 1;
      all.push(it);
      return true;
    }
    // LTX 离线命中置顶（同样受字幕源开关约束）
    if (!sourceOff('ltx')) {
      var ltx = ltxHit(target);
      if (ltx) addItem(ltx);
    }

    // 构造四路任务（每路独立 6s 超时，AbortController 贯穿该路所有请求）
    var tasks = [];
    function addTask(id, name, fn) {
      if (sourceOff(id)) return;
      var index = tasks.length;
      tasks.push(null);   // 占位，保证进度回调拿到稳定的序号
      var ctrl = abortCtrl();
      var timer = typeof setTimeout === 'function'
        ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
      var p = Promise.resolve().then(function () { return fn(ctrl.signal); }).then(
        function (items) { return { name: name, ok: true, items: items || [] }; },
        function (err) { return { name: name, ok: false, error: err }; }
      ).then(function (out) {
        if (timer) clearTimeout(timer);
        var added = 0;
        if (out.ok) out.items.forEach(function (it) { if (addItem(it)) added++; });
        else errors.push({ __error: true, source: name, message: humanError(out.error) });
        if (typeof onProgress === 'function') {
          try {
            onProgress({
              done: index + 1, total: tasks.length,
              source: name, count: all.length, sourceCount: added,
              error: out.ok ? null : humanError(out.error)
            });
          } catch (e) {}
        }
        return out;
      });
      tasks[index] = p;
    }

    addTask('xunlei', '迅雷字幕', function (signal) { return searchXunlei(target, signal); });
    addTask('subtitlecat', 'SubtitleCat', function (signal) { return searchSubtitleCat(target, signal); });
    addTask('avsubtitles', 'AVSubtitles', function (signal) { return searchAvSubtitles(target, signal); });

    var sites = D().subtitleSites || [];
    var idx = D().srtIndex || ['qucihe', 'javsubtitled', 'javfilms', 'avsubtitles', 'subtitlecat'];
    idx.forEach(function (id) {
      var site = sites.filter(function (s) { return s.id === id; })[0];
      if (!site) return;
      addTask(id, site.name || id, function (signal) { return searchSrtLinks(site, target, signal); });
    });

    if (!tasks.length && typeof onProgress === 'function') {
      try { onProgress({ done: 0, total: 0, source: '全部字幕源已关闭', count: all.length, error: null }); } catch (e) {}
    }

    return allSettled(tasks).then(function () {
      var ranked = rank(all, target);
      ranked.errors = errors;   // 失败源以错误标记返回，绝不伪造结果
      return ranked;
    });
  }

  /* ============================================================
     5. 字幕文本读取（缓存）、下载、序列化
     ============================================================ */
  var textCache = new Map();
  function getSubtitleText(url, fresh) {
    if (!fresh && textCache.has(url)) return Promise.resolve(textCache.get(url));
    return fetchBuffer(url).then(function (buf) {
      var text = decodeBytes(buf);
      if (textCache.size > 40) textCache.clear();
      textCache.set(url, text);
      return text;
    });
  }
  function triggerDownload(name, text, mime) {
    try {
      if (A().download) { A().download(name, text, mime); return; }
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var u = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = u; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 8000);
    } catch (e) { toast('下载失败：' + e.message, 'error'); }
  }
  function fileNameFrom(item) {
    var raw = String((item && item.name) || '');
    try { raw = decodeURIComponent(raw); } catch (e) {}
    var base = raw.split(/[\\/]/).pop().split('?')[0] || 'subtitle';
    if (!/\.(srt|vtt|ass|ssa|txt)$/i.test(base)) base += '.srt';
    return base.replace(/[<>:"|?*]/g, '_');
  }
  function fmtClock(sec, sep) {
    sec = Math.max(0, Number(sec) || 0);
    var ms = Math.round((sec % 1) * 1000);
    var total = Math.floor(sec);
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(h) + ':' + p(m) + ':' + p(s) + sep + (ms < 10 ? '00' : ms < 100 ? '0' : '') + ms;
  }
  function serialize(cues, format) {
    var f = String(format || 'srt').toLowerCase();
    var lines = [];
    if (f === 'vtt') lines.push('WEBVTT', '');
    cues.forEach(function (c, i) {
      if (f === 'txt') { lines.push(String(c.text).replace(/\n/g, ' / ')); return; }
      if (f === 'srt') lines.push(String(i + 1));
      lines.push(fmtClock(c.start, f === 'vtt' ? '.' : ',') + ' --> ' + fmtClock(c.end, f === 'vtt' ? '.' : ','));
      lines.push(String(c.text || ''));
      lines.push('');
    });
    return lines.join('\n');
  }

  /* ============================================================
     6. loadIntoPlayer / mount
     ============================================================ */
  function resolveVideo(target) {
    var video = null, wrapper = null;
    if (target && target.tagName === 'VIDEO') video = target;
    else if (target && target.video && target.video.tagName === 'VIDEO') video = target.video;
    else if (target && target.querySelector) video = target.querySelector('video');
    if (!video) video = document.querySelector('video');
    if (video) {
      wrapper = (target && target.querySelector && target.contains && target.contains(video))
        ? target
        : ((target && target.wrapper) || video.parentElement || video.parentNode);
      if (video.closest) {
        var stage = video.closest('.stage, .player-stage, [data-sub-wrapper]');
        if (stage) wrapper = stage;
      }
    }
    return { video: video, wrapper: wrapper };
  }
  function loadIntoPlayer(url, target) {
    if (!url) { toast('没有字幕地址', 'error'); return Promise.resolve(null); }
    return getSubtitleText(url, true).then(function (text) {
      var cues = parseSRT(text);
      if (!cues.length) throw new Error('字幕内容为空或无法识别（可能是压缩包 / 需登录页面）');
      Subtitles.current = cues;
      Subtitles.currentUrl = url;
      var v = resolveVideo(target);
      Subtitles.currentVideo = v.video;
      Subtitles.currentWrapper = v.wrapper;
      if (v.wrapper) mount(v.wrapper, cues);
      notify();
      toast('字幕已挂载 · ' + cues.length + ' 句', 'success');
      return cues;
    }).catch(function (e) {
      toast('字幕加载失败：' + humanError(e), 'error');
      return null;
    });
  }
  function notify() {
    try { document.dispatchEvent(new CustomEvent('subtitles:change')); } catch (e) {}
  }
  function findCue(cues, t) {
    for (var i = cues.length - 1; i >= 0; i--) {
      var c = cues[i];
      if (t >= c.start && t <= c.end) return c;
      if (c.end < t) break;    // cues 已按 start 排序
    }
    return null;
  }
  function mount(wrapper, cues) {
    if (!wrapper || !wrapper.appendChild) wrapper = Subtitles.currentWrapper;
    if (!wrapper) return null;
    if (!cues) cues = Subtitles.current || [];
    try { if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative'; } catch (e) {}

    // 清掉本模块之前的浮层（连同事件监听）
    Array.prototype.slice.call(wrapper.children).forEach(function (n) {
      if (n.classList && n.classList.contains('sub-overlay')) {
        if (typeof n.__destroy === 'function') n.__destroy();
        if (n.parentNode) n.parentNode.removeChild(n);
      }
    });
    var ov = el('div', 'sub-overlay');
    ov.setAttribute('aria-live', 'polite');
    wrapper.appendChild(ov);
    var video = wrapper.querySelector('video') || Subtitles.currentVideo || document.querySelector('video');
    function update() {
      if (!video) return;
      var t = (video.currentTime || 0) + offset();
      var cue = findCue(cues, t);
      var html = '';
      if (cue && cue.text) {
        html = String(cue.text).split('\n').map(function (line) {
          return '<span>' + esc(line) + '</span>';
        }).join('');
      }
      if (ov.__last !== html) { ov.innerHTML = html; ov.__last = html; }
      ov.style.fontSize = fontSize() + 'px';
      ov.style.display = html ? '' : 'none';
    }
    var events = ['timeupdate', 'seeked', 'loadedmetadata', 'play', 'ratechange'];
    events.forEach(function (evt) { if (video) video.addEventListener(evt, update); });
    ov.__destroy = function () {
      events.forEach(function (evt) { if (video) video.removeEventListener(evt, update); });
    };
    ov.__update = update;
    update();
    Subtitles.overlay = ov;
    return ov;
  }

  /* ============================================================
     7. exportCurrent / downloadResult
     ============================================================ */
  function exportCurrent(format) {
    var cues = Subtitles.current || [];
    var f = String(format || 'srt').toLowerCase();
    if (!cues.length) { toast('当前没有可导出的字幕', 'error'); return ''; }
    var text = serialize(cues, f);
    var mime = f === 'vtt' ? 'text/vtt;charset=utf-8'
      : f === 'txt' ? 'text/plain;charset=utf-8' : 'application/x-subrip;charset=utf-8';
    triggerDownload('subtitle.' + f, text, mime);
    return text;
  }
  function downloadResult(item) {
    if (!item || !item.url) { toast('没有可下载的字幕地址', 'error'); return Promise.resolve(); }
    return getSubtitleText(item.url, true).then(function (text) {
      var name = fileNameFrom(item);
      var mime = /\.vtt$/i.test(name) ? 'text/vtt;charset=utf-8'
        : /\.txt$/i.test(name) ? 'text/plain;charset=utf-8' : 'application/x-subrip;charset=utf-8';
      triggerDownload(name, text, mime);
      toast('已下载：' + name, 'success');
    }).catch(function (e) {
      toast('下载失败：' + humanError(e), 'error');
      throw e;
    });
  }

  /* ============================================================
     8. render —— 完整字幕面板
     ============================================================ */
  function ensureCss() {
    if (document.getElementById('subtitles-module-css')) return;
    var css = [
      '.sub-root{display:flex;flex-direction:column;gap:8px;font-size:13px}',
      '.sub-root input,.sub-root select,.sub-root textarea{background:var(--panel-2,#1e222b);border:1px solid var(--border,#2a2f3a);color:var(--text,#e6e8ec);border-radius:8px;padding:7px 9px;outline:none;max-width:100%;font:inherit}',
      '.sub-root input:focus,.sub-root select:focus{border-color:var(--accent,#4f8cff)}',
      '.sub-root button{border:1px solid var(--border,#2a2f3a);background:var(--panel-2,#1e222b);color:var(--text,#e6e8ec);border-radius:8px;padding:6px 11px;cursor:pointer;white-space:nowrap;font:inherit}',
      '.sub-root button:hover{border-color:var(--accent,#4f8cff)}',
      '.sub-root button.primary{background:var(--accent,#4f8cff);border-color:var(--accent,#4f8cff);color:#fff}',
      '.sub-root button:disabled{opacity:.5;cursor:default}',
      '.sub-bar,.sub-actions,.sub-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.sub-q{flex:1;min-width:140px}',
      '.sub-hint,.sub-muted{font-size:12px;color:var(--muted,#8b93a1)}',
      '.sub-err{font-size:12px;color:var(--danger,#e5534b)}',
      '.sub-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.sub-chip{border:1px solid var(--border,#2a2f3a);background:var(--panel-2,#1e222b);border-radius:999px;padding:3px 9px;font-size:11px;color:var(--muted,#8b93a1);cursor:pointer;user-select:none}',
      '.sub-chip b{font-weight:400;opacity:.8}.sub-chip.off{opacity:.4;text-decoration:line-through}',
      '.sub-chip[data-state="ok"]{border-color:var(--ok,#3fb27f);color:var(--ok,#3fb27f)}',
      '.sub-chip[data-state="error"]{border-color:var(--danger,#e5534b);color:var(--danger,#e5534b)}',
      '.sub-chip[data-state="loading"]{border-color:var(--accent,#4f8cff);color:var(--accent,#4f8cff)}',
      '.sub-results{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto}',
      '.sub-res{border:1px solid var(--border,#2a2f3a);border-radius:9px;background:var(--panel-2,#1e222b);padding:9px}',
      '.sub-res-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.sub-res .nm{font-weight:600;word-break:break-all;flex:1;min-width:120px}',
      '.sub-badge{font-size:10px;border:1px solid var(--border,#2a2f3a);border-radius:4px;padding:1px 5px;color:var(--muted,#8b93a1)}',
      '.sub-badge.ltx{color:var(--gold,#ffd54a);border-color:var(--gold,#ffd54a)}.sub-badge.lang{color:var(--accent,#4f8cff);border-color:var(--accent,#4f8cff)}',
      '.sub-meta{font-size:11px;color:var(--muted,#8b93a1);margin:4px 0 7px;word-break:break-all}',
      '.sub-preview{margin-top:7px;border-left:2px solid var(--accent,#4f8cff);padding-left:8px;font-size:12px;white-space:pre-wrap;color:var(--muted,#8b93a1)}',
      '.sub-sep{height:1px;background:var(--border,#2a2f3a);margin:2px 0}.sub-editor{display:flex;flex-direction:column;gap:6px}',
      '.sub-cue-list{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:5px}',
      '.sub-cue{display:flex;gap:6px;align-items:center}.sub-cue input{flex:1;min-width:0}',
      '.sub-cue .idx{font-size:11px;color:var(--muted,#8b93a1);width:24px;flex:none}',
      '.sub-cue .tm{font-size:11px;color:var(--muted,#8b93a1);width:104px;flex:none;font-family:monospace}',
      '.sub-overlay{position:absolute;left:5%;right:5%;bottom:9%;z-index:9;text-align:center;pointer-events:none;color:#fff;line-height:1.35;text-shadow:0 1px 3px #000,0 0 8px #000}',
      '.sub-overlay span{background:rgba(0,0,0,.5);padding:2px 8px;border-radius:5px;display:inline-block;margin:1px 0}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'subtitles-module-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function sourceList() {
    var out = [
      { id: 'ltx', name: 'LTX 直链' },
      { id: 'xunlei', name: '迅雷字幕' },
      { id: 'subtitlecat', name: 'SubtitleCat' },
      { id: 'avsubtitles', name: 'AVSubtitles' }
    ];
    (D().srtIndex || ['qucihe', 'javsubtitled', 'javfilms', 'avsubtitles', 'subtitlecat']).forEach(function (id) {
      if (out.some(function (s) { return s.id === id; })) return;
      var site = (D().subtitleSites || []).filter(function (s) { return s.id === id; })[0];
      out.push({ id: id, name: site ? site.name : id });
    });
    return out;
  }

  function render(container, code) {
    if (!container) return null;
    ensureCss();
    container.innerHTML = '';
    container.classList.add('sub-root');

    var st = { code: code || '', chips: [], results: [], destroyed: false };
    container.__subtitles = st;

    /* --- 搜索行 --- */
    var bar = el('div', 'sub-bar');
    var input = el('input', 'sub-q');
    input.type = 'text';
    input.value = st.code;
    input.placeholder = '番号 / 片名';
    input.spellcheck = false;
    var btn = el('button', 'primary', '搜索字幕');
    var hint = el('span', 'sub-hint', '');
    bar.appendChild(input); bar.appendChild(btn); bar.appendChild(hint);

    /* --- 来源状态 chips（点击可开关该源） --- */
    var chipsRow = el('div', 'sub-chips');
    sourceList().forEach(function (src) {
      var chip = el('span', 'sub-chip' + (sourceOff(src.id) ? ' off' : ''), '');
      chip.__name = src.name;
      chip.__id = src.id;
      chip.dataset.state = 'idle';
      chip.addEventListener('click', function () {
        var off = !sourceOff(src.id);
        setSourceOff(src.id, off);
        chip.classList.toggle('off', off);
        toast((off ? '已关闭' : '已开启') + src.name);
      });
      setChip(chip, 'idle', '待搜');
      chipsRow.appendChild(chip);
      st.chips.push(chip);
    });

    /* --- 结果列表 --- */
    var resultsBox = el('div', 'sub-results');

    /* --- 提示区 --- */
    var errorsBox = el('div', '');

    /* --- 当前字幕 / 编辑器 --- */
    var editor = el('div', 'sub-editor');
    var edHead = el('div', 'sub-row', '<b>字幕轨</b>');
    var edCount = el('span', 'sub-hint', '（0 句）');
    var edApply = el('button', '', '应用编辑');
    edHead.appendChild(edCount); edHead.appendChild(edApply);
    var cueList = el('div', 'sub-cue-list');
    editor.appendChild(edHead); editor.appendChild(cueList);

    /* --- 偏移控制 --- */
    var offRow = el('div', 'sub-row');
    offRow.appendChild(el('span', 'sub-hint', '时间偏移'));
    var offInput = el('input', '');
    offInput.type = 'number'; offInput.step = '0.1'; offInput.style.width = '76px';
    offInput.value = String(offset());
    var mkOff = function (label, delta) {
      var b = el('button', '', label);
      b.addEventListener('click', function () {
        var v = Math.round((Number(offInput.value || 0) + delta) * 100) / 100;
        offInput.value = String(v);
        applyOffset(v);
      });
      return b;
    };
    offRow.appendChild(mkOff('−', -1));
    offRow.appendChild(mkOff('−0.5', -0.5));
    offRow.appendChild(offInput);
    offRow.appendChild(mkOff('+0.5', 0.5));
    offRow.appendChild(mkOff('+', 1));
    var offNote = el('span', 'sub-hint', '秒（正数＝字幕提前）');
    offRow.appendChild(offNote);

    /* --- 字号 / 延迟设置 --- */
    var setRow = el('div', 'sub-row');
    setRow.appendChild(el('span', 'sub-hint', '字号'));
    var sizeInput = el('input', '');
    sizeInput.type = 'number'; sizeInput.min = '12'; sizeInput.max = '72'; sizeInput.style.width = '70px';
    sizeInput.value = String(fontSize());
    setRow.appendChild(sizeInput);
    setRow.appendChild(el('span', 'sub-hint', '延迟(秒)'));
    var delayInput = el('input', '');
    delayInput.type = 'number'; delayInput.step = '0.1'; delayInput.style.width = '76px';
    delayInput.value = String(offset());
    setRow.appendChild(delayInput);

    /* --- 导出 --- */
    var expRow = el('div', 'sub-row');
    expRow.appendChild(el('span', 'sub-hint', '导出'));
    var fmtSel = el('select', '');
    ['srt', 'vtt', 'txt'].forEach(function (f) {
      var o = el('option', '', f.toUpperCase()); o.value = f; fmtSel.appendChild(o);
    });
    var expBtn = el('button', '', '导出字幕');
    expRow.appendChild(fmtSel); expRow.appendChild(expBtn);

    container.appendChild(bar);
    container.appendChild(chipsRow);
    container.appendChild(resultsBox);
    container.appendChild(errorsBox);
    container.appendChild(el('div', 'sub-sep'));
    container.appendChild(editor);
    container.appendChild(offRow);
    container.appendChild(setRow);
    container.appendChild(expRow);

    function setChip(chip, state, label) {
      chip.dataset.state = state;
      chip.innerHTML = esc(chip.__name) + ' <b>' + esc(label) + '</b>';
    }
    function chipFor(name) {
      return st.chips.filter(function (c) { return c.__name === name; })[0] || null;
    }
    function applyOffset(v) {
      SET().subtitleOffset = Number(v) || 0;
      delayInput.value = String(SET().subtitleOffset);
      try { if (A().saveSettings) A().saveSettings(); } catch (e) {}
      if (Subtitles.current.length && Subtitles.currentWrapper) {
        mount(Subtitles.currentWrapper, Subtitles.current);
      }
    }
    function refreshCues() {
      var cues = Subtitles.current || [];
      edCount.textContent = '（' + cues.length + ' 句）';
      cueList.innerHTML = '';
      cues.forEach(function (c, i) {
        var row = el('div', 'sub-cue');
        row.appendChild(el('span', 'idx', String(i + 1)));
        row.appendChild(el('span', 'tm', fmtClock(c.start, ',').slice(3) + ' → ' + fmtClock(c.end, ',').slice(3)));
        var tin = el('input', '');
        tin.type = 'text'; tin.value = c.text;
        tin.addEventListener('input', function () { c.text = tin.value; });
        row.appendChild(tin);
        var del = el('button', '', '×');
        del.title = '删除本句';
        del.addEventListener('click', function () {
          Subtitles.current.splice(i, 1);
          refreshCues();
        });
        row.appendChild(del);
        cueList.appendChild(row);
      });
      if (!cues.length) cueList.appendChild(el('div', 'sub-muted', '搜索结果里点「挂载」后，句子会显示在这里，可直接编辑。'));
    }
    document.addEventListener('subtitles:change', refreshCues);
    st.destroy = function () {
      st.destroyed = true;
      document.removeEventListener('subtitles:change', refreshCues);
    };

    function preview(item, box) {
      box.style.display = 'block';
      box.textContent = '加载预览…';
      getSubtitleText(item.url).then(function (text) {
        var cs = parseSRT(text);
        box.textContent = cs.length
          ? cs.slice(0, 3).map(function (c) {
              return '[' + fmtClock(c.start, '.').slice(3) + '] ' + c.text.replace(/\n/g, ' / ');
            }).join('\n')
          : '未能解析出句子（可能是压缩包或需要登录的页面）';
      }).catch(function (e) { box.textContent = '预览失败：' + humanError(e); });
    }
    function renderResults(items, errs) {
      resultsBox.innerHTML = '';
      errorsBox.innerHTML = '';
      (errs || []).forEach(function (er) {
        errorsBox.appendChild(el('div', 'sub-err', '⚠ ' + esc(er.source) + '：' + esc(er.message)));
      });
      if (!items.length) {
        resultsBox.appendChild(el('div', 'sub-muted', errs && errs.length
          ? '所有来源都失败了。可配置 CORS 代理，或点来源 chip 关掉无效源后重试。'
          : '没搜到字幕。可换番号、关掉被拦截的源，或到来源站内手动翻一下。'));
        return;
      }
      items.forEach(function (item) {
        var row = el('div', 'sub-res');
        var top = el('div', 'sub-res-top');
        top.appendChild(el('span', 'sub-badge', esc(item.source || '字幕')));
        top.appendChild(el('span', 'nm', esc(item.name || '字幕文件')));
        if (item.language) top.appendChild(el('span', 'sub-badge lang', esc(item.language)));
        if (item.ltx) top.appendChild(el('span', 'sub-badge ltx', 'LTX 置顶'));
        if (item.exactMatch) top.appendChild(el('span', 'sub-badge', '精确'));
        row.appendChild(top);
        row.appendChild(el('div', 'sub-meta', esc(item.description || '') + ' · ' + esc(String(item.url || '').split('?')[0])));
        var actions = el('div', 'sub-actions');
        var bPrev = el('button', '', '预览');
        var bDl = el('button', '', '下载');
        var bMount = el('button', 'primary', '挂载');
        var box = el('div', 'sub-preview');
        box.style.display = 'none';
        bPrev.addEventListener('click', function () {
          if (box.style.display !== 'none') { box.style.display = 'none'; return; }
          preview(item, box);
        });
        bDl.addEventListener('click', function () { downloadResult(item); });
        bMount.addEventListener('click', function () {
          loadIntoPlayer(item.url, container.querySelector('video') || null);
        });
        actions.appendChild(bPrev); actions.appendChild(bDl); actions.appendChild(bMount);
        row.appendChild(actions); row.appendChild(box);
        resultsBox.appendChild(row);
      });
    }

    function doSearch() {
      var q = normCode(input.value) || String(input.value || '').trim();
      if (!q) { toast('先填番号或片名', 'error'); return; }
      st.code = q;
      input.value = q;
      btn.disabled = true;
      hint.textContent = '搜索中…';
      st.chips.forEach(function (c) { setChip(c, 'idle', '待搜'); });
      resultsBox.innerHTML = '<div class="sub-muted">正在并行搜索各字幕源…</div>';
      errorsBox.innerHTML = '';
      Subtitles.search(q, function (p) {
        if (st.destroyed) return;
        var chip = chipFor(p.source);
        if (chip) setChip(chip, p.error ? 'error' : 'ok', p.error ? '失败' : (p.sourceCount || 0) + ' 条');
        hint.textContent = '已完成 ' + p.done + '/' + p.total + ' · ' + p.count + ' 条';
      }).then(function (items) {
        if (st.destroyed) return;
        st.results = items;
        renderResults(items, items.errors);
        btn.disabled = false;
        hint.textContent = items.length ? '找到 ' + items.length + ' 条' : '没搜到';
      });
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    offInput.addEventListener('change', function () { applyOffset(offInput.value); });
    delayInput.addEventListener('change', function () { applyOffset(delayInput.value); });
    sizeInput.addEventListener('change', function () {
      SET().subtitleSize = Math.max(12, Number(sizeInput.value) || 24);
      try { if (A().saveSettings) A().saveSettings(); } catch (e) {}
      if (Subtitles.current.length && Subtitles.currentWrapper) {
        mount(Subtitles.currentWrapper, Subtitles.current);
      }
    });
    edApply.addEventListener('click', function () {
      if (Subtitles.current.length && Subtitles.currentWrapper) {
        mount(Subtitles.currentWrapper, Subtitles.current);
        toast('字幕编辑已应用', 'success');
      }
    });
    expBtn.addEventListener('click', function () { exportCurrent(fmtSel.value); });

    refreshCues();
    if (st.code) doSearch();

    return {
      search: doSearch,
      destroy: st.destroy,
      refreshCues: refreshCues,
      element: container
    };
  }

  /* ============================================================
     导出：window.Subtitles
     ============================================================ */
  var Subtitles = {
    current: [],
    currentUrl: '',
    currentVideo: null,
    currentWrapper: null,
    overlay: null,
    parseSRT: parseSRT,
    rank: rank,
    isChinese: isChinese,
    isXunlei: isXunlei,
    isZhSite: isZhSite,
    matchesSubtitleCode: matchesSubtitleCode,
    ltxHit: ltxHit,
    search: search,
    render: render,
    loadIntoPlayer: loadIntoPlayer,
    mount: mount,
    exportCurrent: exportCurrent,
    downloadResult: downloadResult,
    // 附加的纯工具（供面板/外部复用）
    serialize: serialize,
    findCue: findCue,
    humanError: humanError,
    getSubtitleText: getSubtitleText
  };
  window.Subtitles = Subtitles;
})();
