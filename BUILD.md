# AvPlay+ 构建与安装说明

## 已冻结的决定（2026-11-24 确认）

1. 需求以用户消息里的资源清单 + 4.1–4.16 功能清单为准；需求文档本机不存在，不再等。
2. 脚本用当前这份 `手艺活v1.3.user.js`（内部 v6.40.27 / 4,045,876 字节）为唯一事实源。
3. JavRanking 33,523 快照、javtool 演员/作品数据本机没有 → 只做接口占位，不编造数字。
4. IPA 交付形态：PWA 装 iOS（免签名、免 Mac、$0）；另给 Mac 上一键构建 IPA 的源码工程与脚本，用户自己侧载。
5. 两个参考 IPA（AvPlay 2.2.2、Insav 1.3.0）都是编译好的原生二进制，无法靠替换文件加功能，也没有公开源码，故不作为改造对象；只作产品形态参考。

## 这是什么 / 不是什么

- **是**：一个全新的 Web/PWA App，资源与功能以你提供的 `手艺活v1.3.user.js`（内部 v6.40.27）为唯一事实源。
- **不是**：对 `AvPlay-2.2.2.ipa` 的反编译或修改。那个 IPA 是编译好的 Kotlin/Compose 原生 App，功能写死在二进制里，无法靠替换文件加功能，也无法在本机（Windows、无源码、无签名证书）重签。

脚本资源已 1:1 抽出：**99 站**（68 播放 / 13 资料 / 3 磁力 / 15 字幕）、**32 字幕源**、**LTX 4310 部**、JavDB / JavRanking / 迅雷字幕接口。没有编造任何站点或结果。

---

## 路线 A：直接在 iOS 上安装（免签名、免 Mac、$0）— 推荐先这样用

PWA 需要一个 **HTTPS 地址**。最快的方式是 GitHub Pages（免费、无需绑卡）：

1. 把本目录所有文件上传到你的 GitHub 仓库（公开仓库即可）。
2. 仓库 → Settings → Pages → Source 选 `main` / `root` → 保存。
3. 得到地址 `https://<用户名>.github.io/<仓库名>/`。
4. iPhone/iPad 用 **Safari** 打开该地址 → 底部分享按钮 → **添加到主屏幕**。
5. 主屏幕出现 "AvPlay+" 图标，点开即全屏 App，和原生体验基本一致；无需 App Store、无需签名、无需付费。

> 注意：必须用 Safari 添加；微信/Chrome 里没有"添加到主屏幕"。

本地测试（电脑和手机同一 Wi‑Fi）：在本目录运行 `python -m http.server 8000`，手机访问 `http://<电脑IP>:8000`。HTTP 下 PWA 安装和 Service Worker 受限，正式使用请走 HTTPS。

---

## 路线 B：打包成真正的 IPA（在 Mac 上，$0 侧载）

### B1. 准备（一次性）
- 一台 Mac（或借用/租一台，或用 GitHub Actions 的 macOS 运行器——见 B2）。
- Xcode（App Store 免费下载）。
- 一个**免费 Apple ID**（不需要开发者账号、不需要 $99、不需要身份证、不需要绑卡）。

### B2. 用 GitHub Actions 云端构建（没有 Mac 也能出 IPA）
1. 把本目录上传到公开 GitHub 仓库。
2. 在仓库 Settings → Secrets and variables → Actions 添加：
   - `BUILD_CERTIFICATE_BASE64`：从 Mac 钥匙串导出的个人开发证书（.p12 转 base64）。
   - `P12_PASSWORD`、`BUILD_PROVISION_PROFILE_BASE64`、`KEYCHAIN_PASSWORD`。
   - 这些需要一次性在 Mac + 免费 Apple ID 上从 Xcode 生成（Xcode → Preferences → Accounts → 加 Apple ID → Personal Team → 下载签名文件）。
3. 新建 `.github/workflows/build-ios.yml`，用 `macos-latest` 运行器执行 `npm i -g @capacitor/cli && npx cap add ios && xcodebuild archive && xcodebuild -exportArchive`，产物上传为 Artifact（IPA）。
4. 下载 IPA，用 AltStore / Sideloadly / 爱思助手（免费 Apple ID 签名）装到手机。

> 免费 Apple ID 签名的 App **7 天过期**，需要每周重签一次（AltStore 可自动续签）。这是苹果的规则，和 App 本身无关。

### B3. 本地 Mac 构建步骤（已准备好一键脚本）
```bash
cd avplay_web
bash build-ios.sh
```
脚本会初始化 Capacitor、添加 iOS 平台并打开 Xcode。在 Xcode 里：
- Signing → Team 选你的 Personal Team（免费 Apple ID）
- Product → Archive → Distribute App → Development → 导出 IPA

然后用 AltStore / Sideloadly 用同一个免费 Apple ID 签名安装。

> 不需要改 AvPlay 二进制；这个 IPA 是我们自己的工程产物，包名 `com.avplay.plus`，和原 IPA 的 `com.javdb.avplay2` 不同，不会冲突。

---

## 功能清单（对应脚本）

| 脚本/需求功能 | 本 App 实现 |
| --- | --- |
| 聚合首页 | 99 站分组筛选、全部打开、试抓取（失败明确提示，不伪造） |
| 字幕 32 源并行 | 迅雷 / SubtitleCat / AVSubtitles / 5 个直链站 + LTX 置顶，并行 + 6s 超时 |
| 排序规则 | LTX 置顶 → 非迅雷优先 → 精确匹配 → 中文优先（照脚本原文） |
| 字幕预览/下载/加载/对齐/导出 | 字幕面板全有；SRT/VTT 解析、偏移、字号、导出 |
| 播放器 | 多线路、断点续播、重试、倍速、画质、PiP、全屏、小窗、手势 |
| 金钮 + 快捷条 | 右下角金钮展开/收起，含首页/字幕/片库/收藏/复制番号/小窗 |
| 10 页签主面板 | 顶部 10 页签 + 底部 5 键导航 |
| 收藏 / 记录 / 冲码 | 本地存储；冲码走 JavRanking Worker 的 `/api/chong` |
| JavDB | `jdforrepam.com` 原接口 + `jdsignature` 签名 |
| LTX 4310 部 | 本地秒搜、分页浏览、详情（封面/演员/磁力/字幕直链） |
| JavRanking | `app.keylee.eu.cc/api/ranking` 榜单 / 单条 / 批量 |
| 广告拦截 | 拦截弹窗与常见广告域名（开关在设置） |
| 资源导入 | 自定义站点 / 字幕源 / 线路 JSON 导入导出 |
| 遥测 | **无**。没有 Firebase / Mixpanel（原 IPA 自带这两个，本 App 不含） |

---

## 已验证 / 未验证

- **已验证**：脚本资源抽取（99 站 / 32 源 / 4310 条 LTX 数量与原文一致）；JS 语法（构建后 node --check）；站表/字幕源原文逐条复制。
- **未验证 / 依赖环境**：
  - 各站点的实际搜索结果、字幕直链有效性——这些站会变动，且浏览器跨域经常被 CORS 拦截。失败时 App 会明确提示并给"打开站点"按钮，不会伪造结果。
  - JavDB / 字幕 API 的跨域请求——建议在设置里配置一个 CORS 代理（如 `https://corsproxy.io/?`）。
  - iOS 真机安装与全屏播放——需要你按上面路线 A/B 实操后反馈。
  - 我没有在 Mac 上跑过 Xcode，也没有你的 Apple ID，所以**无法在这里产出已签名的 IPA**；上面的步骤是标准流程，照做即可。

---

## 文件结构

```
index.html          应用外壳（10 页签）
manifest.webmanifest / sw.js / icon.svg   PWA 安装与离线缓存
css/app.css         全部样式
js/core.js          工具函数 / 设置 / 收藏历史
js/data.js          99 站 + 32 字幕源 + 接口（由脚本抽出）
js/ltx.js           LTX 4310 部（由脚本抽出）
js/subtitles.js     字幕搜索 / 排序 / 解析 / 挂载 / 导出
js/player.js        播放 / 线路 / 断点 / PiP / 小窗 / 手势
js/search.js        聚合 / LTX 检索 / JavDB / JavRanking / 冲码
js/app.js           UI 装配与交互
source_script.user.js  事实源（你提供的脚本原文副本）
data_*.json         抽出的原始数据（可校验）
extract_data.js / generate_data.js  抽取脚本
capacitor.config.json  iOS 打包配置
```
