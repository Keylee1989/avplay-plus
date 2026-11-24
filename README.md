# AvPlay 2.2.0 逆向分析 + 网页版实现

本目录用 Python 标准库 + hls.js 复刻了 AvPlay 2.2.0 桌面版的**本地 HLS 网关**与**资源解析**，
并附上了对 `AvPlay.exe` 的完整分析。

---

## 一、AvPlay.exe 到底是什么

`AvPlay.exe` 只有 808 KB，它**不是播放器**，而是 jpackage 生成的原生启动器：

```
AvPlay.exe
  ├─ 读取同目录 app/AvPlay.cfg
  │    [Application]
  │    app.mainclass = com.javrocket.playground.MainKt
  │    app.classpath = desktopApp-*.jar, composeApp-desktop-*.jar, ... (120+ 个 jar)
  │    [JavaOptions]
  │    -Dcompose.application.resources.dir=...
  │    -Dskiko.library.path=...
  ├─ 加载 runtime/lib/jvm.dll        （jpackage 打包的 JBR 21 Windows x64）
  └─ 启动 Kotlin/Compose Desktop 应用
```

| 路径 | 作用 |
| --- | --- |
| `AvPlay.exe` | jpackage 原生启动器 |
| `runtime/` | 捆绑的 JBR 21 JRE（`bin/server/jvm.dll` 等） |
| `app/desktopApp-*.jar` | 桌面入口与窗口代码（`MainKt`、无边框窗口、单实例锁） |
| `app/composeApp-desktop-*.jar` | **全部业务代码**，包名 `com.javrocket.playground`，内含 `native/windows-x64/avplay_player.dll` |
| `app/core-common-2.2.0-*.jar` | 仅 androidx 工具类 |
| 其余 jar | Compose、Ktor、OkHttp、JNA、Skiko、Room、Coil、wrywebview 等依赖 |

技术栈：Kotlin Multiplatform + Compose Desktop + Ktor/OkHttp + Room + Skiko + JNA + wry(Rust WebView)。

---

## 二、启动链（哪一步跳哪一步）

```
AvPlay.exe
  └─ MainKt.main(args)
       ├─ DesktopSingleInstanceLock.acquire()         单实例锁（重复启动直接退出）
       ├─ startDesktopUiThreadStallMonitor()          UI 卡死监控线程（250ms 阈值）
       ├─ desktopWindowPreset(args)                   解析 --window-preset=large|...
       ├─ DesktopWindowChromeKt.configureDesktopWindowChrome()
       └─ application { Window { AppKt.App(...) } }   进入 Compose 桌面 UI
```

`MainKt` 里还有大量测试参数（`--test-route=`、`--test-url=`、`--test-av-id=`、
`--test-playback-provider=` 等），桌面端内置了 E2E 播放诊断（`DesktopPlaybackTestAutomation`、
`PlaybackDiagnosticReport`），可以用命令行直接跑自动化播放验证。

---

## 三、资源是怎么获取的

`ServiceManager`（单例）是所有服务的总入口，管理 15+ 个服务：

| 类别 | 服务 |
| --- | --- |
| 元数据/列表 | `javdb`（`JavDbService`/`JavDbRepository`/`JavDbApiService`）、`javlibrary`、`avdb`、`missav`、`memojav`、`javmenu`、`xchina`、`sgpi`、`javrocket` |
| 自有源 | `HuangGuoService`（JSON API，`GET /api/videos/{id}/play?episode=n` → `data.video_url`） |
| 聚合播放 | `PlaybackAggregatorService`（jav.gg / jav.guru：抓搜索页 → 递归解析 iframe / 播放器页） |
| 磁力/网盘 | `btdigg`、`xcili`、`whatslink` |

### 在线点播的 8 个平台

`OnlinePlaybackSourceProviderRegistry.createDefault()` 注册：

```
avdb · javmenu · memojav · missav · jable · av01 · jav.gg · jav.guru
```

每个 provider 的 `discover(context, avId)` → `resolve(context, version)` 流程：

1. 按平台规则拼搜索 URL（如 `MissAvUrlUtilsKt.missAvSearchUrl()`、
   `PlaybackAggregatorService.searchUrl()` = `{base}/?s={avId}`）
2. 用 `SessionWebView`（wry WebView）打开页面
3. 注入 JS 嗅探网络请求 / 解析 HTML，得到 `OnlinePlaybackVersion`（含真实 pageUrl）
4. `resolve()` 再打开详情页，嗅探出媒体 URL（主清单 / 直链 / iframe 提升），
   组装成 `PlaybackPlan`（`List<PlaybackLine>`）
5. 每条 `PlaybackLine` = `{ id, title, source(url+mime), transport(headers+规则+凭证+网关开关) }`

自有源（黄果）不需要 WebView，直接 HTTP 调 API 拿 `video_url` 和所需 headers。

---

## 四、播放是怎么实现的

```
UI 点击播放
  └─ VideoPlayerController.prepare(lines, selectedLineId, startPosition, playWhenReady)
       └─ inspectManifest() → PlaybackManifestRepository.inspect()   （缓存 + 单飞）
            └─ KtorPlaybackManifestLoader.load()                     （Ktor/OkHttp 拉 m3u8，带 headers/cookie）
                 └─ 若 transport.useLocalGateway = true
                      └─ DesktopPlaybackGatewaySession                （本地 127.0.0.1 HTTP 网关）
                           ├─ register(url)   真实 URL → http://127.0.0.1:<port>/<sessionKey>/<id>
                           ├─ handle(exchange) 接请求 → proxy() OkHttp 转发 + 注入 headers
                           ├─ rewriteHlsManifest()  把 variant/切片/密钥 URI 改写为网关地址
                           ├─ desktopFilterHlsMaster()  按清晰度过滤主清单
                           └─ 重试 / seek 恢复窗口 / 重试预算
                                └─ MediaPlayer.prepare()  ── JNA ──▶ avplay_player.dll
                                     ├─ avplay_create()
                                     ├─ avplay_open(handle, gatewayUrl, startMs, play)
                                     ├─ avplay_play() / avplay_seek() / avplay_rate()
                                     ├─ avplay_frame()  → 帧拷到 Skia Bitmap
                                     │     └─ DesktopFramePool → Image → Compose Canvas 绘制
                                     ├─ avplay_snapshot()      读位置/时长/缓冲/状态
                                     └─ avplay_diagnostics()   读诊断数据
```

要点：

- **原生引擎**：Windows = Media Foundation，macOS = AVPlayer（`DesktopNativeLibrary.getEngineName()`）。
- **画面渲染**：不是原生窗口叠加，而是 `avplay_frame()` 把每帧拷进 Skia 位图，
  交给 Compose 的 `Canvas` 绘制（`MediaPlayer_desktopKt.MediaPlayerSurface`）。
- **UI 状态**：`VideoPlayerController` 用 `StateFlow` 暴露
  `isPlaying / currentPosition / duration / playbackState / playError / sessionState`，
  控制条、进度条、倍速、清晰度切换都在 Compose 侧。
- **网关存在的意义**：很多源要求 `Referer` / `User-Agent` / 自定义头，
  浏览器和原生播放器直接请求会被 403；网关在本地代理并注入这些头，
  同时把清单里的相对地址改写成网关地址，让所有切片也带上正确的头。

---

## 五、网页版实现（本目录）

| 桌面端 | 本目录对应 |
| --- | --- |
| `PlaybackManifestRepository.inspect()` | `/api/play`（拉清单、解析、过滤） |
| `DesktopPlaybackGatewaySession.register()` | `Session.register()` |
| `DesktopPlaybackGatewaySession.handle()` | `/gw/<sid>/<rid>` |
| `DesktopPlaybackGatewaySession.rewriteHlsManifest()` | `rewrite_manifest()` |
| `DesktopPlaybackGatewayKt.desktopFilterHlsMaster()` | `filter_master()` |
| `HuangGuoService.getPlayback()` | `/api/resolve?source=huangguo` |
| Media Foundation / AVPlayer | hls.js（MSE） |

### 运行

```bash
python gateway_server.py --host 127.0.0.1 --port 8765
# 浏览器打开 http://127.0.0.1:8765/
```

依赖：Python 3.8+（仅标准库），`hls.min.js` 已放在同目录（离线可用）。

### 两种用法

1. **直接地址**：粘贴任意 M3U8 地址 + 请求头（JSON），点播放。
   网关会注入请求头、改写清单、按清晰度过滤，hls.js 负责解码。
2. **API 解析**：填 huangguo 风格接口的 `Base URL`、`视频 ID`、`分集`，
   服务端调 `{base}/api/videos/{id}/play?episode=n` 取 `data.video_url`，再走网关。

也可以直接双击 `player.html`（此时网关地址默认 `http://127.0.0.1:8765`），
但**必须先在另一个终端启动 `gateway_server.py`**，否则无法注入请求头/改写清单。

### 文件

```
avplay_web/
  gateway_server.py   本地网关 + 解析 API（Python 标准库）
  player.html         播放页面（内联 CSS/JS）
  hls.min.js          hls.js 1.5.20（本地，离线可用）
  avplay_cli.py       命令行资源解析 + mpv 播放（无需浏览器）
  DEPLOY.md           部署到 Cloudflare Workers / GitHub Pages 的说明
  deploy/cloudflare/  Cloudflare Workers 部署（页面+网关一体，HTTPS）
  README.md           本文件
```

---

## 六、没有复刻的部分（局限）

- **8 个平台的 WebView 嗅探发现**：桌面端用 wry WebView 打开搜索页/详情页、
  注入 JS 抓媒体请求。网页版目前只提供「直接地址」和「huangguo 风格 API」两种入口。
  要加新平台，可以在 `gateway_server.py` 里仿照 `resolve_huangguo()` 加一个 resolver，
  返回 `{url, headers}` 后交给 `build_play_response()`。
- **磁力/网盘**（btdigg / xcili / whatslink）未实现。
- **AES-128 密钥**由 hls.js 自己请求（已改写成网关地址，密钥请求同样带 headers）。
- 网关默认只监听 `127.0.0.1`，仅本机可用；如需局域网访问，用 `--host 0.0.0.0`
  并自行加访问控制。

---

## 七、部署到免费平台 / 命令行使用

- 想随时随地用（手机/别的电脑都能开）→ 见 **DEPLOY.md**：
  - Cloudflare Workers 免费部署（页面+网关一体，HTTPS 地址）
  - GitHub Pages 纯静态托管
- 不用浏览器，在终端直接播放 → `avplay_cli.py`：

```bash
python avplay_cli.py search "SSIS-001" --source huangguo
python avplay_cli.py play "SSIS-001" --source javgg --print
python avplay_cli.py play 123456 --source huangguo --episode 1 --mpv
```

## 八、验证

`gateway_server.py` 已用假源站端到端验证过：

- 源站不带 `X-Test-Auth` 头返回 403，带headers 返回 200 → 证明网关注入了请求头
- 主清单的 variant URI 被改写成 `/gw/<sid>/<rid>`
- 媒体清单的切片、`#EXT-X-KEY` URI 被改写
- `maxheight=720` 时只剩 720p 一档
- 非清单（直链文件）识别为 `file` 并直接代理
