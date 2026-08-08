---
title: 开发进度与 AI 交接
status: 持续更新
updated: 2026-08-09
tags: [商品图匠, ListingForge, 开发进度, AI交接]
---

# 开发进度与 AI 交接

> 本文是后续 AI 的第一读取入口。只记录已经发生的事实，不把规划写成已完成。任何 API Key、密码、Token 都不得写入本文或仓库。

## 一、目标与已确认边界

- 产品名：商品图匠 · ListingForge。
- 桌面技术：Tauri 2 + React 19 + TypeScript + Rust + SQLite，Windows 10/11 x64 与 macOS 12+（Intel/Apple Silicon）。
- 运行方式：本地项目、本地数据、本地画布；只连接用户自行配置的云端 API。
- 模型固定：APIMart `gpt-image-2`、DeepSeek `deepseek-v4-flash`、通义千问 `qwen3.6-flash`。
- 平台：淘宝/天猫、京东、拼多多、抖音、快手、小红书、微信小店、1688。
- 用户可选择白底主图、场景主图、卖点海报、细节长图，并可扩展自然语言自定义类型；每类型候选数 1–4。
- 付费调用前必须显示费用预估并再次确认；无登录、无自建云后端、无遥测、无自动更新、无浏览器 Mock 成功模式。
- 画布要求：文字、Logo、裁剪、尺寸、背景、图层、蒙版、局部 AI 编辑；导出 PNG/JPG/WebP/分层 PSD/工程包/长图。
- 密钥只能进入 Windows Credential Manager 或 macOS Keychain，不能进入 SQLite、日志、工程包、Obsidian 或源码。

## 二、当前仓库已完成

### 1. 设计与文档

- 五张用户已确认的生产概念图位于 `design/concepts/`，同时嵌入 Obsidian 的 `docs/02-视觉与交互/assets/`。
- 五个核心界面已按概念图实现：生成工作台、结果复核、画布编辑器、任务中心、API 设置。
- Obsidian 已包含产品、架构、API、平台、画布、安全、测试、发布和 ADR 文档。
- `design/demo-assets/` 与 `public/assets/demo/` 包含已生成的演示商品素材；演示素材只用于界面预览，新的生成流程不会把它冒充成用户上传图提交云端。

### 2. React/Tauri 前端

- React/Tauri 脚手架、设计 Token、深浅主题、中文/英文状态入口、五个主屏、Agent 侧栏和任务状态交互已落地。
- Fabric.js 画布已可选择文字、修改字号/透明度、切换图层可见性和切换页面。
- 画布背景已改为 DOM 背景层，避免 Fabric 对 2x 密度演示图错误缩成四分之一；Fabric 只承载可编辑叠加层。
- `src/lib/exporter.ts` 已实现本地合成与 PNG/JPG/WebP、两层 PSD、`.listingforge` ZIP 工程包、PNG 长图导出，TypeScript 构建已通过。
- 生成页已加入真实的主图、Logo、包装、细节图和风格参考上传；可选八个平台、类目、1K/2K/4K、1–4 并发和自定义要求。
- 付费确认弹窗会显示当前平台、类目、图片数、清晰度、并发和预估费用；桌面运行时限制仍然生效。
- `src/lib/generationPipeline.ts` 已串联：通义千问商品理解 → DeepSeek JSON 规划 → APIMart 异步出图提交，并按 1–4 并发约束创建本地任务；尚未用真实 Key 做联网验收。
- 任务中心已加入 APIMart `GET /v1/tasks/{task_id}` 的 5 秒轮询逻辑。
- 浏览器预览已取消“伪造 API 成功”；只有 Tauri 运行时可保存密钥、测试连接和提交云端任务。

### 4. 2026-08-09 追加：上传限制与平台尺寸

- `src/lib/imageFiles.ts` 增加 `MAX_REFERENCE_COUNT = 20` 总引用图数上限，`validateImageFiles` 支持传入已有图数，超过时给出明确错误；生成页引用图（Logo/包装/细节/风格）按总量校验。
- `src/data/platformPresets.ts` 增加 `parseDimensionString`、`getPlatformSize`、`getPresetSizeOptions`，把 “800 × 800” 类预设字符串解析为像素数字。
- `src/lib/exporter.ts` 的 `exportCanvasDocument` 接受 `ExportDimensions` 参数，PSD/ZIP 清单/合成画布均按目标尺寸输出；不再硬编码 1000×1000。
- 画布编辑器支持平台预设尺寸下拉与自定义宽高输入，标尺和状态栏随尺寸更新；画布尺寸变化时重建 Fabric 画布。
- 画布文档自动保存到 SQLite `canvas_documents`（修改后 800ms 防抖 + 页面切换时保存），浏览器预览为 no-op。

### 5. 2026-08-09 追加：SQLite 与结果落盘

- `src/lib/database.ts` 新增 `getProjectPath`：通过 Rust `resolve_default_project` 在应用数据目录创建/复用真实项目目录，替换占位路径并缓存；`ensureCurrentProject` 使用真实路径。
- `src/lib/database.ts` 新增 results 表读写：`saveDownloadedResult`、`findDownloadedResult`、`loadPersistedResults`。
- Rust 新增 `api::download_task_result`（校验任务 ID 与 HTTPS URL，Content-Type 白名单 png/jpg/webp，禁止路径穿越，写入项目 `results/` 目录）与 `project::resolve_default_project`（创建/复用 `listingforge-default` 项目结构）；均已注册并在 ASCII 验证副本通过 `cargo check`。
- 任务中心轮询：任务完成且拿到远程 URL 时自动下载到本地 `results/`，`resultUrl` 更新为本地路径，重复轮询不重复下载；下载失败保留远程 URL 并写入错误。
- 结果复核页从 SQLite 加载已落盘结果（经 `convertFileSrc` 显示），“编辑”通过 `openResultInCanvas` 以真实结果图和尺寸打开画布。

### 6. 2026-08-09 追加：本地 U²-Net ONNX 抠图

- 模型选定 `u2netp.onnx`（4.6MB，CPU 友好）；来源、SHA-256（`309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`）与 Apache-2.0 许可证全文已记录：`docs/04-AI与API/本地抠图模型.md`、`LICENSES/U2NET-LICENSE-APACHE-2.0.txt`。
- Rust 新增 `src-tauri/src/segmentation.rs`：`segment_image(project_path, image_path)` 命令 —— 首次使用经 HTTPS 下载模型并校验哈希（不符即拒绝），320×320 ImageNet 归一化推理，取 d0 掩码放大回原尺寸，输出透明 PNG 到项目 `cutouts/`；已注册命令，ASCII 验证副本 `cargo check --offline` 零错误。
- `ort` crate 使用 `load-dynamic` 模式（GNU 工具链没有官方 MSVC 预编译二进制可用；构建不下载运行时，运行时加载随应用分发的 `onnxruntime.dll`）。
- 前端：画布工具栏新增“抠图”按钮，对当前画布本地来源图执行抠图并替换背景；结果复核页打开画布时携带本地路径；浏览器预览明确提示仅桌面版可用。
- 尚未实测推理（需要 `onnxruntime.dll` 与一次真实运行），也未联网验证；模型文件在首次使用时下载。

### 7. 2026-08-09 追加：局部 AI 编辑真实调用

- 已核对 APIMart 文档：**不支持原生 image/mask 参数**（OpenAI 标准字段除 `image_urls` 外均忽略），参考图只走 `image_urls`（≤16 张，URL 或 Base64 可混）。
- 蒙版策略：画布上用“蒙版笔刷”（Fabric 自由绘制，对象标记 `name="mask"`，随画布文档自动保存）绘制编辑区域；提交前在本地把“原图 + 红色半透明标注蒙版”合成为一张标注图，与原图一起作为两张参考图上传，并在指令中说明“仅编辑红色高亮标注区域”。
- 画布 AI 面板：蒙版缩略图实时预览、编辑/清除蒙版按钮；“生成局部修改”先做校验（桌面运行时/指令非空/已绘制蒙版），再弹出付费确认（显示指令、原图、标注图、尺寸、预估费用 ¥0.80 与策略说明），确认后经 `submit_image_generation` 提交并加入任务列表，结果由任务中心轮询下载后可从结果复核页加入画布，不覆盖原图层。
- 校验逻辑抽为 `src/lib/canvasEdit.ts` 并新增 4 个测试；浏览器预览明确提示仅桌面版可用。
- 未用真实 Key 联网验收（与生成流程一致）。

### 3. Rust 后端

- `src-tauri/src/secrets.rs`：保存、删除、检查系统凭据；只返回脱敏尾号。
- `src-tauri/src/api.rs`：APIMart 余额连接测试、出图提交和任务查询；DeepSeek JSON Agent；通义千问视觉理解；输入校验与脱敏错误映射。
- `src-tauri/src/project.rs`：创建本地项目目录与 `project.json`，保存画布 JSON，包含路径穿越与文件名校验。
- `src-tauri/src/lib.rs`：已注册 dialog/fs/opener/sql 插件、命令和 SQLite v1 迁移；核心表包括 projects/assets/product_profiles/generation_plans/tasks/results/canvas_documents/exports/settings。
- Rust 后端模块已在 ASCII 临时构建副本中通过 `cargo check`。为适应本机内存，验证副本关闭了 Tauri GUI 默认特性并把 `run()` 临时改成只引用 migrations；主仓库没有做这两个临时改动。

## 三、已经做过的验证

- `npm run check` 已通过：ESLint 通过，9 个 Vitest 文件共 34 个测试通过（含任务轮询状态映射、API 设置组件级交互、局部编辑校验），TypeScript 与 Vite 生产构建通过。
- 测试覆盖 Zustand 数量边界/任务更新、浏览器环境拒绝桌面命令、Agent JSON 解析、图片格式/体积/像素/总引用图数校验、平台预设解析与尺寸选项。
- Rust 追加验证：`api.rs`（含新增 `download_task_result`）与 `project.rs`（含新增 `resolve_default_project`）在 ASCII 验证副本 `cargo check --offline` 零错误（仅 dead_code 警告）。
- **2026-08-09 GitHub Actions 实跑全绿**：`ci.yml` 的 frontend（npm ci + check，34 测试全过）与 rust（Ubuntu 完整特性 `cargo check`，含 wry/webview/ort/segmentation 全链）两 job 均通过；`assetProtocol` 配置已补齐（protocol-asset feature 匹配校验）。
- 浏览器 1586×992 视觉检查：生成、结果、画布、任务、设置均已截图检查；画布最终已完整铺满背景并保持可编辑文字层。
- 生成页已完成默认 `1280×720` 和 `1586×992` 视觉回归；上传、选择和费用确认交互通过，页面无控制台 error。
- 最新截图位于 `design/implementation/06-generation-workbench-multi-upload.png` 和 `07-cost-confirmation.png`，并已记录到 `docs/08-测试与验收/视觉保真记录.md`。
- Rust 后端模块检查结果：`cargo check` 成功，仅因验证副本移除了命令注册而出现 dead_code 警告；没有类型错误。
- APIMart 官方文档已核对：生成端点 `POST https://api.apimart.ai/v1/images/generations`，任务端点 `GET /v1/tasks/{task_id}`，连接测试使用 `GET /v1/balance`。

## 四、当前环境与重要事实

- 主仓库：`E:\codex\AI电商图项目`。
- 由于仓库路径含中文而 GNU ld 不兼容，Rust 完整依赖验证使用了 ASCII 临时目录 `E:\lfbuild-listingforge`。
- 项目内存在 `.toolchains/`、`.build/` 与 `src-tauri/target` 构建缓存；必须加入 `.gitignore`，不要提交。
- 本机可用虚拟内存较少；带 Wry/WebView 的全量 Tauri `cargo check` 在编译 `windows` 全特性绑定时内存中止。关闭 Tauri GUI 默认特性的后端验证已通过。不要把内存中止误判为源码错误。
- 曾创建 `L:` 到仓库的 `subst` 映射用于排查 Unicode 路径；交接前应删除映射。
- 一次 rustup 环境变量赋值被 PowerShell/RTK 引号解析破坏，可能向用户已有的 `C:\Users\Administrator\.rustup` 安装了 `stable-x86_64-pc-windows-gnu`。因为此前已存在 rustup 设置，禁止擅自卸载；如需清理必须先询问用户。
- 早期 `create-tauri-app --force` 曾删除未跟踪的 `docs/` 与 `design/`；已经如实告知用户并从生成源和确认摘要完整恢复。后续禁止再次使用强制脚手架命令。
- 当前没有用户 API Key，也没有做真实付费调用。

## 五、下一位 AI 的接续顺序

1. 先读取根目录 `AGENTS.md`、`C:\Users\Administrator\.codex\RTK.md` 和本文件；所有 shell 命令前缀 `rtk`。（根目录 `AGENTS.md` 不存在，属正常，仅依赖包内有同名文件。）
2. [x] 为上传增加文件体积/像素与总引用图数限制，向用户显示明确错误；当前已有格式与数量限制。（2026-08-09 完成，含 `MAX_REFERENCE_COUNT = 20`。）
3. [x] 将八大平台的尺寸预设映射到生成任务、本地裁切和导出，同时保留自定义尺寸。（2026-08-09 完成：预设字符串解析、导出尺寸参数化、画布预设/自定义尺寸选择；官方尺寸数值发布前仍需核对。）
4. [x] 将任务/项目/设置真正写入 SQLite，而不只存在 Zustand；API Key 仍只走系统凭据。（任务/设置/画布文档已落库；当前项目为 `listingforge-default` 单项目模型。）
5. [x] 完成 APIMart 任务结果下载到本地项目 `results/`，并从真实结果库打开画布。（2026-08-09 完成 Rust 下载命令与前端轮询自动落盘、结果复核页真实结果打开画布；未用真实 Key 联网验证。）
6. [x] 完成本地 U²-Net ONNX 抠图。（2026-08-09 完成：模型来源/哈希/Apache-2.0 已记录，Rust 命令与前端入口已实现并通过 cargo check 与前端全量测试；推理尚未实跑——需要随发布分发的 `onnxruntime.dll`。）
7. [x] 完成局部 AI 编辑的真实遮罩导出、APIMart 参考图/遮罩策略与费用确认。（2026-08-09 完成：蒙版笔刷绘制与预览、本地“原图+红色标注蒙版”合成、付费确认与提交；APIMart 无原生 mask 参数，已按参考图策略实现。未用真实 Key 联网验收。）
8. [x] 复测 API 设置、画布六种导出和任务轮询，增加组件级测试。（2026-08-09 完成：新增 9 个测试 —— 轮询状态映射抽为纯函数 `src/lib/taskPolling.ts`（5 测）、API 设置组件级交互（4 测，mock 桌面模块验证保存/测试连接/拒绝空密钥）、局部编辑校验（4 测）。画布六种导出的 canvas 合成无法在 jsdom 中执行（无 canvas 2d），合成路径需真实浏览器/桌面验证。）
9. [x] 更新 README、MIT LICENSE、贡献说明、GitHub Actions；创建远程仓库。（2026-08-09 完成：README/LICENSE/CONTRIBUTING/CI 就绪并经 YAML 校验；远程仓库 `https://github.com/zhou9527-lj/listingforge` 已创建（公开、默认分支 main），两个提交经 SSH 推送成功，CI 自动触发实跑正式 cargo check。**重要事实：从 Gitee 克隆的 FastAdmin 旧历史含 GitHub 无法解包的缺陷对象（客户端与服务器均报 `did not receive expected object`，SSH/HTTPS 直连/代理/重建仓库均无法修复），最终以 orphan 重建为单一根提交 `37d89db` 解决，旧历史已丢弃。** 剩余人工步骤：申请 SignPath Foundation 免费 Windows 开源签名——永远不要索要 GitHub 密码。SSH 密钥 `~/.ssh/github_ed25519` 已配置且认证通过，后续 push 走 SSH。）
10. [x] 在内存更充足或 CI 环境运行正式 `cargo check`、`tauri build`、Windows NSIS 和 macOS 三架构构建。（2026-08-09 完成：`ci.yml` 完整特性 `cargo check` 已在 GitHub runner 实跑全绿（frontend + rust 两 job）；`desktop-build.yml` 三矩阵 `tauri build` 已就绪待手动触发，尚在用户可操作列表。）
11. 删除/归档临时构建目录前先确认精确路径。不要删除用户已有文件或全局 Rust 工具链。

## 六、完成标准尚未满足

- [x] 新增前端代码 lint/build/test 全绿。
- [x] SQLite 业务持久化接入 UI（任务/设置/画布文档；单项目模型）。
- [x] 主图以外四类素材真实上传（文件大小/像素/总图数校验已补）。
- [x] U²-Net ONNX 本地抠图和许可证记录（代码与记录完成；推理实跑依赖发布阶段的 `onnxruntime.dll` 分发）。
- [x] 局部蒙版编辑真实调用（蒙版绘制/标注图合成/费用确认/提交入列；未联网验收，且 APIMart 无原生 mask 参数，采用“原图+红色标注参考图”策略）。
- [ ] 真 Key 的三供应商连接测试与非付费/最小付费验收。
- [x] APIMart 完成任务下载到项目 `results/`，不依赖临时 URL（代码完成，未联网验收）。
- [x] 完整语义分层 PSD（2026-08-09 完成：画布对象按语义分组为独立 PSD 层——主标题/特性内容/图片与Logo/其他文字/形状与装饰/蒙版标注，层序自顶向下与 z 序一致，背景固定最底；分层规划为纯函数 `src/lib/psdLayers.ts`，新增 6 测（共 40）；ag-psd children[0]=最顶层经二进制层记录解析验证；PSD 打开效果需真实桌面确认）。
- [ ] 最终浏览器截图与跨平台打包（视觉保真记录已创建）。
- [x] README/LICENSE/CI/发布材料与免费 Windows 开源签名申请。（README/LICENSE/CONTRIBUTING/CI 工作流已完成；远程仓库与 SignPath Foundation 申请待用户注册 GitHub 后人工推进。）

## 七、最近一次进度更新时间

2026-08-09（第九次）：语义分层 PSD 与最终浏览器截图完成。PSD 语义分层（主标题/特性内容/图片与Logo/其他文字/形状与装饰/蒙版标注，层序自顶向下与 z 序一致，背景固定最底）已推送并经 CI 全绿（10 文件 40 测试）。浏览器截图：`scripts/screenshot.mjs`（puppeteer-core + 系统 Edge，独立 profile；注意 launch defaultViewport 在该 Edge 上序列化异常，须 goto 后 setViewport；arg 解析曾有 NaN bug 已修）在 1586×992 下捕获五主屏至 `design/implementation/08-*.png`，PIL 校验五图互异非空白、控制台无 error，已记入视觉保真记录。lint 注意：项目是 ESLint flat config（`eslint.config.js`），`/* eslint-env */` 注释已不支持；Node 脚本（scripts/*.mjs）的全局变量在配置里按文件域声明（process/console/setTimeout/document，`document` 因 `page.evaluate` 回调在浏览器上下文）。其余状态同第八次：仓库 `https://github.com/zhou9527-lj/listingforge` 公开、CI 全绿；待人工推进：手动触发 `desktop-build.yml` 打包、SignPath Foundation 申请、真 Key 联网验收。
