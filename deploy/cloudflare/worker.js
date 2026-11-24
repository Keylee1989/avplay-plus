/**
 * AvPlay Web 网关 —— Cloudflare Workers 版
 *
 * 对应桌面端：DesktopPlaybackGatewaySession + HuangGuoService.getPlayback()
 * 与本地 gateway_server.py 功能一致，但**完全无状态**：
 *  上游真实 URL 与请求头被 base64url 编码进网关地址里，任何边缘节点都能处理。
 *
 * 路由：
 *   GET /                     静态播放器页（assets/index.html）
 *   GET /hls.min.js           静态资源（assets/hls.min.js）
 *   GET /api/play?url=..&headers=..&maxheight=..&title=..
 *   GET /api/resolve?source=huangguo&base=..&id=..&episode=..&maxheight=..
 *   GET /gw/<token>           网关：注入请求头 + 改写 M3U8（切片/密钥也走网关）
 *
 * 部署：npm install -g wrangler && wrangler login && wrangler deploy
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

// ---------- base64url ----------
export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- 网关令牌 {u:url, h:headers, q:maxHeight} ----------
export function tokenFor(url, headers, maxHeight) {
  return b64urlEncode(JSON.stringify({ u: url, h: headers || {}, q: maxHeight || 0 }));
}
export function decodeToken(t) {
  try {
    const o = JSON.parse(b64urlDecode(t));
    if (o && typeof o.u === "string" && o.u)
      return { url: o.u, headers: o.h || {}, maxHeight: o.q | 0 };
  } catch (e) { /* 令牌非法 */ }
  return null;
}

// ---------- M3U8 解析/改写 ----------
export function isManifest(bodyText, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("mpegurl")) return true;
  return String(bodyText).trimStart().startsWith("#EXTM3U");
}

export function parseAttrs(text) {
  const attrs = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    attrs[m[1].toUpperCase()] = v;
  }
  return attrs;
}

export function parseMaster(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    let uriIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const s = lines[j].trim();
      if (!s || s.startsWith("#")) continue;
      uriIdx = j;
      break;
    }
    if (uriIdx === -1) continue;
    out.push({
      attrs: parseAttrs(lines[i].slice("#EXT-X-STREAM-INF:".length)),
      uri: lines[uriIdx].trim(),
      inf: i,
      uriIndex: uriIdx,
    });
  }
  return out;
}

export function filterMaster(text, maxHeight) {
  maxHeight = Number(maxHeight) || 0;
  if (!maxHeight) return String(text);
  const renditions = parseMaster(text);
  if (renditions.length === 0) return String(text);
  const keepIdx = new Set();
  for (const r of renditions) {
    const m = /(\d+)x(\d+)/.exec(r.attrs.RESOLUTION || "");
    if (!m || Number(m[2]) <= maxHeight) keepIdx.add(r.uriIndex);
  }
  if (keepIdx.size === 0 || keepIdx.size === renditions.length) return String(text);
  const lines = String(text).split("\n");
  const drop = new Set();
  for (const r of renditions) {
    if (!keepIdx.has(r.uriIndex)) {
      drop.add(r.inf);
      drop.add(r.uriIndex);
    }
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/**
 * 清单改写：
 *  - 主清单：variant URI -> /gw/<token(变体)>
 *  - 媒体清单：切片、#EXT-X-KEY/MAP/MEDIA/SESSION-KEY 的 URI -> /gw/<token>
 *  所有 token 都携带同一组请求头（对应桌面端同会话注册）。
 */
export function rewriteManifest(text, manifestUrl, maxHeight, base, headers) {
  const renditions = parseMaster(text);
  if (renditions.length) {
    const filtered = filterMaster(text, maxHeight);
    const lines = filtered.split("\n");
    for (const r of parseMaster(filtered)) {
      const real = new URL(r.uri, manifestUrl).toString();
      lines[r.uriIndex] = base + "/gw/" + tokenFor(real, headers, 0);
    }
    return lines.join("\n");
  }
  const lines = String(text).split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const uriM = /(URI=)(")([^"]*)(")/i.exec(line);
    if (uriM && line.startsWith("#EXT-X-")) {
      const real = new URL(uriM[3], manifestUrl).toString();
      out.push(
        line.slice(0, uriM.index) +
          uriM[1] + uriM[2] + base + "/gw/" + tokenFor(real, headers, 0) + uriM[4] +
          line.slice(uriM.index + uriM[0].length)
      );
    } else if (trimmed && !trimmed.startsWith("#")) {
      const real = new URL(trimmed, manifestUrl).toString();
      out.push(base + "/gw/" + tokenFor(real, headers, 0));
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

// ---------- 上游请求 ----------
function upstreamHeaders(headers, extra) {
  const h = new Headers();
  const merged = Object.assign({}, headers || {}, extra || {});
  for (const k of Object.keys(merged)) {
    if (/^(host|connection|content-length|keep-alive|proxy-|te|trailer|transfer-encoding|upgrade)$/i.test(k)) continue;
    h.set(k, merged[k]);
  }
  if (![...h.keys()].some((k) => k.toLowerCase() === "user-agent")) h.set("User-Agent", DEFAULT_UA);
  return h;
}

async function fetchUpstream(url, headers, extra) {
  const req = new Request(url, { headers: upstreamHeaders(headers, extra), redirect: "follow" });
  return fetch(req);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS),
  });
}
function corsResponse(resp) {
  const h = new Headers(resp.headers);
  for (const k of Object.keys(CORS)) h.set(k, CORS[k]);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

async function buildPlayResponse(url, headers, maxHeight, title, base) {
  const maxH = Number(maxHeight) || 0;
  const resp = await fetchUpstream(url, headers);
  if (!resp.ok && resp.status !== 200) {
    // 仍返回，让客户端拿到错误码（hls.js 能看到 403 等）
  }
  const buf = await resp.arrayBuffer();
  const bodyText = new TextDecoder().decode(buf);
  const ctype = resp.headers.get("Content-Type") || "";
  const kind = isManifest(bodyText, ctype) ? "hls" : "file";
  let renditions = [];
  if (kind === "hls") {
    const filtered = maxH ? filterMaster(bodyText, maxH) : bodyText;
    const master = parseMaster(filtered);
    for (const [level, r] of master.entries()) {
      const res = /(\d+)x(\d+)/.exec(r.attrs.RESOLUTION || "");
      renditions.push({
        id: level,
        level,
        width: res ? Number(res[1]) : null,
        height: res ? Number(res[2]) : null,
        bandwidth: /^\d+$/.test(r.attrs.BANDWIDTH || "") ? Number(r.attrs.BANDWIDTH) : null,
        codecs: r.attrs.CODECS || "",
      });
    }
  }
  return {
    play_url: base + "/gw/" + tokenFor(url, headers, Number(maxHeight) || 0),
    kind,
    upstream_url: url,
    renditions,
    title: title || "",
    upstream_status: resp.status,
  };
}

async function resolveHuangguo(base, videoId, episode, ua) {
  const site = new URL(base).origin;
  const api = site + "/api/videos/" + encodeURIComponent(videoId) + "/play?episode=" + Number(episode || 1);
  const headers = {
    Origin: site,
    Referer: site + "/video/" + encodeURIComponent(videoId) + "/",
    "User-Agent": ua || DEFAULT_UA,
    Accept: "application/json",
  };
  const resp = await fetchUpstream(api, headers);
  const text = await resp.text();
  let payload;
  try { payload = JSON.parse(text); } catch (e) { throw new Error("接口返回的不是 JSON: " + text.slice(0, 200)); }
  const data = (payload && payload.data) || {};
  const videoUrl = data.video_url || data.videoUrl || "";
  if (!videoUrl) throw new Error("响应里没有 video_url 字段: " + JSON.stringify(payload).slice(0, 300));
  return { url: videoUrl, title: data.page_title || data.page_h1 || data.title || "", headers, raw: data };
}

// ---------- 主入口 ----------
export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // 静态资源
    if (path === "/" || path === "/index.html") {
      return env.ASSETS ? env.ASSETS.fetch(new Request(reqUrl.origin + "/index.html", request))
                        : new Response("missing assets binding", { status: 500 });
    }
    if (path === "/hls.min.js" && env.ASSETS) {
      return env.ASSETS.fetch(new Request(reqUrl.origin + "/hls.min.js", request));
    }

    const base = reqUrl.origin;
    const q = reqUrl.searchParams;

    try {
      // /api/play?url=&headers=&maxheight=&title=
      if (path === "/api/play") {
        const url = (q.get("url") || "").trim();
        if (!url) return json({ error: "缺少 url 参数" }, 400);
        let headers = {};
        const raw = q.get("headers");
        if (raw) { try { headers = JSON.parse(raw); } catch (e) { return json({ error: "headers 不是合法 JSON" }, 400); } }
        const result = await buildPlayResponse(url, headers, q.get("maxheight"), q.get("title"), base);
        return json(result);
      }

      // /api/resolve?source=huangguo&base=&id=&episode=&maxheight=
      if (path === "/api/resolve") {
        const source = q.get("source") || "huangguo";
        if (source !== "huangguo") return json({ error: "未知 source" }, 400);
        const baseUrl = (q.get("base") || "").trim();
        const id = (q.get("id") || "").trim();
        const episode = q.get("episode") || "1";
        if (!baseUrl || !id) return json({ error: "缺少 base 或 id 参数" }, 400);
        const info = await resolveHuangguo(baseUrl, id, episode, q.get("ua") || DEFAULT_UA);
        const result = await buildPlayResponse(info.url, info.headers, q.get("maxheight"), info.title, base);
        result.resolved_from = { source, base: baseUrl, id, episode, title: info.title };
        return json(result);
      }

      // /gw/<token>
      if (path.startsWith("/gw/")) {
        const token = decodeToken(path.slice(4));
        if (!token) return json({ error: "令牌无效" }, 400);
        const extra = {};
        if (request.headers.get("Range")) extra.Range = request.headers.get("Range");
        const resp = await fetchUpstream(token.url, token.headers, extra);
        const ct = resp.headers.get("Content-Type") || "";
        const pathname = token.url.split("?")[0].toLowerCase();
        const looksLikeManifest =
          /mpegurl/i.test(ct) || /\.m3u8?$/i.test(pathname) || pathname.slice(-4) === ".m3u";
        if (looksLikeManifest) {
          const bodyText = await resp.text();
          if (isManifest(bodyText, ct)) {
            const rewritten = rewriteManifest(bodyText, token.url, token.maxHeight, base, token.headers);
            return new Response(rewritten, {
              status: resp.status,
              headers: Object.assign({ "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" }, CORS),
            });
          }
          return corsResponse(new Response(bodyText, { status: resp.status, headers: resp.headers }));
        }
        // 媒体分片：流式透传，不缓冲（也不占用 Workers 内存）
        return corsResponse(new Response(resp.body, { status: resp.status, headers: resp.headers }));
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 502);
    }
  },
};
