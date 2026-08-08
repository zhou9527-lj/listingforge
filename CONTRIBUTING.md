# Contributing to ListingForge

## 开发流程

1. 在独立分支中完成精确、小范围修改。
2. 不得提交 API Key、Token、用户素材、本地项目或系统凭据。
3. 提交前运行 `npm run check`。
4. 如果修改 Rust/Tauri，还需在对应平台运行 `cargo check` 或 `npm run tauri:build`。
5. 界面修改需附上实现截图，并更新 `docs/08-测试与验收/视觉保真记录.md`。

## 安全要求

- API Key 只能进入系统凭据库，不能进入源码、SQLite、日志、工程包或测试快照。
- 不得在浏览器模式伪造桌面命令成功。
- 新增付费 API 调用时，必须保留费用预览和用户确认。

## 文档

实现状态必须如实写入 `docs/00-项目总览/开发进度与AI交接.md`；尚未完成的功能不得写成已完成。
