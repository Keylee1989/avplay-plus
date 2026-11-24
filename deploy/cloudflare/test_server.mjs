// 端到端集成测试：用假源站验证 worker 的 /api/play、/gw/<token>、/api/resolve
// 运行：node --test test_server.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const ORIGIN = "https://cdn.test";
const CDN2 = "https://cdn2.test";
const HUANGUO = "https://hub.test";

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080
1080.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
seg-1.ts
#EXT-X-ENDLIST
`;

// ---- 假上游（要求 X-Test-Auth: secret） ----
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const headers = input instanceof Request
    ? new Headers(input.headers)
    : new Headers((init && init.headers) || (input && input.headers));
  const auth = headers.get("x-test-auth");
  if (url === ORIGIN + "/master.m3u8" && auth === "secret") {
    return new Response(MASTER, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
  }
  if (url === ORIGIN + "/720.m3u8" && auth === "secret") {
    return new Response(MEDIA, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
  }
  if (url === CDN2 + "/master.m3u8") {
    return new Response(MASTER, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
  }
  if (url.startsWith(ORIGIN + "/seg") && auth === "secret") {
    return new Response(new Uint8Array([0x47, 0x21]), { headers: { "content-type": "video/mp2t" } });
  }
  if (url === HUANGUO + "/api/videos/42/play?episode=1") {
    // 模拟上游要求 Referer/Origin（黄果风格）
    if (!headers.get("origin") || !headers.get("referer")) {
      return new Response(JSON.stringify({ code: 403, msg: "forbidden" }), { status: 403 });
    }
    return new Response(JSON.stringify({
      status: 0,
      data: { video_url: CDN2 + "/master.m3u8", page_title: "测试标题" },
    }), { headers: { "content-type": "application/json" } });
  }
  return new Response("forbidden", { status: 403 });
};

const env = {
  ASSETS: { fetch: () => new Response("<html>player</html>", { headers: { "content-type": "text/html" } }) },
};
const call = (path, init) =>
  worker.fetch(new Request("http://local" + path, init), env);

test("OPTIONS 预检返回 204 + CORS", async () => {
  const r = await call("/api/play", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("/api/play 创建无状态网关会话，带请求头可用", async () => {
  const url = ORIGIN + "/master.m3u8";
  const headers = JSON.stringify({ "X-Test-Auth": "secret" });
  const r = await call(`/api/play?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(headers)}`);
  const j = await r.json();
  assert.equal(j.kind, "hls");
  assert.equal(j.renditions.length, 2);
  assert.ok(j.play_url.startsWith("http://local/gw/"));

  // 通过网关拉清单（应注入请求头，variant 被改写）
  const m = await call(new URL(j.play_url).pathname);
  const text = await m.text();
  assert.ok(text.includes("http://local/gw/"), "variant 应改写为网关 URL");
  assert.equal(text.includes("720.m3u8"), false);

  // 取 720.m3u8 对应的网关地址，再拉媒体清单（应被改写）
  const variant = [...text.matchAll(/http:\/\/local\/gw\/([A-Za-z0-9_-]+)/g)].map((x) => x[0])[0];
  const media = await call(new URL(variant).pathname);
  const mediaText = await media.text();
  assert.ok(mediaText.includes("http://local/gw/"), "切片应改写为网关 URL");
  assert.equal(mediaText.includes("seg-1.ts"), false);

  // 拉一个切片：假源站要求 X-Test-Auth，网关必须带上
  const seg = [...mediaText.matchAll(/http:\/\/local\/gw\/([A-Za-z0-9_-]+)/g)].map((x) => x[0])[0];
  const segResp = await call(new URL(seg).pathname);
  const segBody = new Uint8Array(await segResp.arrayBuffer());
  assert.equal(segBody[0], 0x47);
});

test("/api/play 不带请求头 -> 上游 403（响应里能看到 upstream_status）", async () => {
  const r = await call(`/api/play?url=${encodeURIComponent(ORIGIN + "/master.m3u8")}`);
  const j = await r.json();
  assert.equal(j.upstream_status, 403);
  const m = await call(new URL(j.play_url).pathname);
  // 非清单内容原样透传上游状态码
  assert.equal(m.status, 403);
});

test("/api/resolve huangguo：解析 video_url 并走网关", async () => {
  const q = new URLSearchParams({
    source: "huangguo",
    base: HUANGUO,
    id: "42",
    episode: "1",
    maxheight: "720",
  });
  const r = await call("/api/resolve?" + q.toString());
  const j = await r.json();
  assert.equal(j.resolved_from.id, "42");
  assert.equal(j.resolved_from.title, "测试标题");
  assert.equal(j.renditions.length, 1, "maxheight=720 应只剩 720p");
  assert.ok(j.play_url.startsWith("http://local/gw/"));
});

test("非法令牌返回 400", async () => {
  const r = await call("/gw/not-a-token");
  assert.equal(r.status, 400);
});
