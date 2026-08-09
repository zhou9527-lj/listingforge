/**
 * Browser interaction smoke test with an in-memory Tauri/SQLite bridge.
 * It verifies local UI behavior only and fails if a paid generation command is invoked.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// 生成一张 256×256 有效 PNG（主图校验要求尺寸 ≥ 256），供 fs 插件 mock 返回
const PNG_CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const pngCrc32 = (buffer) => {
  let c = -1;
  for (const byte of buffer) c = PNG_CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const makePng = (width, height) => {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(pngCrc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc((1 + width * 3) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const SMOKE_PNG_B64 = makePng(256, 256).toString("base64");

const EDGE = process.env.EDGE_PATH
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = "http://127.0.0.1:1420/";
let viteProcess = null;

const isReachable = async () => {
  try {
    const response = await fetch(base);
    return response.ok;
  } catch {
    return false;
  }
};

if (!(await isReachable())) {
  viteProcess = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 60_000;
  while (!(await isReachable())) {
    if (Date.now() > deadline || viteProcess.exitCode !== null) throw new Error("Vite smoke-test server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "listingforge-click-"));
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-sandbox", `--user-data-dir=${profileDir}`],
});

const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 720 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
});

await page.evaluateOnNewDocument((smokePngB64) => {
  const PNG_B64 = smokePngB64;
  const state = { projects: [], assets: [], tasks: [], results: [], deletedFiles: [], paidInvocations: 0, hangNextProjectList: 0, nextDialogPick: null };
  window.__LISTINGFORGE_SMOKE__ = state;
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: () => `data:image/png;base64,${PNG_B64}`,
    invoke: async (command, payload = {}) => {
      if (command === "submit_image_generation" || command === "stream_deepseek_agent" || command === "analyze_product") {
        state.paidInvocations += 1;
        throw new Error(`Smoke test blocked paid command: ${command}`);
      }
      if (command === "plugin:sql|load") return "sqlite:listingforge.db";
      if (command === "plugin:sql|close") return null;
      if (command === "plugin:sql|select") {
        const query = String(payload.query ?? "");
        const values = payload.values ?? [];
        // 生成页素材恢复（listProjectAssets / deleteProjectAssetsNotIn 的 SELECT）
        if (/FROM assets WHERE project_id = \? AND role = \?/i.test(query)) {
          return state.assets.filter((asset) => asset.projectId === values[0] && asset.role === values[1]).map(({ id, path }) => ({ id, path }));
        }
        if (/FROM assets WHERE project_id/i.test(query)) {
          return state.assets.filter((asset) => asset.projectId === values[0]).map(({ id, role, path, mime }) => ({ id, role, path, mime }));
        }
        // 任务/结果读取与删除（loadPersistedTasks / loadPersistedResults / deleteTaskRecord / deleteResultRecords）
        if (/FROM results WHERE task_id/i.test(query)) {
          return state.results.filter((result) => result.taskId === values[0]).map((result) => ({ id: result.id, local_path: result.localPath }));
        }
        if (/FROM results WHERE id IN/i.test(query)) {
          const ids = payload.values ?? [];
          return state.results.filter((result) => ids.includes(result.id)).map((result) => ({ id: result.id, local_path: result.localPath }));
        }
        if (/FROM results r/i.test(query)) {
          return state.results.map((result) => ({
            id: result.id, task_id: result.taskId,
            task_title: state.tasks.find((task) => task.id === result.taskId)?.title ?? "未知任务",
            remote_url: result.remoteUrl ?? null, local_path: result.localPath, created_at: result.createdAt,
          }));
        }
        if (/FROM tasks/i.test(query)) {
          return state.tasks.filter((task) => task.projectId === values[0]).map((task) => ({
            id: task.id, provider_task_id: task.providerTaskId, status: task.status, progress: task.progress,
            title: task.title, dimensions: task.dimensions ?? null, provider: task.provider,
            cost_label: task.costLabel, elapsed: task.elapsed, error_message: task.errorMessage ?? null,
            result_url: task.resultUrl ?? null,
          }));
        }
        if (/SELECT path FROM projects/i.test(query)) return state.projects.filter((item) => item.id === values[0]).map((item) => ({ path: item.path }));
        // 模拟打包版"创建后重新进入项目页"时项目列表查询挂起（永不返回）；计数递减以容纳 StrictMode 的 effect 双调用，第三次起恢复正常
        if (state.hangNextProjectList > 0 && /FROM projects p/i.test(query) && !/WHERE p\.id/i.test(query)) {
          state.hangNextProjectList -= 1;
          return new Promise(() => {});
        }
        if (/FROM projects p/i.test(query) && /WHERE p\.id/i.test(query)) return state.projects.filter((item) => item.id === values[0]);
        if (/FROM projects p/i.test(query)) return state.projects;
        return [];
      }
      if (command === "plugin:sql|execute") {
        const query = String(payload.query ?? "");
        const values = payload.values ?? [];
        if (/INSERT INTO projects/i.test(query)) {
          state.projects.unshift({
            id: values[0], name: values[1], path: values[2],
            platform: "未指定", category: "未指定",
            createdAt: values[3], updatedAt: values[4], assetCount: 0, taskCount: 0,
          });
        }
        if (/INSERT INTO assets/i.test(query)) {
          state.assets.push({ id: values[0], projectId: values[1], role: values[2], path: values[3], mime: values[5] });
        }
        if (/DELETE FROM assets/i.test(query)) {
          state.assets = state.assets.filter((asset) => asset.id !== values[0]);
        }
        if (/DELETE FROM tasks/i.test(query)) {
          const removed = state.tasks.find((task) => task.id === values[0]);
          state.tasks = state.tasks.filter((task) => task.id !== values[0]);
          if (removed) state.results = state.results.filter((result) => result.taskId !== removed.id); // 外键级联
        }
        if (/DELETE FROM results/i.test(query)) {
          const ids = payload.values ?? [];
          state.results = state.results.filter((result) => !ids.includes(result.id));
        }
        return [1, 1];
      }
      if (command === "create_project") {
        const name = payload.request?.name ?? "smoke-project";
        return { id: "smoke-project-id", path: `C:\\ListingForge\\${name}` };
      }
      if (command === "import_asset") {
        const name = String(payload.sourcePath ?? "imported.png").split(/[\\/]/).pop();
        return { path: `C:\\ListingForge\\smoke\\assets\\${payload.role}\\${name}`, sha256: "smoke-sha", mime: "image/png" };
      }
      if (command === "get_api_secret_status") return { configured: false, maskedKey: "" };
      if (command === "delete_project_result_file") {
        state.deletedFiles.push(payload.filePath);
        return null;
      }
      if (command === "plugin:fs|read_file") return Uint8Array.from(atob(PNG_B64), (char) => char.charCodeAt(0));
      if (command.startsWith("plugin:path|")) return "C:\\ListingForge";
      if (command.startsWith("plugin:dialog|")) {
        const pick = state.nextDialogPick;
        state.nextDialogPick = null;
        return pick;
      }
      return null;
    },
  };
}, SMOKE_PNG_B64);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const activeScreen = async (screen) => page.$eval(`[data-screen="${screen}"]`, (node) => node.classList.contains("is-active"));
const go = async (screen) => {
  const selector = `[data-screen="${screen}"]`;
  await page.focus(selector);
  await page.keyboard.press("Enter");
  await page.waitForFunction((value) => document.querySelector(`[data-screen="${value}"]`)?.classList.contains("is-active"), {}, screen);
  assert(await activeScreen(screen), `${screen}: keyboard navigation did not activate screen`);
};

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".app-shell", { timeout: 20000 });

  // Task D：预置两条已完成任务与对应结果，供删除流程验证（需在打开项目前播种，hydrate 时会读入）
  await page.evaluate(() => {
    const state = window.__LISTINGFORGE_SMOKE__;
    state.tasks.push(
      { id: "task-del-1", projectId: "smoke-project-id", providerTaskId: "p-del-1", status: "completed", progress: 100, title: "删除测试任务 A", dimensions: "1:1", project: "smoke-project", provider: "APIMart", costLabel: "¥0.50", elapsed: "00:01:23", errorMessage: null, resultUrl: "C:\\ListingForge\\smoke\\results\\del-result-1.png", createdAt: "2026-08-09T10:00:00.000Z" },
      { id: "task-del-2", projectId: "smoke-project-id", providerTaskId: "p-del-2", status: "completed", progress: 100, title: "删除测试任务 B", dimensions: "1:1", project: "smoke-project", provider: "APIMart", costLabel: "¥0.60", elapsed: "00:01:45", errorMessage: null, resultUrl: "C:\\ListingForge\\smoke\\results\\del-result-2.png", createdAt: "2026-08-09T10:05:00.000Z" },
    );
    state.results.push(
      { id: "result-del-1", taskId: "task-del-1", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\del-result-1.png", createdAt: "2026-08-09T10:00:00.000Z" },
      { id: "result-del-2", taskId: "task-del-2", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\del-result-2.png", createdAt: "2026-08-09T10:05:00.000Z" },
    );
  });

  await go("projects");
  await page.click(".projects-header .button");
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.click(".projects-header .button");
  await page.type('.modal input', "点击巡检项目");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__LISTINGFORGE_SMOKE__.projects.length === 1);
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.waitForFunction(() => document.querySelector(".statusbar__path")?.textContent?.includes("C:\\ListingForge"));
  await go("projects");
  await page.waitForSelector(".project-card");

  // 复现打包版"创建后重新进入项目页"的查询挂起：应 15 秒内转为错误态并可重试，而非无限"正在读取本地项目…"
  await page.evaluate(() => { window.__LISTINGFORGE_SMOKE__.hangNextProjectList = 2; });
  await go("settings");
  await go("projects");
  await page.waitForFunction(() => document.querySelector(".empty-state")?.textContent?.includes("读取项目列表失败"), { timeout: 22000 });
  await page.click(".empty-state .button");
  await page.waitForSelector(".project-card", { timeout: 15000 });

  await go("materials");
  for (const tab of await page.$$(".materials-tabs button")) await tab.click();
  const typeCreate = await page.$(".type-library > header .button");
  if (typeCreate) {
    await typeCreate.click();
    await page.waitForSelector('[role="dialog"]');
    await page.keyboard.press("Escape");
  }

  // Task A：生成页素材持久化 —— 先预置项目素材记录，再进入生成页验证恢复主图与参考图
  await page.evaluate(() => {
    window.__LISTINGFORGE_SMOKE__.assets.push(
      { id: "asset-main-1", projectId: "smoke-project-id", role: "product", path: "C:\\ListingForge\\smoke\\assets\\product\\restored-main.png", mime: "image/png" },
      { id: "asset-logo-1", projectId: "smoke-project-id", role: "logo", path: "C:\\ListingForge\\smoke\\assets\\logo\\restored-logo.png", mime: "image/png" },
    );
  });
  await go("generate");
  await page.waitForFunction(() => document.querySelector(".product-preview img") !== null);
  assert(await page.$eval(".file-meta strong", (node) => node.textContent) === "restored-main.png", "generate: 已落库主图未在重新进入时恢复");
  await page.waitForFunction(() => document.querySelectorAll(".asset-section")[1]?.querySelector(".asset-thumb") !== null);
  // 移除主图 → assets 表记录同步删除（下次打开不会"删掉的图又出现"）
  await page.click(".asset-section .asset-thumb");
  await page.waitForFunction(() => window.__LISTINGFORGE_SMOKE__.assets.every((asset) => asset.role !== "product"));
  // 原生对话框选择主图 → 复制进项目并落库（Tauri 模式下走 dialog 拿真实路径）
  await page.evaluate(() => { window.__LISTINGFORGE_SMOKE__.nextDialogPick = "C:\\ListingForge\\smoke\\pick-main.png"; });
  await page.click(".drop-zone");
  await page.waitForFunction(() => document.querySelector(".file-meta strong")?.textContent === "pick-main.png");
  assert(await page.evaluate(() => window.__LISTINGFORGE_SMOKE__.assets.some((asset) => asset.role === "product" && asset.path.endsWith("pick-main.png"))), "generate: 对话框选择的主图未复制落库");

  for (const button of await page.$$(".plan-row button, .agent-mode-switch button")) {
    if (!(await button.evaluate((node) => node.disabled))) await button.click();
  }
  await page.click(".agent-mode-switch button:first-child");
  await page.click(".agent-mode-switch button:nth-of-type(2)");

  await go("results");
  for (const button of await page.$$(".filter-list button")) await button.click();
  // Task D：结果删除（单张卡片 → 确认 → 记录与本地文件同步删除）
  await page.waitForSelector(".result-card__delete");
  assert((await page.$$(".result-card")).length === 2, "results: 预置结果未全部展示");
  await page.click(".result-card__delete");
  await page.waitForSelector('[role="dialog"][aria-label="删除结果图片"]');
  await page.click(".modal-actions button:last-child");
  await page.waitForFunction(() => window.__LISTINGFORGE_SMOKE__.results.length === 1);
  // 画廊按时间倒序，第一张卡是较新的 result-del-2
  const deletedAfterResult = await page.evaluate(() => JSON.stringify(window.__LISTINGFORGE_SMOKE__.deletedFiles));
  assert(deletedAfterResult.includes("del-result-2.png"), `results: 删除结果未同步删除本地文件 (deletedFiles=${deletedAfterResult})`);
  await page.click(".results-actions button:first-child");
  assert(await activeScreen("generate"), "results: regenerate did not navigate to generation");

  await go("canvas");
  // Task C：空态引导 —— 无源图且无图层时，展示"从结果页 / 素材库 / 本地"导入入口
  await page.waitForSelector(".canvas-empty");
  await page.click(".canvas-empty__actions button:first-child");
  await page.waitForFunction(() => document.querySelector('[data-screen="results"]')?.classList.contains("is-active"));
  await go("canvas");
  await page.waitForSelector(".canvas-empty");
  // 多图合成：对话框导入本地图片 → 复制进项目素材（画布素材角色）→ 图片图层进入图层面板
  await page.evaluate(() => { window.__LISTINGFORGE_SMOKE__.nextDialogPick = "C:\\ListingForge\\smoke\\compose-layer.png"; });
  await page.click(".layer-footer__row .button:nth-child(2)");
  await page.waitForFunction(() => document.querySelector(".layer-list")?.textContent?.includes("图片 1"));
  assert(await page.evaluate(() => window.__LISTINGFORGE_SMOKE__.assets.some((asset) => asset.role === "canvas" && asset.path.endsWith("compose-layer.png"))), "canvas: 导入的图片未复制落库为画布素材");
  await page.click('button[aria-label="置底图层"]');
  await page.click('button[aria-label="置顶图层"]');
  // 蒙版引导：未绘制蒙版直接提交 → 自动激活蒙版笔刷、切换到 AI 面板并高亮笔刷按钮
  await page.click(".inspector-tabs button:nth-child(2)");
  await page.click(".ai-edit-section .button.full-width");
  await page.waitForSelector(".tool-group--modes .icon-button.is-flash", { timeout: 5000 });
  assert(await page.$eval(".tool-group--modes .icon-button.is-flash", (node) => node.getAttribute("aria-label")) === "蒙版笔刷", "canvas: 未绘制蒙版提交时未自动高亮蒙版笔刷");
  await page.click(".tool-group--modes .icon-button.is-flash");
  for (const button of await page.$$(".tool-group--modes button, .inspector-tabs button")) await button.click();
  await page.click(".layer-footer__row .button:first-child");
  await page.click(".canvas-controls .button");
  await page.click(".editor-toolbar > .button");
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press("Escape");

  await go("exports");
  await go("tasks");
  for (const button of await page.$$(".filter-list button")) await button.click();
  await page.click(".task-filters button:first-child"); // 过滤循环最后停在「失败」，回到「全部任务」以展示已完成行
  // Task D：任务删除（含结果本地文件）
  await page.waitForSelector('button[aria-label="删除任务"]');
  const taskDeleteButtons = await page.$$('button[aria-label="删除任务"]');
  assert(taskDeleteButtons.length === 2, "tasks: 预置任务未全部展示");
  await taskDeleteButtons[0].click(); // 删除「删除测试任务 A」，其结果文件 del-result-1.png 仍在磁盘 mock 中
  await page.waitForSelector('[role="dialog"][aria-label="删除任务"]');
  await page.click(".modal-actions button:last-child");
  await page.waitForFunction(() => window.__LISTINGFORGE_SMOKE__.tasks.length === 1);
  assert((await page.evaluate(() => window.__LISTINGFORGE_SMOKE__.deletedFiles)).some((file) => file.endsWith("del-result-1.png")), "tasks: 删除任务未同步删除结果文件");
  await page.click(".task-toolbar button:first-child");

  await go("settings");
  const resettableTabs = new Set([0, 1, 3]);
  for (let index = 0; index < 6; index += 1) {
    await page.click(`.settings-sidebar nav button:nth-child(${index + 1})`);
    const footerButtonCount = await page.$$eval(".settings-footer .button", (buttons) => buttons.length);
    assert(footerButtonCount === (resettableTabs.has(index) ? 2 : 1), `settings tab ${index}: unexpected reset control`);
    if (index === 5) {
      const aboutButtons = await page.$$eval(".storage-actions .button", (buttons) => buttons.map((button) => button.textContent?.trim()));
      assert(aboutButtons.length === 1, "about: update-check control was not removed");
    }
  }
  await page.click(".settings-sidebar nav button:first-child");
  for (const button of await page.$$(".secret-field button")) await button.click();
  for (const toggle of await page.$$(".switch input")) await toggle.click();

  const paidInvocations = await page.evaluate(() => window.__LISTINGFORGE_SMOKE__.paidInvocations);
  assert(paidInvocations === 0, `paid command count was ${paidInvocations}`);
  assert(errors.length === 0, errors.join("\n"));
  console.log("click-smoke: PASS (8 screens, keyboard Enter/Escape, local controls, paid calls = 0)");
} finally {
  await browser.close();
  viteProcess?.kill();
  fs.rmSync(profileDir, { recursive: true, force: true });
}
