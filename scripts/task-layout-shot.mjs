/**
 * 任务中心排版诊断截图：在多个视口尺寸下渲染任务中心，输出截图供人工/模型检查。
 * 复用 click-test 的内存 Tauri/SQLite mock，只展示 UI，不触发任何付费调用。
 * 用法：node scripts/task-layout-shot.mjs
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

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

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = "http://127.0.0.1:1420/";
let viteProcess = null;
const isReachable = async () => { try { const r = await fetch(base); return r.ok; } catch { return false; } };
const outDir = path.join(process.cwd(), ".tmp", "task-layout-shots");
fs.mkdirSync(outDir, { recursive: true });

if (!(await isReachable())) {
  viteProcess = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
    cwd: process.cwd(), stdio: "ignore", windowsHide: true,
  });
  const deadline = Date.now() + 60_000;
  while (!(await isReachable())) {
    if (Date.now() > deadline || viteProcess.exitCode !== null) throw new Error("vite failed to start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "listingforge-layout-"));
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: true,
  args: ["--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-sandbox", `--user-data-dir=${profileDir}`],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("pageerror:", error.message));
page.on("console", (msg) => { if (msg.type() === "error" || msg.type() === "warning") console.error("console." + msg.type() + ":", msg.text().slice(0, 300)); });

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

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".app-shell", { timeout: 20000 });
await page.evaluate(() => {
  const state = window.__LISTINGFORGE_SMOKE__;
  const mk = (id, status, progress, title, dims, cost, elapsed, err, providerTaskId) => state.tasks.push({
    id, projectId: "smoke-project-id", providerTaskId: providerTaskId ?? null, status, progress,
    title, dimensions: dims, project: "smoke-project", provider: "APIMart", costLabel: cost, elapsed,
    errorMessage: err ?? null, resultUrl: null, createdAt: "2026-08-09T10:00:00.000Z",
  });
  mk("t1", "failed", 30, "白底主图-淘宝-家居收纳箱四件套可叠加可折叠", "800×800", "¥0.20", "00:01:23", "API 请求超时：连接上游服务失败，请稍后重试或检查网络", "prov-1111");
  mk("t2", "running", 45, "场景主图-京东-北欧风落地灯卧室客厅氛围灯", "1280×1280", "¥0.80", "00:02:11", null, "prov-2222");
  mk("t3", "completed", 100, "卖点海报-拼多多-不锈钢保温杯大容量", "750×1000", "¥0.40", "00:03:02", null, "prov-3333");
  mk("t4", "queued", 0, "细节长图-抖音-无线蓝牙耳机降噪运动", "1242×2688", "¥0.60", "00:00:00", null, "prov-4444");
  mk("t5", "analyzing", 12, "白底主图-小红书-香薰蜡烛礼盒套装", "1000×1000", "¥0.20", "00:00:47", null, "prov-5555");
  mk("t6", "local", 0, "本地任务-七天内完成的商品图片素材整理", "—", "本地", "00:00:05", null, null);
});

const go = async (screen) => {
  await page.focus(`[data-screen="${screen}"]`);
  await page.keyboard.press("Enter");
  await page.waitForFunction((value) => document.querySelector(`[data-screen="${value}"]`)?.classList.contains("is-active"), {}, screen);
};
await go("projects");
try {
  await page.evaluate(() => {
    const btn = document.querySelector(".projects-header .button");
    if (btn) btn.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
} catch (error) {
  const dump = await page.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 600),
    dialogs: document.querySelectorAll("[role=dialog]").length, modals: document.querySelectorAll(".modal").length,
    buttons: [...document.querySelectorAll(".projects-header button, .projects-header .button")].map((b) => ({ text: b.textContent?.trim(), disabled: b.disabled ?? b.getAttribute("aria-disabled") })),
  }));
  console.error("DIALOG FAILED:", JSON.stringify(dump, null, 2));
  await page.screenshot({ path: "E:/codex/AI电商图项目/.tmp/task-layout-shots/fail.png", type: "jpeg", quality: 85 });
  throw error;
}
await page.type('.modal input', "点击巡检项目");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__LISTINGFORGE_SMOKE__.projects.length === 1);
await page.waitForSelector('[role="dialog"]', { hidden: true });
await go("projects");
await page.waitForSelector(".project-card", { timeout: 15000 });
await page.click(".project-card");
await new Promise((r) => setTimeout(r, 600));
await go("tasks");
await new Promise((r) => setTimeout(r, 800));

for (const [w, h, label] of [[1586, 992, "default-1586x992"], [1280, 800, "mid-1280x800"], [1100, 720, "min-1100x720"], [900, 650, "small-900x650"]]) {
  await page.setViewport({ width: w, height: h });
  await new Promise((r) => setTimeout(r, 400));
  const file = path.join(outDir, `tasks-${label}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 88, fullPage: false });
  // 记录关键指标
  const metrics = await page.evaluate(() => {
    const table = document.querySelector(".task-table");
    const rows = [...document.querySelectorAll(".task-row")];
    const head = document.querySelector(".task-table__head");
    void head;
    const t = table ? table.getBoundingClientRect() : null;
    const q = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
    const workspace = q(".task-workspace");
    const pagination = q(".task-pagination");
    const layout = q(".screen-layout--tasks");
    const screenArea = q(".screen-area");
    const emptyState = q(".empty-state");
    return {
      workspace, pagination, layout, screenArea, emptyState,
      gridChildren: [...(document.querySelector(".task-workspace")?.children ?? [])].map((c) => ({ cls: c.className, top: Math.round(c.getBoundingClientRect().top), h: Math.round(c.getBoundingClientRect().height) })),
      screen: window.__lastScreen,
      tableClientWidth: t ? Math.round(t.width) : null,
      tableScrollWidth: table ? table.scrollWidth : null,
      tableClientHeight: t ? Math.round(t.height) : null,
      tableScrollHeight: table ? table.scrollHeight : null,
      hScroll: table ? table.scrollWidth > table.clientWidth : null,
      vScroll: table ? table.scrollHeight > table.clientHeight : null,
      rowCount: rows.length,
      firstRow: rows[0] ? { h: Math.round(rows[0].getBoundingClientRect().height), bottom: Math.round(rows[0].getBoundingClientRect().bottom), tableBottom: t ? Math.round(t.bottom) : null } : null,
      lastRow: rows.length ? { h: Math.round(rows.at(-1).getBoundingClientRect().height), bottom: Math.round(rows.at(-1).getBoundingClientRect().bottom), tableBottom: t ? Math.round(t.bottom) : null } : null,
    };
  });
  console.log(label, JSON.stringify(metrics));
  console.log(`  shot -> ${file}`);
}

await browser.close();
if (viteProcess) viteProcess.kill();
console.log("done");
