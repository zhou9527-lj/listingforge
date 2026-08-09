---
title: 开发进度与 AI 交接
status: 持续更新
updated: 2026-08-09
tags: [商品图匠, ListingForge, 开发进度, AI交接]
---

# 开发进度与 AI 交接

> 本文是后续 AI 的第一读取入口。只记录已经发生的事实，不把规划写成已完成。任何 API Key、密码、Token 都不得写入本文或仓库。
> **永久规则：每次代码或界面改动后，都必须把本次变动的所有内容同步写入本文与相关 docs（需求规格/界面规划/前端实现规格等），文档只记录事实。**

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
- 八个屏幕已实现：项目管理器、素材库、生成工作台、结果复核、画布编辑器、导出中心、任务中心、设置。
- Obsidian 已包含产品、架构、API、平台、画布、安全、测试、发布和 ADR 文档。
- 演示素材已全部移除（第十次改造：`public/assets/demo/` 五张演示图与 `design/demo-assets/` 不再作为产品素材；应用默认空白项目启动，无任何演示图片）。

### 2. React/Tauri 前端

- React/Tauri 脚手架、设计 Token、深浅主题、中文/英文状态入口、八个屏幕（项目管理器/素材库/生成/结果/画布/导出中心/任务中心/设置）、Agent 侧栏和任务状态交互已落地。
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

### 8. 2026-08-09 追加：九项改造（多项目 / 素材库 / 导出中心 / 计费重构 / 空白默认 / 设置完善）

一次九项改造全部落地并推送（提交 `abd0b5e` 九项改造、`4e8628f` 移除演示图片），CI 前端 + Rust 检查全绿（run 31292473161 success，40 测试）。

1. **多项目管理（数据层）**：SQLite v2 迁移 `migrations/0002_add_projects.sql` 新增 projects 表；Rust `project.rs` 新增 `create_project` / `list_projects` / `get_project_record` / `rename_project` / `delete_project`，模块级 `activeProjectId` 决定当前项目；Zustand persist `currentProject`，旧版 `current-project` 单项目兼容自动打开。
2. **项目管理器（新屏幕）**：`src/screens/Projects.tsx` —— 真实创建（Rust `create_project` + SQLite INSERT）、重命名、删除（可选删除目录）、打开；顶栏「新建项目」经 `openProjectCreator` 打开创建对话框；未打开项目时默认进入本屏。
3. **素材库（新屏幕）**：`src/screens/Materials.tsx` —— 按角色（product/logo/package/detail/style）分组导入（文件选择 → `importAsset` → `addAssetRecord`），`convertFileSrc` 预览，删除，空项目空状态。
4. **导出中心（新屏幕）**：`src/screens/ExportCenter.tsx` —— 导出画布文档（`loadCanvasDocumentRecord("main")` → plugin-fs writeFile → sha256 → `addExportRecord`）与已下载结果图片（copyFile + hash）；历史列表含删除。
5. **Agent 面板真实化**：`src/components/AgentPanel.tsx` 重写 —— 原为静态 mock；现真实调用 `runDeepSeekAgent`（规划）与 `analyzeProduct`（商品理解，读本地结果文件转 dataURL）；步骤/消息/计划详情/评审结果均为真实状态。
6. **计费重构（按 API 提供方实际扣费）**：`src/lib/billing.ts` 新增 —— `parseCostValue`（解析「¥0.1234」）、`estimateUnitPrice`（已完成任务实际扣费均值回推单张单价）、`formatYuan`；生成工作台页脚与确认弹窗费用改为回推预估（无数据时显示「生成后按实际扣费显示」），弹窗新增「计费明细」行（APIMart 图像生成预估 + 通义/DeepSeek 按各自实际扣费记录）；状态栏与设置页三家服务商余额分开显示（store `providerBalances`，测试连接时捕获，DeepSeek/通义无余额接口显示 —）；任务中心「消耗」列显示真实扣费（taskPolling 的 `¥{cost.toFixed(4)}`）。
7. **预算与配额全部移除**：生成页/任务中心预算面板、配额弹窗、`budget-panel`/`budget-alert` CSS 全部删除；Agent 系统提示词不再约束预算；文档同步（需求规格/范围与成功标准/前端实现规格/界面概念评审/DeepSeek与通义千问/最终方案）。
8. **默认空白项目**：`public/assets/demo/` 五张演示图删除；`src/data/demo.ts` 只保留生成类型与 API 提供方；结果复核/任务中心/画布全部空状态；store 初始 tasks/selectedResults 为空。
9. **设置页 6 tab 真实化**：`src/screens/ApiSettings.tsx` —— api（密钥/测试连接/余额）、defaults（生成默认值读写 SQLite settings）、storage（路径 + 打开目录）、appearance（主题/语言）、privacy（清除画布文档/导出记录/重置界面）、about（版本 + 打开仓库）；原先无反应的控件全部接通。
10. **任务中心**：真实计数（进行中/等待/已完成/失败）、项目范围显示当前项目、提交时间改为用时、移除预算面板。

### 9. 2026-08-09 追加：删除应用内部顶栏

- 用户在桌面截图中用红框指定删除整条应用内部顶栏。`src/components/AppShell.tsx` 已删除 `header.topbar` 及品牌/项目名/新建/保存/设置/菜单/内部窗口控制内容和关联状态。
- `src/styles/layout.css` 已移除 50 px 顶栏行与专用样式，主内容直接从系统原生标题栏下方开始；狭窗口遮罩的上边界也已改为 0。
- 保留入口：项目页“新建项目”、左侧“任务/设置”导航、画布/项目自动保存。
- 验证：本次文件 ESLint 通过，`tsc --noEmit` 通过，Vitest 串行执行 11 文件/45 测试全过。`npm run check` 首次在 ESLint 阶段因本机内存不足中止，停止本任务早先启动的 Vite 进程后分项检查成功；不是代码错误。
- 浏览器实测 `.topbar = 0`、控制台无 error，截图已保存为 `design/implementation/13-projects-without-internal-topbar.png`。

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
- 本机前端工具链同样不稳定：vitest worker 偶发崩溃（用 `npx vitest run --no-file-parallelism` 绕过，10 文件 40+5 测试全过）、`npm run check` 中 vite build 的 esbuild Go 二进制偶发 Go runtime panic（拆成 `npx eslint src` + `npx tsc --noEmit` + `npx vitest run --no-file-parallelism` 分别验证）。CI（GitHub Actions）为权威验证通道。
- 曾创建 `L:` 到仓库的 `subst` 映射用于排查 Unicode 路径；交接前应删除映射。
- 一次 rustup 环境变量赋值被 PowerShell/RTK 引号解析破坏，可能向用户已有的 `C:\Users\Administrator\.rustup` 安装了 `stable-x86_64-pc-windows-gnu`。因为此前已存在 rustup 设置，禁止擅自卸载；如需清理必须先询问用户。
- 早期 `create-tauri-app --force` 曾删除未跟踪的 `docs/` 与 `design/`；已经如实告知用户并从生成源和确认摘要完整恢复。后续禁止再次使用强制脚手架命令。
- 当前没有用户 API Key，也没有做真实付费调用。

## 五、下一位 AI 的接续顺序

0. **当前状态速览（2026-08-09 第二十三次）**：0.1.4 功能交付已完成（生成页素材持久化与恢复、结果页去重、结果/任务删除、画布三功能），本地 `npm run check` 全绿、click-smoke 8 屏零付费调用通过、cargo check 通过；改动（含第二十二次的项目页挂起修复与提示词优化）已提交推送，本机 NSIS 打包结果见第七节第二十三次记录。待人工推进：真 Key 三供应商联网验收（余额/费用列才出真实数字）、SignPath Foundation 申请、0.1.4 安装包发布。

1. 先读取根目录 `AGENTS.md`、`C:\Users\Administrator\.codex\RTK.md` 和本文件；所有 shell 命令前缀 `rtk`。（根目录 `AGENTS.md` 不存在，属正常，仅依赖包内有同名文件。）
2. [x] 为上传增加文件体积/像素与总引用图数限制，向用户显示明确错误；当前已有格式与数量限制。（2026-08-09 完成，含 `MAX_REFERENCE_COUNT = 20`。）
3. [x] 将八大平台的尺寸预设映射到生成任务、本地裁切和导出，同时保留自定义尺寸。（2026-08-09 完成：预设字符串解析、导出尺寸参数化、画布预设/自定义尺寸选择；官方尺寸数值发布前仍需核对。）
4. [x] 将任务/项目/设置真正写入 SQLite，而不只存在 Zustand；API Key 仍只走系统凭据。（任务/设置/画布文档已落库；2026-08-09 已改造为多项目模型，见第二节之 8。）
5. [x] 完成 APIMart 任务结果下载到本地项目 `results/`，并从真实结果库打开画布。（2026-08-09 完成 Rust 下载命令与前端轮询自动落盘、结果复核页真实结果打开画布；未用真实 Key 联网验证。）
6. [x] 完成本地 U²-Net ONNX 抠图。（2026-08-09 完成：模型来源/哈希/Apache-2.0 已记录，Rust 命令与前端入口已实现并通过 cargo check 与前端全量测试；推理尚未实跑——需要随发布分发的 `onnxruntime.dll`。）
7. [x] 完成局部 AI 编辑的真实遮罩导出、APIMart 参考图/遮罩策略与费用确认。（2026-08-09 完成：蒙版笔刷绘制与预览、本地“原图+红色标注蒙版”合成、付费确认与提交；APIMart 无原生 mask 参数，已按参考图策略实现。未用真实 Key 联网验收。）
8. [x] 复测 API 设置、画布六种导出和任务轮询，增加组件级测试。（2026-08-09 完成：新增 9 个测试 —— 轮询状态映射抽为纯函数 `src/lib/taskPolling.ts`（5 测）、API 设置组件级交互（4 测，mock 桌面模块验证保存/测试连接/拒绝空密钥）、局部编辑校验（4 测）。画布六种导出的 canvas 合成无法在 jsdom 中执行（无 canvas 2d），合成路径需真实浏览器/桌面验证。）
9. [x] 更新 README、MIT LICENSE、贡献说明、GitHub Actions；创建远程仓库。（2026-08-09 完成：README/LICENSE/CONTRIBUTING/CI 就绪并经 YAML 校验；远程仓库 `https://github.com/zhou9527-lj/listingforge` 已创建（公开、默认分支 main），两个提交经 SSH 推送成功，CI 自动触发实跑正式 cargo check。**重要事实：从 Gitee 克隆的 FastAdmin 旧历史含 GitHub 无法解包的缺陷对象（客户端与服务器均报 `did not receive expected object`，SSH/HTTPS 直连/代理/重建仓库均无法修复），最终以 orphan 重建为单一根提交 `37d89db` 解决，旧历史已丢弃。** 剩余人工步骤：申请 SignPath Foundation 免费 Windows 开源签名——永远不要索要 GitHub 密码。SSH 密钥 `~/.ssh/github_ed25519` 已配置且认证通过，后续 push 走 SSH。）
10. [x] 在内存更充足或 CI 环境运行正式 `cargo check`、`tauri build`、Windows NSIS 和 macOS 三架构构建。（2026-08-09 完成：`ci.yml` 完整特性 `cargo check` 已在 GitHub runner 实跑全绿（frontend + rust 两 job）；`desktop-build.yml` 三矩阵 `tauri build` 已就绪待手动触发，尚在用户可操作列表。**2026-08-09 追加：Windows MSI 因 productName 为中文（`商品图匠`）在 WiX light.exe 阶段失败——tauri issue #8363 仍 open 无官方修复；已改 workflow 按平台传 `--bundles`（Windows 只打 NSIS，macOS 打 app+dmg）。NSIS 对中文 productName 正常，SignPath 也支持 NSIS 签名。本地 Windows 构建同样需 `npx tauri build --bundles nsis`（或先试 `bundle.windows.wix.language: "zh-CN"` 偏方，schema 已确认该字段存在但未验证）。**
**2026-08-09 再追加：三矩阵桌面构建实跑（run 31277750641，基于 818e416 旧代码）——Windows NSIS ✅、macOS-14 Apple Silicon app+dmg ✅、macOS-13 Intel ⏳ 排队超 24 小时无 runner（GitHub 已退役 macos-13 镜像，Intel 队列不再调度）。产物名 `listingforge-windows-x64`、`listingforge-macos-apple-silicon`，在 Actions run 页面 artifacts 区下载（需登录 GitHub）；命令行 `gh run download 31277750641 -n listingforge-windows-x64 -D ./dist`。安装包文件为 `商品图匠_0.1.0_x64-setup.exe`。**）
11. [x] 九项改造（多项目/素材库/导出中心/计费重构/空白默认/设置完善）。（2026-08-09 完成，详见第二节之 8；推送后 CI 全绿。）
12. 删除/归档临时构建目录前先确认精确路径。不要删除用户已有文件或全局 Rust 工具链。

## 六、完成标准尚未满足

- [x] 新增前端代码 lint/build/test 全绿。
- [x] SQLite 业务持久化接入 UI（任务/设置/画布文档；单项目模型）。
- [x] 主图以外四类素材真实上传（文件大小/像素/总图数校验已补）。
- [x] U²-Net ONNX 本地抠图和许可证记录（代码与记录完成；推理实跑依赖发布阶段的 `onnxruntime.dll` 分发）。
- [x] 局部蒙版编辑真实调用（蒙版绘制/标注图合成/费用确认/提交入列；未联网验收，且 APIMart 无原生 mask 参数，采用“原图+红色标注参考图”策略）。
- [ ] 真 Key 的三供应商连接测试与非付费/最小付费验收（真 Key 验证后余额/费用列才会出现真实数字）。
- [x] 多项目管理（项目管理器/素材库/导出中心三个独立屏幕；顶栏新建项目真实化）。
- [x] 计费按 API 提供方规则（实际扣费回推单价、三家服务商余额分开显示、确认弹窗计费明细拆分、billing 单测 5 个）。
- [x] 预算与配额界面移除（界面 + 功能 + 文档同步）。
- [x] 默认空白项目启动（演示数据与图片全部移除）。
- [x] Agent 面板真实调用（规划经 `runDeepSeekAgent`、理解经 `analyzeProduct`）。
- [x] 设置页 6 tab 全部控件可用。
- [x] APIMart 完成任务下载到项目 `results/`，不依赖临时 URL（代码完成，未联网验收）。
- [x] 完整语义分层 PSD（2026-08-09 完成：画布对象按语义分组为独立 PSD 层——主标题/特性内容/图片与Logo/其他文字/形状与装饰/蒙版标注，层序自顶向下与 z 序一致，背景固定最底；分层规划为纯函数 `src/lib/psdLayers.ts`，新增 6 测（共 40）；ag-psd children[0]=最顶层经二进制层记录解析验证；PSD 打开效果需真实桌面确认）。
- [x] 最终浏览器截图与跨平台打包（1586×992、1100×720 双尺寸八页截图完成；Windows x64、macOS Intel、macOS Apple Silicon 0.1.2 安装包与正式 Release 均已发布）。
- [x] README/LICENSE/CI/发布材料与免费 Windows 开源签名申请。（README/LICENSE/CONTRIBUTING/CI 工作流已完成；远程仓库与 SignPath Foundation 申请待用户注册 GitHub 后人工推进。）
- [x] 生成页主图/参考图持久化与恢复（原生对话框选择 → 复制进项目并落库，重新进入项目恢复；移除时同步清理记录；打包版经 capability 扩展 fs 读取 scope 后恢复不再被 ACL 拒绝）。
- [x] 结果图片与任务删除（单张/批量删除结果、删除任务行，均为"记录 + 本地文件"同步删除；Rust 命令限定仅可删除当前项目 `results/` 目录内文件；任务删除经外键级联清理结果记录）。
- [x] 画布三功能（空态导入引导；未绘制蒙版提交时自动激活蒙版笔刷并高亮；多图合成——导入图片图层、置顶/置底、素材页卡片加入画布；PNG/JPG/WebP 成品导出不再带蒙版笔迹，PSD 保留蒙版标注层）。

## 七、最近一次进度更新时间

2026-08-09（第九次）：语义分层 PSD 与最终浏览器截图完成。PSD 语义分层（主标题/特性内容/图片与Logo/其他文字/形状与装饰/蒙版标注，层序自顶向下与 z 序一致，背景固定最底）已推送并经 CI 全绿（10 文件 40 测试）。浏览器截图：`scripts/screenshot.mjs`（puppeteer-core + 系统 Edge，独立 profile；注意 launch defaultViewport 在该 Edge 上序列化异常，须 goto 后 setViewport；arg 解析曾有 NaN bug 已修）在 1586×992 下捕获五主屏至 `design/implementation/08-*.png`，PIL 校验五图互异非空白、控制台无 error，已记入视觉保真记录。lint 注意：项目是 ESLint flat config（`eslint.config.js`），`/* eslint-env */` 注释已不支持；Node 脚本（scripts/*.mjs）的全局变量在配置里按文件域声明（process/console/setTimeout/document，`document` 因 `page.evaluate` 回调在浏览器上下文）。其余状态同第八次：仓库 `https://github.com/zhou9527-lj/listingforge` 公开、CI 全绿；待人工推进：手动触发 `desktop-build.yml` 打包、SignPath Foundation 申请、真 Key 联网验收。

2026-08-09（第十次）：九项改造完成并推送，CI 全绿（run 31292473161：frontend + rust 两 job 全过，40 测试）。新增三个独立屏幕（项目管理器/素材库/导出中心）、多项目 SQLite v2 迁移、计费重构（`src/lib/billing.ts` 实际扣费回推单价 + 状态栏/设置页三家服务商余额分开显示 + 确认弹窗计费明细拆分，新增 5 个 billing 单测）、Agent 面板真实接入（原为静态 mock）、预算与配额全删（含文档同步）、默认空白项目（五张演示图删除）、设置页 6 tab 真实化、任务中心真实计数。提交 `abd0b5e` + `4e8628f`。桌面构建：Windows NSIS 与 macOS-14 已成功，macOS Intel（run 31277750641）仍在排队等待 runner；旧版本 `ecom-image-gen` 分支历史已并入 main。待人工推进：macOS Intel 结果确认、真 Key 三供应商联网验收、SignPath Foundation 申请。

2026-08-09（第十一次）：桌面构建状态确认与最新版打包触发。**关键事实：run 31277750641 的安装包是旧代码（818e416，九项改造前），不要当作最新版发给用户。** 已触发新构建 run 31295985762（workflow_dispatch，ref=main，构建九项改造后的最新代码）：Windows NSIS 约 10 分钟、macOS-14 约 3 分钟、macOS-13 Intel 预计继续无限排队（runner 已退役）。给用户的下载地址 = 新 run 页面 artifacts 区。**待用户决策：Intel 包改成交叉编译**（Apple Silicon runner 上 `rustup target add x86_64-apple-darwin` 后按 x86_64 target 打包，Tauri 官方支持，改 `desktop-build.yml` 一个矩阵变体即可，约 10 分钟）。其余待办：新构建结果确认 → Windows 安装包地址给用户 → 真 Key 三供应商联网验收（余额/费用列才出真实数字）→ SignPath Foundation 申请。

2026-08-09（第十二次）：依用户截图红框要求删除整条应用内部顶栏，只保留操作系统原生标题栏。主内容与左侧导航已上移 50 px，底部状态栏不变。保留项目页新建入口、任务/设置左导航和自动保存。验证：ESLint 定向检查、TypeScript、11 文件/45 测试通过；浏览器 `.topbar = 0`、无控制台 error。截图：`design/implementation/13-projects-without-internal-topbar.png`。

2026-08-09（第十三次）：为在未安装 GitHub CLI、应用内浏览器未登录的环境中可重复打包最新安装包，`desktop-build.yml` 新增仅匹配 `build-*` 的标签触发器。它不会在普通分支推送时打包，也不是自动更新。发布方案已同步记录 SSH 标签触发方式和产物名称。
2026-08-09（第十四次）：最新版桌面构建已完成关键产物。通过标签 `build-ca76efb` 触发 GitHub Actions run `31297679913`（构建提交 `80e8cf6`，包含应用提交 `ca76efb` 的内部顶栏删除）。Windows x64 NSIS job 成功，artifact `listingforge-windows-x64`（ID `9033543418`，6,569,006 bytes，digest `sha256:02563a37f50369891242878af2972ddd7acd3cfb9aca8310a6ad81c9e2baf19e`）；macOS Apple Silicon job 成功，artifact `listingforge-macos-apple-silicon`（ID `9033505750`，17,716,545 bytes，digest `sha256:a3de4ddccfd5822184d0d470ace85c2cfb3f5fef187d4470df94edd87e643d83`）。下载页：`https://github.com/zhou9527-lj/listingforge/actions/runs/31297679913`，需在 Artifacts 区点击产物，通常需登录 GitHub。macOS Intel 的 `macos-13` job 仍排队且无产物（runner 已退役），不可宣称完成。旧 run `31277750641` 和 `31295985762` 均不要作为本次最新版下载地址。
2026-08-09（第十五次）：用户反馈安装版创建项目只提示“项目创建失败”。本机只读检查确认 `C:\Users\Administrator\AppData\Roaming\com.listingforge.app\listingforge.db` 的两项迁移均成功、projects 表为空。确定的错误边界问题是 Tauri invoke 会 reject 字符串，而项目页仅识别 `Error`，导致 Rust 真实错误被吞掉。已新增 `desktopErrorMessage` 并接入项目读取/创建/重命名/删除/目录选择；Rust 目录/清单 IO 错误加入目标路径与系统错误；新增中文项目名真实创建测试，并在 Windows NSIS 打包前强制执行。版本升为 `0.1.1`。验证：ESLint 通过、TypeScript 通过、Vite production build 通过、Vitest 11 文件/46 测试全过。本机 Rust 测试编译受既有页面文件不足（OS error 1455）中止，不是代码报错；GitHub Windows runner 为权威测试与打包通道。下一步：提交并推送 → 以 `build-*` 标签触发 → 等 Windows 创建测试与 NSIS 成功 → 将新 run 下载地址和 artifact 校验写回本文。
2026-08-09（第十六次）：`0.1.1` 项目创建修复包已完成。提交 `29d36bf`、触发标签 `build-0.1.1-project-fix`、GitHub Actions run `31299590619`。Windows runner 上 `Verify Windows project creation`、`tauri build --bundles nsis`、artifact upload 全部 success；Windows artifact `listingforge-windows-x64`（ID `9034166324`，6,596,961 bytes，digest `sha256:868134d8dd0c164bb0a99a6ef6cd8020f1594b194f56179ea42ea8cadbde55ec`），下载页 `https://github.com/zhou9527-lj/listingforge/actions/runs/31299590619`。macOS Apple Silicon artifact 同样成功：`listingforge-macos-apple-silicon`（ID `9034101781`，17,721,529 bytes，digest `sha256:dc1719795e01dcaa20ea65824d1e4152c5d5ede8efe8bf8256f5ffc133780f56`）。macOS Intel 仍因退役的 `macos-13` runner 排队，不影响 Windows/Apple Silicon 产物下载。用户安装 `0.1.1` 后应重新创建普通中文名项目；若输入/目录仍有问题，新版会直接显示 Rust 原始路径与系统错误，不再只显示泛化失败。

2026-08-09（第十七次，0.1.2 开发中）：已完成安装版项目创建根因加固、全局素材库、自定义图片类型、Agent 双模式与流式控制、任务/结果/画布/导出/设置交互补全及窄屏响应式修正。项目创建现在由 Rust 返回唯一 ID 与路径，SQLite 写入失败只回滚本次新建空目录；Rust 创建目录或清单失败也会清理本次新建的残留目录；创建成功后项目列表立即回显。SQLite v3 新增 `global_assets`、`custom_generation_types`、`agent_conversations`、`agent_messages`。素材页支持跨项目复制、搜索/分类/批量/预览/重命名/删除；自定义类型可表单 CRUD 并进入生成计划。Agent 提供“方案顾问”和“操作助手”，操作计划必须二次确认，且 Agent 不能提交付费生成；支持按项目会话历史、流式输出、停止和重试。新增自启动的 `scripts/click-test.mjs`，八页键盘/点击巡检通过且付费调用为 0；`npm run check` 全绿（11 文件、46 测试、生产构建通过）。1586×992 与 1100×720 八页截图已重新生成，修复了窄屏生成表格、画布属性栏、结果操作区、任务分页被裁切以及截图脚本未校验路由导致的假阳性。版本文件已统一到 `0.1.2`。本机 Rust 编译仍受 Windows 页面文件/MSVC linker 环境限制，必须以 GitHub Windows/macOS runner 为最终编译验收。GitHub 已于 2025-12-04 退役 `macos-13`，构建矩阵已迁移到当前标准 Intel runner `macos-15-intel`，三端构建不再依赖退役队列。用户已明确授权并已删除 5 项无效界面内容：关于页检查更新、任务页项目范围、生成素材组空省略号、结果页展示平台，以及本地存储/数据与隐私/关于页无对应动作的恢复默认值。下一步：最终差异检查 → 提交推送 → `build-*` 标签触发 Windows NSIS、macOS Apple Silicon/Intel 构建 → 写回 run、artifact、SHA-256 和下载地址。

2026-08-09（第十八次，0.1.2 最终交付）：功能提交 `233e5a9` 与构建修复提交 `cf0dbc7` 已推送到 `main`。首次构建暴露 `tokio::select!` 缺少 Tokio `macros` 特性，已根据 GitHub 日志精准修复并重新验证；修复后的主分支 CI、标签 CI 与 Desktop build run `31304908863` 全部成功。Windows 通过 8 页面零付费调用点击烟测、中文项目名真实创建 Rust 测试和 NSIS 打包；macOS Intel 与 Apple Silicon 均完成 app/dmg 打包。Actions 三个 artifact ID：Windows `9035782002`、Intel `9035791363`、Apple Silicon `9035666493`。已发布正式 GitHub Release `v0.1.2`：`https://github.com/zhou9527-lj/listingforge/releases/tag/v0.1.2`，并上传三个长期公开安装文件。Windows 下载 `https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.2/ListingForge_0.1.2_windows-x64-setup.exe`；macOS Intel 下载 `https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.2/ListingForge_0.1.2_macos-intel.dmg`；macOS Apple Silicon 下载 `https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.2/ListingForge_0.1.2_macos-apple-silicon.dmg`。三个链接均匿名实测 HTTP 200，SHA-256 与大小见 `docs/09-构建与发布/发布方案.md`。当前仅剩必须由用户提供真实 API Key 才能完成的三供应商联网验收，以及外部审批的 SignPath Foundation 免费开源签名申请；不得索要 GitHub 密码或 API 密钥明文。

2026-08-09（第十九次，0.1.3 SQL ACL 修复中）：用户安装 `0.1.2` 创建项目时截图显示 `Command plugin:sql|execute not allowed by ACL`。已确认与中文项目名和保存路径无关：`sql:default` 只允许 load/close/select，而 `src/lib/database.ts` 在连接后首先执行 `PRAGMA foreign_keys = ON`，导致在 Rust 创建目录前即被 ACL 拒绝。已在真实 capability 中加入 `sql:allow-execute`，新增 `scripts/check-capabilities.mjs` 并把 `test:capabilities` 纳入 `npm run check`，从根本上补足安装包权限并防止模拟 Tauri 桥再次产生假阳性。版本统一升级为 `0.1.3`；本地 capability 检查、46 项单测、TypeScript、Vite production build、8 页面点击烟测均通过且付费调用为 0。下一步：提交推送 → `build-0.1.3-sql-acl` 标签触发三端 → 确认 Windows 中文项目创建测试、NSIS 与两种 macOS DMG 成功 → 发布正式 `v0.1.3` 下载并回写 artifact/校验和。

2026-08-09（第二十次，0.1.3 SQL ACL 最终交付）：修复提交 `32d6a7a` 已推送，构建标签 `build-0.1.3-sql-acl` 对应 Desktop build run `31306489288` 三端全部 success。Windows runner 上真实 capability 检查、8 页面零付费调用点击烟测、中文项目创建 Rust 测试、NSIS 构建及上传全部通过；macOS Intel 与 Apple Silicon DMG 同步成功。Actions artifact ID：Windows `9036209017`、Intel `9036246712`、Apple Silicon `9036136298`。正式 Release：`https://github.com/zhou9527-lj/listingforge/releases/tag/v0.1.3`。Windows：`https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.3/ListingForge_0.1.3_windows-x64-setup.exe`；macOS Intel：`https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.3/ListingForge_0.1.3_macos-intel.dmg`；macOS Apple Silicon：`https://github.com/zhou9527-lj/listingforge/releases/download/v0.1.3/ListingForge_0.1.3_macos-apple-silicon.dmg`。三条链接均匿名实测 HTTP 200，大小和 SHA-256 已写入发布方案。用户必须卸载或覆盖安装旧 `0.1.2` 后使用 `0.1.3` 复测创建项目；更换路径或清除数据库不能修复旧安装包的 ACL。

2026-08-09（第二十一次，任务中心提交不显示修复）：用户反馈"任务中心提交任务之后没有显示"。根因是 `GenerationWorkbench.startGeneration` 的提交链路顺序错误：`runGenerationPipeline`（云端受理并扣费）→ `saveGeneratedTasks`（SQLite 落库）→ `addTasks`（入 store）→ `setScreen("tasks")`。一旦落库失败（旧版 ACL 拒绝、数据库错误等），任务既不进入任务中心也不跳转；且 catch 用 `error instanceof Error` 判断，而 Tauri invoke 拒绝的是字符串，真实原因被吞掉只显示泛化"生成任务提交失败"。另外 `CanvasEditor.submitEdit` 只 `addTasks` 从不落库（`updatePersistedTask` 对不存在的行静默跳过），局部编辑任务重启即丢失。修复：云端受理后先 `addTasks` + 跳转任务中心，落库改为其后独立 try/catch，失败提示真实原因（`desktopErrorMessage`，Tauri 字符串错误不再被吞）；database.ts 抽出 `insertTaskRows` 并新增 `saveTaskRecord` 供画布局部编辑落库，保存失败不阻断展示。验证：TypeScript、ESLint、47 项单测全过；无头浏览器 mock 复现脚本证实"数据库写入失败"场景下任务中心仍显示 4 行任务（修复前为空）。

2026-08-09（第二十二次，项目页无限加载与作图提示词优化）：用户反馈三个问题一起处理。① 嵌套按钮：TaskCenter 任务行 `.task-row` 是 `<button>` 且内部包含"复制任务 ID"`<button>`，非法嵌套 HTML；改为 `div role="button" tabIndex={0}` + Enter/Space 键盘触发，内层保持真实按钮。② "创建项目后重新进入项目页一直提示正在读取项目"（仅 0.1.3 安装版、仅项目页、仅创建后发生、重启恢复）：审计确认创建链路无未提交事务、无连接泄漏（全应用仅一处 `Database.load`）；唯一嫌疑是 `listProjects` 的关联 COUNT 子查询执行路径挂起（全应用唯一带关联子查询的查询，其他页查询均正常，重启重建连接后恢复）。修复四层：`listProjects`/`getProjectRecord` 改写为 LEFT JOIN + GROUP BY + COUNT(DISTINCT)（全新执行路径）；Rust 迁移 v4 补 `idx_assets_project` 索引（tasks 已有索引覆盖）；Projects 加载加 15 秒超时，挂起转为"读取项目列表失败 + 重试"错误态，杜绝无限转圈；`getDatabase` 连接失败时丢弃缓存下次重试。③ 作图提示词优化（依据 docs/04-AI与API 三份文档，针对"商品一致性差、风格/构图不稳定"）：`analyzeProduct` 指令改为产出结构化视觉锚点 JSON（主色/辅色含近似 HEX、材质、结构、可见文字、商标位置、风险点、consistencyAnchors），保留"不虚构不可见参数"；`runDeepSeekAgent` system 提示词重构为六条规则：typeId 恰好一次、一致性锚点必须从档案提取并逐条重申（禁止泛化词）、固定结构 `[主体与一致性锚点]+[场景背景]+[光线材质]+[构图镜头]+[风格基线]+[负面约束]`、同批次摄影语言统一基线、负面清单（无画内文字/水印/乱码/畸形/多余物体）、prompt 英文为主中英双写且不含密钥。验证：`npm run check`（lint、capabilities、47 项单测、build）全绿；click-smoke 增加挂起复现——mock 使项目列表查询永不返回（计数 2 以容纳 StrictMode 双 effect），15 秒内转错误态、点重试恢复卡片，8 屏零付费零 console 错误。改动未提交。

2026-08-09（第二十三次，0.1.4 功能交付）：四个任务完成，连同第二十二次改动一并提交。① 生成页主图/参考图持久化与恢复：原生对话框选择 → `importAsset` 复制进项目 `assets/<role>/` 并落库，重新进入项目时经 `listProjectAssets` + plugin-fs 读取恢复；移除主图/参考图时 `deleteProjectAssetsNotIn` 同步清理记录（删掉的图不会再出现）；打包版恢复曾被 ACL 拒绝，capability 新增 `fs:allow-read-file`（scope `**`）解决。② 结果页重复图片修复：`saveDownloadedResult` 幂等（同任务先删后插）、`loadPersistedResults` 按任务取最新行去重、迁移 v5 补 `idx_results_task` 索引——"4 张唯一图片显示 48 行重复"消失。③ 删除功能：结果页单张/批量删除 + 任务中心逐行删除，均为"记录 + 本地文件"同步删除（Rust 命令 `delete_project_result_file` 对目标与项目 results/ 目录 canonicalize 后校验 `starts_with`，仅允许删除目录内文件）；任务删除经外键级联清理结果记录；store 新增 `removeTask`/`pruneResultSelection` 同步清理选择/收藏状态。④ 画布三功能：空态引导（无源图无图层时展示"从结果页选图 / 从素材库导入 / 导入本地图片"三入口，素材页项目素材卡片新增"加入画布"）；蒙版引导（未绘制蒙版直接提交 → 自动切换 AI 面板、激活蒙版笔刷、笔刷按钮 3 秒闪烁高亮，解决"找不到入口/卡在画蒙版"）；多图合成（"导入图片"复制进项目 `assets/canvas/` 落库后以 Fabric 图片图层加入画布，等比缩放居中、可移动/缩放/旋转，图层区分"文本 N / 图片 N"，新增置顶/置底排序）；导出修复（PNG/JPG/WebP/长图成品导出临时隐藏蒙版对象不再带黑色笔迹，PSD 语义分层保留蒙版标注层不变）。版本升至 0.1.4。验证：`npm run check` 全绿（lint、capabilities、47 单测、tsc、vite build）；click-smoke 新增画布空态跳转、导入图片落库断言（`assets` 出现 `canvas` 角色）、置顶/置底、蒙版引导高亮断言后 8 屏零付费调用通过；cargo check 用项目本地 `.toolchains`（stable-x86_64-pc-windows-gnu）通过。知识库同步：本地数据（迁移 v5/删除语义/canvas 角色）、画布与导出（三功能实况）、安全设计（fs 读取 scope 与删除边界）。本机打包结果与发布状态见本文后续记录。
