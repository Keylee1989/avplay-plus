// 用 Node 对 worker.js 里的纯函数做单元测试：node test_worker.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64urlEncode, b64urlDecode, tokenFor, decodeToken,
  isManifest, parseMaster, filterMaster, rewriteManifest,
} from "./worker.js";

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.4d401f"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS="avc1.4d4028"
1080.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x11111111111111111111111111111111
#EXTINF:10.0,
seg-1.ts
#EXTINF:10.0,
seg-2.ts
#EXT-X-ENDLIST
`;

test("base64url roundtrip (含中文)", () => {
  const s = '中文标题 "quoted" \\ / + =';
  assert.equal(b64urlDecode(b64urlEncode(s)), s);
});

test("token roundtrip", () => {
  const headers = { Referer: "https://a.com/", "User-Agent": "UA/1.0" };
  const t = tokenFor("https://cdn.example.com/x/index.m3u8", headers, 720);
  const d = decodeToken(t);
  assert.equal(d.url, "https://cdn.example.com/x/index.m3u8");
  assert.deepEqual(d.headers, headers);
  assert.equal(d.maxHeight, 720);
});

test("parseMaster", () => {
  const rs = parseMaster(MASTER);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].attrs.RESOLUTION, "1280x720");
  assert.equal(rs[0].uri, "720.m3u8");
});

test("filterMaster 只保留 720", () => {
  const out = filterMaster(MASTER, 720);
  assert.match(out, /720\.m3u8/);
  assert.equal(out.includes("1080.m3u8"), false);
  assert.equal(parseMaster(out).length, 1);
});

test("isManifest", () => {
  assert.equal(isManifest(MASTER, "application/vnd.apple.mpegurl"), true);
  assert.equal(isManifest(MASTER, ""), true);
  assert.equal(isManifest("not a manifest", "video/mp2t"), false);
});

const BASE = "https://gw.example.com";
const HEADERS = { Referer: "https://src.example.com/" };

test("主清单改写：variant 改成网关 token，且 token 里带请求头", () => {
  const out = rewriteManifest(MASTER, "https://cdn.example.com/m/master.m3u8", 0, BASE, HEADERS);
  assert.match(out, new RegExp(BASE + "/gw/[A-Za-z0-9_-]+"));
  assert.ok(!out.includes("720.m3u8"), "变体地址应被替换");
  // 解码第一个 token，确认指向真实变体 URL 且带请求头
  const m = new RegExp(BASE + "/gw/([A-Za-z0-9_-]+)").exec(out);
  const d = decodeToken(m[1]);
  assert.equal(d.url, "https://cdn.example.com/m/720.m3u8");
  assert.deepEqual(d.headers, HEADERS);
});

test("主清单改写 + maxheight 过滤", () => {
  const out = rewriteManifest(MASTER, "https://cdn.example.com/m/master.m3u8", 720, BASE, HEADERS);
  assert.ok(!out.includes("1080"), "1080p 应被过滤");
});

test("媒体清单改写：切片和 KEY 都改成网关 token", () => {
  const out = rewriteManifest(MEDIA, "https://cdn.example.com/m/720.m3u8", 0, BASE, HEADERS);
  assert.ok(!out.includes('"key.bin"'), "密钥地址应被替换");
  assert.ok(!out.includes("seg-1.ts"), "切片地址应被替换");
  assert.ok(!out.includes("seg-2.ts"), "切片地址应被替换");
  const uris = [...out.matchAll(new RegExp(BASE + "/gw/([A-Za-z0-9_-]+)", "g"))].map((m) => m[1]);
  assert.equal(uris.length, 3); // key + 2 segments
  assert.equal(decodeToken(uris[0]).url, "https://cdn.example.com/m/key.bin");
  assert.equal(decodeToken(uris[1]).url, "https://cdn.example.com/m/seg-1.ts");
  assert.equal(decodeToken(uris[2]).url, "https://cdn.example.com/m/seg-2.ts");
  assert.equal(decodeToken(uris[0]).headers.Referer, HEADERS.Referer);
});

console.log("all worker tests passed");
