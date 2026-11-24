/**
 * Cloudflare Pages Function: /api/proxy?url=<encoded target>
 * 服务端 fetch 不受浏览器 CORS 限制，供 App 的字幕/站点抓取使用。
 * 只转发 http(s)，拒绝内网/回环地址。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function blocked(target) {
  const h = target.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^127\./.test(h) || h === '::1' || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  return false;
}

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With',
    'Access-Control-Max-Age': '86400'
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const raw = context.request.url;
  const targetUrl = new URL(raw).searchParams.get('url');
  if (!targetUrl) return new Response(JSON.stringify({ error: 'missing url' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  let target;
  try { target = new URL(targetUrl); } catch (e) {
    return new Response(JSON.stringify({ error: 'bad url' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!/^https?:$/.test(target.protocol) || blocked(target)) {
    return new Response(JSON.stringify({ error: 'url not allowed' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const method = context.request.method === 'POST' ? 'POST' : 'GET';
    const init = {
      method,
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
      signal: controller.signal,
      redirect: 'follow'
    };
    if (method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = await context.request.text();
    }
    const upstream = await fetch(target.toString(), init);
    clearTimeout(timer);
    const body = await upstream.arrayBuffer();
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': ct, 'Cache-Control': 'public, max-age=60' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
