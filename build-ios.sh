#!/bin/bash
# 在 Mac 上执行：把本目录打包成可侧载的 IPA
# 用法： bash build-ios.sh
set -e
cd "$(dirname "$0")"
echo "==> 1/5 初始化 Capacitor"
if [ ! -f package.json ]; then npm init -y; fi
npm i --save @capacitor/core @capacitor/cli @capacitor/ios
if [ ! -f capacitor.config.json ]; then
  npx cap init "AvPlay+" com.avplay.plus --web-dir=.
fi
echo "==> 2/5 添加 iOS 平台"
if [ ! -d ios ]; then npx cap add ios; fi
npx cap sync ios
echo "==> 3/5 打开 Xcode（在 Signing 里选你的 Personal Team / 免费 Apple ID）"
open ios/App/App.xcworkspace
echo "==> 4/5 在 Xcode 里：Product → Archive → Distribute App → Development → 导出 IPA"
echo "==> 5/5 用 AltStore / Sideloadly / 爱思助手（同一个免费 Apple ID）把 IPA 装到手机"
echo "完成。免费账号签名 7 天过期，AltStore 可自动续签。"
