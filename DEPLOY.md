# AvPlay Web —— 部署到免费平台 / 命令行使用

目标：随时随地使用这个播放器（手机、别的电脑都行），或不用浏览器直接在终端播放。

---

## 一、两种部署方式对比

| 方式 | 能否随时随地用 | 能注入请求头 / 改写清单 | 费用 |
| --- | --- | --- | --- |
| **Cloudflare Workers**（推荐） | ✅ 任何设备、HTTPS 地址 | ✅ 完整（页面+网关一起） | 免费（10 万次请求/天） |
| GitHub Pages | ✅ 任何设备 | ❌ 只能静态托管 | 免费 |
| 本地 `gateway_server.py` | ❌ 只在本机 | ✅ 完整 | 免费 |
| **命令行 `avplay_cli.py` + mpv** | ✅ 终端随时用 | ✅ mpv 带请求头发起请求 | 免费 |

> 关键点：**GitHub Pages 只能放静态文件**，没有后端，所以改写清单、注入请求头的网关跑不了。
> 但 Cloudflare Workers 免费套餐可以跑 Edge 函数，一个部署同时托管页面和网关。

---

## 二、Cloudflare Workers 部署（推荐）

前置：免费 Cloudflare 账号、Node.js 18+。

```bash
cd C:\工具需带走\新建文件夹\avplay_web\deploy\cloudflare
npm install -g wrangler      # 或：npx wrangler（无需全局安装）
wrangler login               # 浏览器授权
wrangler deploy              # 部署 worker.js + assets/
```

部署后访问 `https://avplay-web.<你的子域名>.workers.dev/`，和本地 `player.html` 一模一样，
只是网关在 Cloudflare 边缘节点上跑（地址 `https://avplay-web.workers.dev/gw/...`）。

**原理**（与本地网关一致，但完全无状态）：

- 上游真实 URL + 请求头被 base64url 编码进网关地址 `/gw/<token>` 里，
  任何边缘节点拿到 token 都能解出原始 URL 和请求头，不需要共享内存。
- 媒体分片流式透传（不占 Worker 内存）。
- 域名限制：免费套餐含 10ms CPU/次；清单改写是纯字符串操作，远小于此；
  分片回传不消耗 CPU（流式）。

### 自定义域名（可选）

编辑 `wrangler.toml`：

```toml
routes = [
  { pattern = "avplay.你的域名.com/*", zone_name = "你的域名.com" }
]
```

---

## 三、GitHub Pages 部署（纯静态）

适用场景：只播放**不需要特殊请求头且支持 CORS 的直链 HLS**（例如公共测试流）。

1. 仓库中只保留 `index.html`（即本项目的 `player.html`）和 `hls.min.js`
2. Settings → Pages → Source: Deploy from a branch → 选 main 分支
3. 页面里把「网关地址」改成你的 **Workers.dev 地址**，或本地网关地址

注意事项：

- Pages 页面是 **HTTPS**；`网关地址` 指向 Workers（HTTPS）没问题；
- 指向 `http://127.0.0.1:8765`（本机 HTTP）在部分浏览器会触发混合内容限制，
  若页面打不开本地网关，请改用 Workers 网关或直接用本地 `player.html`；
- Pages 上也可以正常播放**直链 MP4/M3U8（不需要鉴权的源）**。

---

## 四、命令行直接播放（不用浏览器）

```bash
cd C:\工具需带走\新建文件夹\avplay_web
python avplay_cli.py sites              # 列出内置源站
python avplay_cli.py search "SSIS-001" --source huangguo
python avplay_cli.py search "SSIS-001" --source missav --lang en
python avplay_cli.py play 123456 --source huangguo --episode 1 --mpv
python avplay_cli.py play "SSIS-001" --source javgg --print
```

`--print` 只打印播放地址 + 请求头（用于粘贴到其他播放器）；`--player mpv|vlc` 指定播放器；
未装 mpv/vlc 时只打印地址。

`play` 的逻辑（与桌面端一致）：

1. **黄果**：先 `GET {base}/api/search?keyword=...` 找到视频 ID，
   再 `GET {base}/api/videos/{id}/play?episode=n`，取 `data.video_url`
   （`/api/videos/{id}/play` 必须带 `Referer`/`Origin`，否则 403——这就是桌面端网关存在的原因）。
2. **MissAV**：`GET {base}/{cn|en}/search/{番号}` 抓搜索页，
   再递归解析详情页 + packed.js 解密 → 找到 m3u8 → 直接喂给 mpv。
3. **jav.gg / jav.guru**：`GET {base}/?s={番号}` 抓列表页 → 递归解析 iframe/播放器页
   （等价于桌面端 `PlaybackTargetResolver`：正则扒 `https?://...m3u8|mp4|get_video?`，m3u8 优先）。

---

## 五、已知限制与排障

- **Cloudflare 403 / 需要人机验证**：MissAV、部分聚合站对数据中心流量和非浏览器 UA 做验证，
  命令行脚本会失败并提示「站点需要 Cloudflare 验证」。此时请在浏览器打开页面完成验证后重试；
  或在本地使用时改为浏览器播放。
- **黄果换域名**：`--base https://新域名` 覆盖默认地址。
- **Workers 免费套餐**：超过 10 万次请求/天会限流；个人使用绰绰有余。
- **GitHub Pages**：只托管静态页面，播放仍需上游源站允许跨域（CORS），
  否则必须用 Workers/本地网关转发。

---

## 六、文件清单

avplay_web/
├─ player.html            播放器页面（本地 gateway_server.py 和 Workers 都用它）
├─ hls.min.js            hls.js 1.5.20（离线可用）
├─ gateway_server.py     本地网关（Python 标准库）
├─ avplay_cli.py         命令行资源解析 + mpv 播放
├─ deploy/cloudflare/
│   ├─ worker.js          Cloudflare Workers 版（页面+网关一体）
│   ├─ wrangler.toml      部署配置
│   ├─ assets/index.html  播放器页（拷贝自 player.html）
│   ├─ assets/hls.min.js
│   ├─ test_worker.mjs    纯函数单元测试（node --test）
│   └─ test_server.mjs    端到端集成测试（node --test）
├─ README.md             AvPlay 2.2.0 逆向分析（启动链/播放链/资源获取）
└─ DEPLOY.md             本文件
