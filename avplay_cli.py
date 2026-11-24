#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AvPlay 资源解析命令行工具（离线可用，只依赖 Python 3.8+ 标准库）

对应桌面端桌面 App 的“资源怎么获取”这一步，复刻了黄果(huangguoai.com)、
MissAV 以及 jav.gg / jav.guru 聚合站的取流逻辑（基于 AvPlay 2.2.0 反编译分析）。

用法:
  python avplay_cli.py sites
  python avplay_cli.py search "SSIS-001" --source huangguo
  python avplay_cli.py search "SSIS-001" --source missav --lang en
  python avplay_cli.py search "SSIS-001" --source javgg
  python avplay_cli.py play 123456 --source huangguo --episode 1
  python avplay_cli.py play "SSIS-001" --source missav --mpv
  python avplay_cli.py play "SSIS-001" --source javgg --print
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36")

SITES = {
    "huangguo": {"name": "黄果（JSON API）", "base": "https://huangguoai.com", "type": "api"},
    "missav":   {"name": "MissAV（HTML 解析）", "base": "https://missav.ws",   "type": "scrape-search"},
    "javgg":    {"name": "jav.gg（聚合站，递归解析 iframe/播放器）", "base": "https://javgg.net", "type": "aggregator"},
    "javguru":  {"name": "jav.guru（聚合站，递归解析 iframe/播放器）", "base": "https://jav.guru", "type": "aggregator"},
}

MEDIA_URL_RE = re.compile(
    r"https?://[^'\"\\\s<>]+(?:\.m3u8|\.mp4|get_video\?)[^'\"\\\s<>]*", re.IGNORECASE
)
SAMPLE_MARKERS = ("test-videos.co.uk", "bigbuckbunny", "sample-video", "sample_video")
CODE_RE = re.compile(r"(?i)(fc2[-_\s]?ppv[-_\s]?\d{4,10}|[a-z]{2,10}[-_\s]?\d{2,8})")


# ------------------------------------------------------------------ HTTP

def http_get(url, headers=None, timeout=25):
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if "User-Agent" not in (headers or {}) and "user-agent" not in (headers or {}):
        req.add_header("User-Agent", DEFAULT_UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "") if e.headers else ""


def http_json(url, headers=None, timeout=25):
    status, body, _ = http_get(url, headers=headers, timeout=timeout)
    try:
        return status, json.loads(body.decode("utf-8", "ignore"))
    except json.JSONDecodeError:
        raise RuntimeError(f"接口返回的不是 JSON (HTTP {status}): {body[:200]!r}")


def browser_headers(referer=None, origin=None, ua=None):
    h = {"User-Agent": ua or DEFAULT_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
    if referer:
        h["Referer"] = referer
    if origin:
        h["Origin"] = origin
    return h


# ------------------------------------------------------------------ M3U8 / 媒体 URL（对应 FindMediaUrls）

def unescape_url(s):
    return s.replace("\\/", "/").replace("\\u0026", "&")


def find_media_urls(html):
    out, seen = [], set()
    for m in MEDIA_URL_RE.finditer(unescape_url(html)):
        u = m.group(0)
        if u.lower().startswith("blob:"):
            continue
        if any(s in u.lower() for s in SAMPLE_MARKERS):
            continue
        if u not in seen:
            seen.add(u)
            out.append(u)
    # m3u8 优先，mp4 次之，get_video 再次
    def rank(u):
        u = u.lower()
        if ".m3u8" in u:
            return 0
        if ".mp4" in u:
            return 1
        if "get_video?" in u:
            return 2
        return 9
    out.sort(key=rank)
    return out


def find_iframe_srcs(html, base_url):
    srcs = []
    for m in re.finditer(r'<iframe[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE):
        src = m.group(1).strip()
        absolute = urllib.parse.urljoin(base_url, src)
        if absolute not in srcs:
            srcs.append(absolute)
    return srcs


def extract_video_code(text):
    m = CODE_RE.search(text or "")
    return m.group(0) if m else None


# 简易 packed.js（Dean Edwards 打包格式）解密，best-effort
def unpack_packed_js(source):
    results = []
    for m in re.finditer(r"eval\(function\(p,a,c,k,e,d\)\{.*?\}\('((?:[^'\\]|\\.)*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)", source, re.S):
        payload, radix, count, wordstr = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
        try:
            words = wordstr.split("|")
            # 把 p 里的 "\b\w+\b" 按 e() 解码后替换为 words[i]
            def encode(n):
                out = ""
                chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                while n:
                    n, d = divmod(n, radix)
                    out = chars[d] + out
                return out or "0"
            # 预生成替换表
            table = []
            for i in range(count):
                token = encode(i)
                table.append((token, words[i] if i < len(words) and words[i] else token))
            # 长的 token 先替换（避免子串覆盖）
            table.sort(key=lambda kv: len(kv[0]), reverse=True)
            p = payload
            for token, word in table:
                p = re.sub(r"\b" + re.escape(token) + r"\b", word.replace("\\\\", "\\"), p)
            results.append(p)
        except Exception:
            continue
    return results


# ------------------------------------------------------------------ 黄果（huangguoai.com）

def huangguo_search(base, keyword, page=1, size=20):
    qs = urllib.parse.urlencode({"keyword": keyword, "page": page, "size": size})
    url = base.rstrip("/") + "/api/search?" + qs
    status, payload = http_json(url, headers=browser_headers(ua=DEFAULT_UA))
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    data = payload.get("data") or {}
    items = data.get("items") or []
    return [
        {"id": v.get("id"), "title": v.get("title"), "episodes": v.get("total_episodes") or v.get("episode_count"),
         "url": base.rstrip("/") + f"/api/videos/{v.get('id')}/play"}
        for v in items
    ]


def huangguo_play(base, video_id, episode=1):
    site = base.rstrip("/")
    url = f"{site}/api/videos/{video_id}/play?episode={int(episode)}"
    referer = f"{site}/video/{video_id}/"
    headers = browser_headers(ua=DEFAULT_UA, referer=referer, origin=site)
    status, payload = http_json(url, headers=headers)
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {payload}")
    data = payload.get("data") or {}
    video_url = data.get("video_url")
    if not video_url:
        raise RuntimeError(f"响应缺少 video_url 字段: {payload}")
    return {"url": video_url, "title": data.get("page_title") or "", "headers": headers}


# ------------------------------------------------------------------ MissAV

def missav_search_url(base, av_id, lang="en", ua=None):
    base = base.rstrip("/")
    path = f"/{lang}/search/{urllib.parse.quote(av_id.strip())}" if lang in ("cn", "en") else f"/search/{urllib.parse.quote(av_id.strip())}"
    return base + path


def missav_search(base, av_id, lang="en", limit=10):
    url = missav_search_url(base, av_id, lang)
    status, body, _ = http_get(url, headers=browser_headers(ua=DEFAULT_UA))
    if status != 200:
        raise RuntimeError(f"HTTP {status}（站点可能做了 Cloudflare 验证，请先在浏览器打开 {url} 完成验证再试）")
    html = body.decode("utf-8", "ignore")
    results, seen = [], set()
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.IGNORECASE | re.DOTALL):
        href, inner = m.group(1).strip(), re.sub(r"<[^>]+>", " ", m.group(2))
        if re.search(r"/(cn|en)/search/", href):          # 搜索链接本身
            continue
        if not re.search(r"/[^/?#]+/[A-Za-z0-9_-]{2,}/?$", href) and "/" + av_id.lower().replace("-", "").replace("_", "") not in href.lower().replace("-", "").replace("_", ""):
            pass  # 宽松匹配：下面用 code 校验
        text = re.sub(r"\s+", " ", inner).strip()
        absolute = urllib.parse.urljoin(base.rstrip("/") + "/", href)
        code = extract_video_code(text + " " + absolute)
        if not code:
            continue
        if code.lower().replace("-", "").replace("_", "").replace(" ", "") != av_id.lower().replace("-", "").replace("_", "").replace(" ", ""):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        results.append({"id": absolute, "title": text or absolute, "url": absolute})
        if len(results) >= limit:
            break
    return results


def scrape_for_media(page_url, final_url=None, depth=0, max_depth=3):
    """递归解析页面，返回 (media_url, source_page_url)；对应 PlaybackTargetResolver"""
    page_url = final_url or page_url
    status, body, ctype = http_get(page_url, headers=browser_headers(referer=page_url))
    html = body.decode("utf-8", "ignore")
    if status not in (200, 206):
        raise RuntimeError(f"HTTP {status}")

    candidates = find_media_urls(html)
    for packed in unpack_packed_js(html):
        candidates.extend(find_media_urls(packed))
    candidates = [u for u in dict.fromkeys(candidates)]
    if candidates:
        return candidates[0], page_url

    if depth >= max_depth:
        return None, page_url
    for frame_url in find_iframe_srcs(html, page_url):
        media, src = scrape_for_media(frame_url, frame_url, depth + 1, max_depth)
        if media:
            return media, src
    return None, page_url


# ------------------------------------------------------------------ 聚合站 jav.gg / jav.guru

def aggregator_search(base, av_id, limit=10, selector="article .details .title a[href*='/jav/'], article a[href]"):
    url = base.rstrip("/") + "/?s=" + urllib.parse.quote(av_id)
    status, body, _ = http_get(url, headers=browser_headers())
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    html = body.decode("utf-8", "ignore")
    results, seen = [], set()
    if selector.startswith("article .details"):  # jav.gg 风格
        pat = re.compile(r'<a[^>]+href="([^"]*?/jav/[^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
    else:
        pat = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
    for m in pat.finditer(html):
        href, inner = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
        text = re.sub(r"\s+", " ", inner).strip()
        if not text:
            continue
        absolute = urllib.parse.urljoin(base.rstrip("/") + "/", href)
        code = extract_video_code(text + " " + absolute)
        if not code:
            continue
        if code.lower().replace("-", "") != av_id.lower().replace("-", ""):
            # 聚合站搜索结果常有无关条目，宽松放行但标记
            pass
        if absolute in seen:
            continue
        seen.add(absolute)
        results.append({"id": absolute, "title": text, "url": absolute})
        if len(results) >= limit:
            break
    return results


# ------------------------------------------------------------------ 播放

def play_url(url, headers, player="mpv"):
    hdr = ",".join(f"{k}: {v}" for k, v in headers.items() if v)
    if player == "mpv":
        cmd = ["mpv", f"--user-agent={headers.get('User-Agent', DEFAULT_UA)}",
               f"--http-header-fields={hdr}", url]
        print("启动:", " ".join(cmd))
        subprocess.Popen(cmd)
    elif player == "vlc":
        cmd = ["vlc", f"--http-user-agent={headers.get('User-Agent', DEFAULT_UA)}",
               f"--http-referrer={headers.get('Referer', '') or headers.get('Origin', '')}", url]
        print("启动:", " ".join(cmd))
        subprocess.Popen(cmd)
    else:
        raise ValueError("未知 player")


def cmd_sites(_):
    print(json.dumps(SITES, ensure_ascii=False, indent=2))


def cmd_search(args):
    site = SITES[args.source]
    base = args.base or site["base"]
    if args.source == "huangguo":
        items = huangguo_search(base, args.keyword, page=args.page, size=args.limit)
    elif args.source == "missav":
        items = missav_search(base, args.keyword, args.lang, args.limit)
    elif args.source == "javgg":
        items = aggregator_search(base, args.keyword, args.limit, selector="article .details .title a[href*='/jav/']")
    elif args.source == "javguru":
        items = aggregator_search(base, args.keyword, args.limit, selector="a[href]")
    else:
        raise SystemExit("未知 source")
    for i, item in enumerate(items, 1):
        title = (item.get("title") or "")[:60]
        print(f"[{i}] {title}")
        print(f"    id={item.get('id')}  url={item.get('url')}")
    print(f"\n共 {len(items)} 条。提示: play <id> --source {args.source}")


def cmd_play(args):
    site = SITES[args.source]
    base = args.base or site["base"]
    if args.source == "huangguo":
        info = huangguo_play(base, args.id, args.episode)
    else:
        # 先找候选页面，再递归解析媒体地址
        if args.source == "missav":
            candidates = missav_search(base, args.id, args.lang, 1)
        else:
            candidates = aggregator_search(base, args.id, 3)
        if not candidates:
            raise SystemExit("未找到候选页面，请确认编号或站点是否需要 Cloudflare 验证")
        page_url = candidates[0]["url"]
        print(f"候选页面: {page_url}\n正在解析媒体地址...")
        media, src = scrape_for_media(page_url)
        if not media:
            raise SystemExit("未找到可播放媒体地址（页面可能需要 JS/Cloudflare 验证，请在浏览器中打开页面确认后再试）")
        info = {
            "url": media,
            "title": candidates[0].get("title", ""),
            "headers": browser_headers(
                referer=src,
                origin=urllib.parse.urlparse(src).scheme + "://" + urllib.parse.urlparse(src).netloc,
            ),
        }

    print(f"标题: {info['title']}")
    print(f"播放地址: {info['url']}")
    print(f"请求头: {json.dumps(info['headers'], ensure_ascii=False)}")

    if args.print:
        return
    player = args.player
    if player == "auto":
        player = "mpv" if shutil_which("mpv") else ("vlc" if shutil_which("vlc") else None)
    if not player:
        print("未找到 mpv/vlc，请使用 --print 查看地址，或安装 mpv 后重试")
        return
    play_url(info["url"], info["headers"], player)


def shutil_which(name):
    import shutil
    return shutil.which(name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    p_sites = sub.add_parser("sites", help="列出内置源站")
    p_sites.set_defaults(func=cmd_sites)

    p_search = sub.add_parser("search", help="搜索视频")
    p_search.add_argument("keyword")
    p_search.add_argument("--source", default="huangguo", choices=list(SITES))
    p_search.add_argument("--base", default=None, help="覆盖默认站点地址（站点换了域名时用）")
    p_search.add_argument("--page", type=int, default=1)
    p_search.add_argument("--limit", type=int, default=10)
    p_search.add_argument("--lang", default="en", choices=["cn", "en", ""])
    p_search.set_defaults(func=cmd_search)

    p_play = sub.add_parser("play", help="解析并播放")
    p_play.add_argument("id", help="黄果为视频 ID；MissAV/聚合站为番号，如 SSIS-001")
    p_play.add_argument("--source", default="huangguo", choices=list(SITES))
    p_play.add_argument("--base", default=None)
    p_play.add_argument("--episode", type=int, default=1)
    p_play.add_argument("--lang", default="en", choices=["cn", "en", ""])
    p_play.add_argument("--player", default="auto", choices=["auto", "mpv", "vlc"])
    p_play.add_argument("--print", action="store_true", help="只打印播放地址和请求头，不启动播放器")
    p_play.set_defaults(func=cmd_play)

    args = ap.parse_args()
    if not hasattr(args, "func"):
        ap.print_help()
        sys.exit(1)
    try:
        args.func(args)
    except (RuntimeError, ValueError) as e:
        print(f"[错误] {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
