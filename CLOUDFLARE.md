# Cloudflare 部署（推荐，带跨域代理）

GitHub Pages 能装，但**字幕/站点抓取会被浏览器 CORS 拦**。Cloudflare Pages 多一个服务端函数做代理，功能才完整。两者都不花钱。

## 方式 A：Cloudflare Pages 连接 GitHub（最简单）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权 GitHub，选仓库 **`Keylee1989/avplay-plus`**
3. Build 设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**`/`**（根目录）
   - Root directory：**`/`**
4. **Save and Deploy**。完成后得到 `https://avplay-plus.<你的子域>.pages.dev`
5. 仓库里的 `functions/api/proxy.js` 会自动变成 `/api/proxy?url=…` 这个代理接口。

## 方式 B：本地 wrangler 部署

```bash
cd avplay_web
npm i -g wrangler
wrangler login
wrangler pages deploy . --project-name avplay-plus
```
按提示绑定账号后同样得到 `https://avplay-plus.pages.dev`。

## App 里启用代理（关键一步）

打开 App → **设置** → **CORS 代理**，填：

```
https://avplay-plus.<你的子域>.pages.dev/api/proxy?url=
```

注意结尾是 `?url=`，App 会把目标网址编码后接在后面。保存后：

- 32 源字幕并行搜索（迅雷 API / SubtitleCat / AVSubtitles / 直链站）走代理，不再被 CORS 拦；
- 站点"试抓取"能返回真实有/无结果；
- JavDB（`jdsignature` 签名接口）、JavRanking Worker 也走同一代理。

代理函数只转发 http(s)，并拒绝 localhost / 内网地址，安全上有边界。

## iOS 安装

两种地址都能装：

- GitHub Pages：`https://keylee1989.github.io/avplay-plus/`（无代理）
- Cloudflare Pages：`https://avplay-plus.<子域>.pages.dev`（带代理，推荐）

iPhone **Safari** 打开 → 底部分享 → **添加到主屏幕** → 点图标全屏运行。

## 文件对应关系

| 文件 | 作用 |
|---|---|
| `functions/api/proxy.js` | Pages Function：`/api/proxy?url=`，服务端跨域代理 |
| `js/core.js` → `AV.proxyUrl()` | 把用户填的代理前缀拼到请求 URL 上 |
| 设置页 CORS 代理输入框 | 填上面的代理地址 |
| `capacitor.config.json` / `build-ios.sh` | 可选：Mac 上打包成真 IPA |

## 已知限制

- 代理是公开接口（任何人可调用），别放敏感站点凭据。
- 某些站点有 Cloudflare 人机验证，代理也绕不过；App 会提示"需在浏览器完成验证"，不会伪造结果。
- 免费 Apple ID 侧载的 IPA 七天过期；PWA 没有这个限制。
