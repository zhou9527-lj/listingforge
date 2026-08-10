# 商品图匠 · ListingForge

ListingForge 是面向 Windows 和 macOS 的本地 AI 电商图片工作台。用户上传主产品图与参考素材，选择中国主流电商平台、图片类型和尺寸后，由通义千问理解商品、DeepSeek Agent 规划方案，再调用 APIMart GPT-Image-2 生成系列图。

> 正式安装包已发布，最新版本 v0.1.5，见 [GitHub Releases](https://github.com/zhou9527-lj/listingforge/releases)（Windows x64 / macOS Intel / macOS Apple Silicon）。安装包尚未做商业代码签名与 Apple 公证，Windows SmartScreen 与 macOS Gatekeeper 可能提示风险，属已知项。已完成与待完成项以 [开发进度与 AI 交接](docs/00-项目总览/开发进度与AI交接.md) 为准。

## 主要特性

- Tauri 2 + React 19 + TypeScript + Rust + SQLite，项目与画布数据本地保存。
- 支持主图、Logo、包装、细节和风格参考素材。
- 支持淘宝/天猫、京东、拼多多、抖音、快手、小红书、微信小店和 1688 常用尺寸预设。
- 可选白底主图、场景主图、卖点海报、细节长图与自定义要求。
- Fabric.js 画布编辑，导出 PNG、JPG、WebP、PSD、`.listingforge` 工程包和长图。
- API Key 只保存到 Windows Credential Manager 或 macOS Keychain，不写入 SQLite 和日志。
- 付费生成前显示预估费用并要求二次确认。

## 本地开发

环境要求：Node.js 22+、npm 10+、Rust stable，以及 [Tauri 2 对应平台依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run dev
```

启动桌面调试应用：

```bash
npm run tauri:dev
```

运行前端完整校验：

```bash
npm run check
```

浏览器预览只用于界面开发，不会伪造密钥保存、API 连接或生成成功。真实云调用只能在 Tauri 桌面运行时执行。

## 文档

Obsidian 知识库入口为 [docs/README.md](docs/README.md)，包含产品、架构、API、安全、画布、测试与发布设计。

## 贡献与许可

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目以 [MIT License](LICENSE) 开源。
