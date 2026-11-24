#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AvPlay 网页播放网关

复刻 AvPlay 2.2.0 桌面版（com.javrocket.playground.player.DesktopPlaybackGatewaySession）
的本地 HLS 网关，用 Python 标准库实现，无第三方依赖。

流程对应关系：
  AvPlay 桌面版                                    本脚本
  ---------------------------------------------   -----------------------------------------
  PlaybackManifestRepository.inspect()            /api/play   （拉取并解析清单）
  DesktopPlaybackGatewaySession.register()        Session.register()（真实 URL -> 网关 URL）
  DesktopPlaybackGatewaySession.handle()          /gw/<sid>/<rid>（本地代理 + 注入请求头）
  DesktopPlaybackGatewaySession.rewriteHlsManifest()  rewrite_manifest()（切片/密钥改写）
  DesktopPlaybackGatewayKt.desktopFilterHlsMaster()   filter_master()（清晰度过滤）
  HuangGuoService.getPlayback()                   /api/resolve?source=huangguo（示例资源解析）

用法:
  python gateway_server.py [--host 127.0.0.1] [--port 8765]
然后浏览器打开 http://127.0.0.1:8765/
"""

import argparse
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 手机 / 局域网访问时，网关返回的 play_url 要用电脑的局域网地址，
# 不能写死 127.0.0.1（那在手机上指手机自己）。启动时用 --public 指定。
PUBLIC_BASE = ""

def gateway_base(port):
    return PUBLIC_BASE or f"http://127.0.0.1:{port}"

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- 常量

# 不向上游透传的逐跳头（RFC 7230 6.1）
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "proxy-connection",
}

DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36")

ATTR_RE = re.compile(r'([A-Za-z0-9_-]+)\s*=\s*("[^"]*"|[^,]*)')
URI_ATTR_RE = re.compile(r'URI\s*=\s*"([^"]*)"', re.IGNORECASE)
RESOLUTION_RE = re.compile(r'(\d+)x(\d+)')

MANIFEST_CONTENT_TYPES = (
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
    "text/plain",
    "application/octet-stream",
    "",
)


# ---------------------------------------------------------------- 会话

class Session:
    """对应桌面端的 DesktopPlaybackGatewaySession：保存请求头 + URL 注册表。"""

    def __init__(self, headers=None, max_height=None, title=""):
        self.id = secrets.token_urlsafe(12)
        self.headers = {k: v for k, v in (headers or {}).items()
                        if k.lower() not in HOP_BY_HOP}
        self.max_height = max_height
        self.title = title
        self.resources = {}          # rid -> 真实 URL
        self.rid_by_url = {}         # 真实 URL -> rid
        self.counter = 0
        self.created = time.time()
        self.cache = {}              # url -> (ts, body, content_type)

    def register(self, url, manifest_hint=False):
        """桌面端 register()：真实 URL -> http://127.0.0.1:<port>/gw/<sid>/<rid>"""
        rid = self.rid_by_url.get(url)
        if rid is None:
            self.counter += 1
            rid = self.counter
            self.resources[rid] = url
            self.rid_by_url[url] = rid
        return rid

    def gateway_url(self, rid, port):
        return f"{gateway_base(port)}/gw/{self.id}/{rid}"

    def get(self, rid):
        return self.resources.get(rid)


SESSIONS = {}
SESSIONS_LOCK = threading.Lock()


def get_session(sid):
    with SESSIONS_LOCK:
        return SESSIONS.get(sid)


def put_session(sess):
    with SESSIONS_LOCK:
        SESSIONS[sess.id] = sess
    return sess


def cleanup_sessions(max_age=3600):
    with SESSIONS_LOCK:
        now = time.time()
        for sid in [s for s, v in SESSIONS.items() if now - v.created > max_age]:
            SESSIONS.pop(sid, None)


# ---------------------------------------------------------------- HTTP 工具

def http_fetch(url, headers=None, timeout=25, method="GET", body=None, extra_headers=None):
    """带自定义请求头拉取上游内容。返回 (status, body, content_type, resp_headers)。"""
    req = urllib.request.Request(url, method=method, data=body)
    merged = {}
    merged.update(headers or {})
    merged.update(extra_headers or {})
    for k, v in merged.items():
        if k.lower() in HOP_BY_HOP or k.lower() == "content-length":
            continue
        req.add_header(k, v)
    if "user-agent" not in {k.lower() for k in merged}:
        req.add_header("User-Agent", DEFAULT_UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read(), resp.headers.get("Content-Type", ""), dict(resp.headers)


def is_manifest_body(body, content_type=""):
    """判断内容是否为 M3U8 清单。"""
    ct = (content_type or "").lower()
    if any(t in ct for t in ("mpegurl",)):
        return True
    head = body.lstrip()[:64].decode("utf-8", "ignore")
    return head.startswith("#EXTM3U")


def parse_attrs(text):
    attrs = {}
    for m in ATTR_RE.finditer(text):
        key = m.group(1).upper()
        val = m.group(2)
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        attrs[key] = val
    return attrs


def parse_master(text):
    """解析 HLS 主清单，返回 [{attrs, uri, inf_index, uri_index}]。"""
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF:"):
            continue
        uri_index = None
        for j in range(i + 1, len(lines)):
            s = lines[j].strip()
            if not s or s.startswith("#"):
                continue
            uri_index = j
            break
        if uri_index is None:
            continue
        out.append({
            "attrs": parse_attrs(line[len("#EXT-X-STREAM-INF:"):]),
            "uri": lines[uri_index].strip(),
            "inf_index": i,
            "uri_index": uri_index,
        })
    return out


def filter_master(text, max_height):
    """桌面端 desktopFilterHlsMaster()：按最大高度过滤主清单。"""
    if not max_height:
        return text
    renditions = parse_master(text)
    if not renditions:
        return text
    keep = set()
    for r in renditions:
        res = r["attrs"].get("RESOLUTION", "")
        m = RESOLUTION_RE.search(res)
        if not m or int(m.group(2)) <= max_height:
            keep.add(r["uri_index"])
    if not keep or len(keep) == len(renditions):
        return text
    lines = text.splitlines()
    drop = set()
    for r in renditions:
        if r["uri_index"] not in keep:
            drop.add(r["inf_index"])
            drop.add(r["uri_index"])
    return "\n".join(l for i, l in enumerate(lines) if i not in drop)


def rewrite_manifest(body, manifest_url, session, port):
    """桌面端 rewriteHlsManifest()：把清单内所有资源改写成网关地址。

    主清单：每个 #EXT-X-STREAM-INF 的 variant URI 注册后改写。
    媒体清单：切片、#EXT-X-KEY、#EXT-X-MAP、#EXT-X-MEDIA、I-FRAME 全部改写。
    """
    text = body.decode("utf-8", "ignore")
    if not text.lstrip().startswith("#EXTM3U"):
        return body

    if parse_master(text):
        renditions = parse_master(text)
        lines = text.splitlines()
        for r in renditions:
            real = urllib.parse.urljoin(manifest_url, r["uri"])
            rid = session.register(real, manifest_hint=True)
            lines[r["uri_index"]] = session.gateway_url(rid, port)
        return "\n".join(lines).encode("utf-8")

    lines = text.splitlines()
    out = []
    for line in lines:
        stripped = line.strip()
        m = URI_ATTR_RE.search(line)
        if m and line.startswith("#EXT-X-"):
            real = urllib.parse.urljoin(manifest_url, m.group(1))
            rid = session.register(real, manifest_hint=True)
            line = line[:m.start(1)] + session.gateway_url(rid, port) + line[m.end(1):]
        elif stripped and not stripped.startswith("#"):
            real = urllib.parse.urljoin(manifest_url, stripped)
            rid = session.register(real)
            line = session.gateway_url(rid, port)
        out.append(line)
    return "\n".join(out).encode("utf-8")


# ---------------------------------------------------------------- 网关核心

def build_play_response(url, headers, max_height, title, port, timeout=25):
    """对应 PlaybackManifestRepository.inspect()：拉清单 -> 过滤 -> 返回播放地址。"""
    sess = Session(headers=headers, max_height=max_height, title=title)
    status, body, ctype, _ = http_fetch(url, headers=sess.headers, timeout=timeout)

    play_rid = sess.register(url, manifest_hint=True)
    renditions = []

    if is_manifest_body(body, ctype):
        text = body.decode("utf-8", "ignore")
        if parse_master(text):
            for idx, r in enumerate(parse_master(text)):
                real = urllib.parse.urljoin(url, r["uri"])
                rid = sess.register(real, manifest_hint=True)
                attrs = r["attrs"]
                m = RESOLUTION_RE.search(attrs.get("RESOLUTION", ""))
                renditions.append({
                    "id": rid,
                    "level": idx,
                    "width": int(m.group(1)) if m else None,
                    "height": int(m.group(2)) if m else None,
                    "bandwidth": int(attrs["BANDWIDTH"]) if attrs.get("BANDWIDTH", "").isdigit() else None,
                    "codecs": attrs.get("CODECS", ""),
                })
        # 预过滤（桌面端在清单返回时按清晰度过滤）
        filtered = filter_master(text, max_height)
        if filtered != text:
            # 过滤后需要按新清单重建资源表（丢弃未保留的 variant）
            sess = Session(headers=headers, max_height=max_height, title=title)
            sess.register(url, manifest_hint=True)
            renditions = []
            for idx, r in enumerate(parse_master(filtered)):
                real = urllib.parse.urljoin(url, r["uri"])
                rid = sess.register(real, manifest_hint=True)
                attrs = r["attrs"]
                m = RESOLUTION_RE.search(attrs.get("RESOLUTION", ""))
                renditions.append({
                    "id": rid,
                    "level": idx,
                    "width": int(m.group(1)) if m else None,
                    "height": int(m.group(2)) if m else None,
                    "bandwidth": int(attrs["BANDWIDTH"]) if attrs.get("BANDWIDTH", "").isdigit() else None,
                    "codecs": attrs.get("CODECS", ""),
                })
            play_rid = 1

    put_session(sess)
    return {
        "session": sess.id,
        "play_url": f"{gateway_base(port)}/gw/{sess.id}/{play_rid}",
        "kind": "hls" if is_manifest_body(body, ctype) else "file",
        "upstream_url": url,
        "renditions": renditions,
    }


def resolve_huangguo(base, video_id, episode, user_agent=DEFAULT_UA):
    """对应 HuangGuoService.getPlayback()：GET {base}/api/videos/{id}/play?episode=n"""
    base = base.rstrip("/")
    site_url = urllib.parse.urljoin(base + "/", ".")
    api = f"{base}/api/videos/{video_id}/play?episode={int(episode)}"
    headers = {
        "Origin": site_url,
        "Referer": f"{site_url}/video/{video_id}/",
        "User-Agent": user_agent,
        "Accept": "application/json",
    }
    status, body, ctype, _ = http_fetch(api, headers=headers)
    payload = json.loads(body.decode("utf-8", "ignore"))
    data = payload.get("data") or {}
    video_url = data.get("video_url") or data.get("videoUrl") or ""
    if not video_url:
        raise ValueError("响应里没有 video_url 字段: " + json.dumps(payload, ensure_ascii=False)[:300])
    return {
        "url": video_url,
        "title": data.get("page_title") or data.get("page_h1") or data.get("title") or "",
        "headers": headers,
        "extra": {k: data.get(k) for k in ("video_api", "video_key", "video_iv")},
    }


# ---------------------------------------------------------------- HTTP 服务

class Handler(BaseHTTPRequestHandler):
    server_version = "AvPlayGateway/1.0"
    protocol_version = "HTTP/1.1"
    port = 8765

    # ---- 工具
    def log_message(self, fmt, *args):
        pass  # 静音，避免和网关日志混在一起

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message, code=400):
        self._json({"error": str(message)}, code)

    def _client_headers(self):
        """把浏览器请求头里可用的部分作为上游请求头（对应网关的请求头透传）。"""
        out = {}
        for k, v in self.headers.items():
            if k.lower() in HOP_BY_HOP or k.lower() in ("host", "content-length"):
                continue
            if k.lower() in ("origin", "referer", "user-agent", "accept", "range",
                             "accept-language", "cookie", "authorization"):
                out[k] = v
        return out

    # ---- 路由
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path in ("/", "/index.html", "/player.html"):
                return self._serve_file(HERE / "player.html", "text/html; charset=utf-8", head_only)
            if path == "/hls.min.js":
                return self._serve_file(HERE / "hls.min.js", "application/javascript; charset=utf-8", head_only)
            if path == "/api/play":
                return self._api_play(query, head_only)
            if path == "/api/resolve":
                return self._api_resolve(query, head_only)
            if path.startswith("/gw/"):
                return self._gateway(path, head_only)
            return self._error("not found", 404)
        except urllib.error.HTTPError as e:
            return self._error(f"upstream {e.code}: {e.reason}", 502)
        except Exception as e:  # noqa: BLE001
            return self._error(f"{type(e).__name__}: {e}", 500)

    def _serve_file(self, file_path, content_type, head_only):
        if not file_path.exists():
            return self._error("file missing: " + file_path.name, 404)
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    # ---- /api/play
    def _api_play(self, query, head_only):
        url = (query.get("url") or [""])[0].strip()
        if not url:
            return self._error("缺少 url 参数")
        headers = {}
        raw_headers = (query.get("headers") or [""])[0].strip()
        if raw_headers:
            try:
                headers = json.loads(raw_headers)
            except json.JSONDecodeError as e:
                return self._error("headers 不是合法 JSON: " + str(e))
        max_height = (query.get("maxheight") or [""])[0].strip()
        max_height = int(max_height) if max_height.isdigit() else None
        title = (query.get("title") or [""])[0]

        result = build_play_response(url, headers, max_height, title, self.port)
        if head_only:
            return self._json({"ok": True})
        return self._json(result)

    # ---- /api/resolve
    def _api_resolve(self, query, head_only):
        source = (query.get("source") or ["huangguo"])[0].strip()
        if source != "huangguo":
            return self._error("未知 source: " + source)
        base = (query.get("base") or [""])[0].strip()
        video_id = (query.get("id") or [""])[0].strip()
        episode = (query.get("episode") or ["1"])[0].strip()
        if not base or not video_id:
            return self._error("缺少 base 或 id 参数")
        info = resolve_huangguo(base, video_id, episode)
        max_height = (query.get("maxheight") or [""])[0].strip()
        max_height = int(max_height) if max_height.isdigit() else None
        result = build_play_response(info["url"], info["headers"], max_height,
                                     info["title"], self.port)
        result["resolved_from"] = {"source": source, "base": base, "id": video_id,
                                   "episode": episode, "title": info["title"]}
        if head_only:
            return self._json({"ok": True})
        return self._json(result)

    # ---- /gw/<sid>/<rid>  本地代理 + 清单改写
    def _gateway(self, path, head_only):
        parts = [p for p in path.split("/") if p]
        if len(parts) != 3 or parts[0] != "gw":
            return self._error("bad gateway path", 404)
        sid, rid = parts[1], parts[2]
        if not rid.isdigit():
            return self._error("bad rid", 404)
        sess = get_session(sid)
        if sess is None:
            return self._error("会话不存在或已过期", 404)
        real_url = sess.get(int(rid))
        if real_url is None:
            return self._error("资源不存在", 404)

        extra = self._client_headers()
        status, body, ctype, resp_headers = http_fetch(
            real_url, headers=sess.headers, extra_headers=extra)

        # 清单：改写后再返回
        if is_manifest_body(body, ctype):
            body = rewrite_manifest(body, real_url, sess, self.port)
            ctype = "application/vnd.apple.mpegurl; charset=utf-8"

        self.send_response(status if status != 200 else 200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        if "Content-Range" in resp_headers:
            self.send_header("Content-Range", resp_headers["Content-Range"])
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="AvPlay 网页播放网关")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址；手机访问要填 0.0.0.0")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    parser.add_argument("--public", default="", help="给手机用：填 http://电脑局域网IP:端口，网关返回的 play_url 会用这个地址")
    args = parser.parse_args()

    global PUBLIC_BASE
    PUBLIC_BASE = args.public.rstrip("/") if args.public else ""
    Handler.port = args.port
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"AvPlay 网页网关已启动: http://{args.host}:{args.port}/")
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
