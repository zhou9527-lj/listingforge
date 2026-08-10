/**
 * 结果页瀑布流诊断：多视口渲染不同比例的结果图片，测量列数、卡片高度（长图限高）、悬停控制层。
 * 复用 click-test 的内存 Tauri/SQLite mock，只展示 UI，不触发任何付费调用。
 * 用法：node scripts/result-gallery-shot.mjs
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
  // 用不同灰度填充，肉眼可区分比例
  const scanlines = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y += 1) {
    const off = y * (1 + width * 3);
    scanlines[off] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = off + 1 + x * 3;
      scanlines[p] = Math.round((x / width) * 200 + 20);
      scanlines[p + 1] = Math.round((y / height) * 200 + 20);
      scanlines[p + 2] = 200;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = "http://127.0.0.1:1420/";
let viteProcess = null;
const isReachable = async () => { try { const r = await fetch(base); return r.ok; } catch { return false; } };
const outDir = path.join(process.cwd(), ".tmp", "result-gallery-shots");
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

const pngs = {
  square: makePng(256, 256).toString("base64"),      // 1:1 白底主图
  poster: makePng(240, 320).toString("base64"),      // 3:4 卖点海报
  long: makePng(240, 520).toString("base64"),        // ≈1:2.17 细节长图（1242×2688 比例）
};

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "listingforge-gallery-"));
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: true,
  args: ["--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-sandbox", `--user-data-dir=${profileDir}`],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("pageerror:", error.message));
page.on("console", (msg) => { if (msg.type() === "error") console.error("console.error:", msg.text().slice(0, 300)); });

await page.evaluateOnNewDocument((smokePngs) => {
  const PNG_B64 = smokePngs.square;
  const state = { projects: [], assets: [], tasks: [], results: [], deletedFiles: [], paidInvocations: 0, hangNextProjectList: 0, nextDialogPick: null };
  window.__LISTINGFORGE_SMOKE__ = state;
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (localPath) => {
      if (typeof localPath === "string" && /long/i.test(localPath)) return `data:image/png;base64,${smokePngs.long}`;
      if (typeof localPath === "string" && /poster/i.test(localPath)) return `data:image/png;base64,${smokePngs.poster}`;
      return `data:image/png;base64,${PNG_B64}`;
    },
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
        if (/FROM assets WHERE project_id = \? AND role = \?/i.test(query)) {
          return state.assets.filter((asset) => asset.projectId === values[0] && asset.role === values[1]).map(({ id, path }) => ({ id, path }));
        }
        if (/FROM assets WHERE project_id/i.test(query)) {
          return state.assets.filter((asset) => asset.projectId === values[0]).map(({ id, role, path, mime }) => ({ id, role, path, mime }));
        }
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
        if (/FROM projects p/i.test(query) && /WHERE p\.id/i.test(query)) return state.projects.filter((item) => item.id === values[0]);
        if (/FROM projects p/i.test(query)) return state.projects;
        return [];
      }
      if (command === "plugin:sql|execute") {
        const query = String(payload.query ?? "");
        const values = payload.values ?? [];
        if (/INSERT INTO projects/i.test(query)) {
          state.projects.unshift({ id: values[0], name: values[1], path: values[2], platform: "未指定", category: "未指定", createdAt: values[3], updatedAt: values[4], assetCount: 0, taskCount: 0 });
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
          if (removed) state.results = state.results.filter((result) => result.taskId !== removed.id);
        }
        if (/DELETE FROM results/i.test(query)) {
          const ids = payload.values ?? [];
          state.results = state.results.filter((result) => !ids.includes(result.id));
        }
        return [1, 1];
      }
      if (command === "create_project") {
        return { id: "smoke-project-id", path: `C:\\ListingForge\\${payload.request?.name ?? "smoke-project"}` };
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
}, pngs);

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".app-shell", { timeout: 20000 });
// 播种 6 张不同比例的结果：按时间倒序 → 方图×3、海报、长图、长图（交错排列验证轮转分配）
await page.evaluate(() => {
  const state = window.__LISTINGFORGE_SMOKE__;
  state.tasks.push(
    { id: "t-s1", projectId: "smoke-project-id", providerTaskId: "p-s1", status: "completed", progress: 100, title: "白底主图-淘宝-家居收纳箱", dimensions: "800×800", project: "smoke-project", provider: "APIMart", costLabel: "¥0.20", elapsed: "00:01:23", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:00:00.000Z" },
    { id: "t-p1", projectId: "smoke-project-id", providerTaskId: "p-p1", status: "completed", progress: 100, title: "卖点海报-拼多多-保温杯", dimensions: "750×1000", project: "smoke-project", provider: "APIMart", costLabel: "¥0.40", elapsed: "00:01:45", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:01:00.000Z" },
    { id: "t-l1", projectId: "smoke-project-id", providerTaskId: "p-l1", status: "completed", progress: 100, title: "细节长图-抖音-蓝牙耳机", dimensions: "1242×2688", project: "smoke-project", provider: "APIMart", costLabel: "¥0.60", elapsed: "00:02:11", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:02:00.000Z" },
    { id: "t-s2", projectId: "smoke-project-id", providerTaskId: "p-s2", status: "completed", progress: 100, title: "白底主图-京东-落地灯", dimensions: "1280×1280", project: "smoke-project", provider: "APIMart", costLabel: "¥0.30", elapsed: "00:03:02", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:03:00.000Z" },
    { id: "t-l2", projectId: "smoke-project-id", providerTaskId: "p-l2", status: "completed", progress: 100, title: "细节长图-小红书-香薰蜡烛", dimensions: "1242×2688", project: "smoke-project", provider: "APIMart", costLabel: "¥0.60", elapsed: "00:03:20", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:04:00.000Z" },
    { id: "t-p2", projectId: "smoke-project-id", providerTaskId: "p-p2", status: "completed", progress: 100, title: "场景主图-淘宝-收纳箱场景", dimensions: "1000×1000", project: "smoke-project", provider: "APIMart", costLabel: "¥0.35", elapsed: "00:04:05", errorMessage: null, resultUrl: null, createdAt: "2026-08-10T10:05:00.000Z" },
  );
  state.results.push(
    { id: "r-s1", taskId: "t-s1", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\square-1.png", createdAt: "2026-08-10T10:00:00.000Z" },
    { id: "r-p1", taskId: "t-p1", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\poster.png", createdAt: "2026-08-10T10:01:00.000Z" },
    { id: "r-l1", taskId: "t-l1", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\long.png", createdAt: "2026-08-10T10:02:00.000Z" },
    { id: "r-s2", taskId: "t-s2", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\square-2.png", createdAt: "2026-08-10T10:03:00.000Z" },
    { id: "r-l2", taskId: "t-l2", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\long-2.png", createdAt: "2026-08-10T10:04:00.000Z" },
    { id: "r-p2", taskId: "t-p2", remoteUrl: null, localPath: "C:\\ListingForge\\smoke\\results\\poster-2.png", createdAt: "2026-08-10T10:05:00.000Z" },
  );
  state.projects.push({ id: "smoke-project-id", name: "点击巡检项目", path: "C:\\ListingForge\\点击巡检项目", platform: "未指定", category: "未指定", createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-10T10:05:00.000Z", assetCount: 0, taskCount: 6 });
});

const go = async (screen) => {
  await page.focus(`[data-screen="${screen}"]`);
  await page.keyboard.press("Enter");
  await page.waitForFunction((value) => document.querySelector(`[data-screen="${value}"]`)?.classList.contains("is-active"), {}, screen);
};
// 初始 mount 在播种前已查询过空列表，往返一次 settings 强制重挂载读取播种的项目
await go("settings");
await go("projects");
await page.waitForSelector(".project-card", { timeout: 15000 });
await page.click(".project-card");
await new Promise((r) => setTimeout(r, 500));
await go("results");
// 等全部图片比例加载完成（onLoad 触发 ratios → 高度重排）
await new Promise((r) => setTimeout(r, 2000));
const dump = await page.evaluate(() => ({
  bodyText: document.body.innerText.slice(0, 300),
  cards: document.querySelectorAll(".result-card").length,
  columns: document.querySelectorAll(".result-gallery__column").length,
  galleryExists: !!document.querySelector(".result-gallery:not(.result-gallery--list)"),
  imgs: [...document.querySelectorAll(".result-card img")].map((img) => ({ complete: img.complete, nh: img.naturalHeight, nw: img.naturalWidth, h: img.style.height })),
  screen: window.__lastScreen,
}));
console.error("DUMP:", JSON.stringify(dump, null, 2));
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll(".result-card img")];
  return imgs.length === 6 && imgs.every((img) => img.complete && img.naturalHeight > 0 && img.style.height && img.style.height !== "auto");
}, { timeout: 15000 });

const measure = () => page.evaluate(() => {
  const cols = [...document.querySelectorAll(".result-gallery__column")];
  const cards = [...document.querySelectorAll(".result-gallery:not(.result-gallery--list) .result-card")];
  const gallery = document.querySelector(".result-gallery:not(.result-gallery--list)");
  const overlay = cards[0]?.querySelector(".result-card__overlay");
  return {
    galleryWidth: gallery ? Math.round(gallery.getBoundingClientRect().width) : null,
    columns: cols.length,
    colCounts: cols.map((col) => col.querySelectorAll(".result-card").length),
    colWidth: cols[0] ? Math.round(cols[0].getBoundingClientRect().width) : null,
    cards: cards.map((card) => {
      const img = card.querySelector("img");
      return {
        h: Math.round(card.getBoundingClientRect().height),
        col: [...document.querySelectorAll(".result-gallery:not(.result-gallery--list) .result-gallery__column")].indexOf(card.parentElement),
        capped: card.classList.contains("is-capped"),
        ratio: img ? Math.round((img.naturalHeight / img.naturalWidth) * 100) / 100 : null,
      };
    }),
    overlayOpacity: overlay ? globalThis.getComputedStyle(overlay).opacity : null,
  };
});

for (const [w, h, label] of [[1586, 992, "wide-1586x992"], [1280, 800, "mid-1280x800"], [900, 650, "small-900x650"]]) {
  await page.setViewport({ width: w, height: h });
  await new Promise((r) => setTimeout(r, 500));
  const metrics = await measure();
  console.log(label, JSON.stringify(metrics));
  await page.screenshot({ path: path.join(outDir, `gallery-${label}.jpg`), type: "jpeg", quality: 85, fullPage: false });
  console.log(`  shot -> ${outDir}\\gallery-${label}.jpg`);
}

// 悬停验证：overlay 从 0 变为 1
await page.setViewport({ width: 1586, height: 992 });
await new Promise((r) => setTimeout(r, 400));
const before = (await measure()).overlayOpacity;
await page.hover(".result-gallery:not(.result-gallery--list) .result-card");
await new Promise((r) => setTimeout(r, 250));
const after = (await measure()).overlayOpacity;
console.log("hover overlay:", before, "->", after);
if (before === "0" && after === "1") console.log("hover overlay: PASS");
else { console.error("hover overlay: FAIL"); process.exitCode = 1; }

// 长图限高验证：capped 卡片高度 = 2 × 列宽 + 2px 边框（±1px）
const wide = await measure();
const cappedCards = wide.cards.filter((card) => card.capped);
if (cappedCards.length === 2 && cappedCards.every((card) => Math.abs(card.h - 2 - wide.colWidth * 2) <= 1)) console.log("capped height: PASS");
else { console.error("capped height: FAIL", JSON.stringify(cappedCards), "colWidth=", wide.colWidth); process.exitCode = 1; }

// 轮转分配验证：DOM 顺序按列拼接（3 列 6 张 → 每列 2 张），colIndex 序列应为 0,0,1,1,2,2
const assignedCols = wide.cards.map((card) => card.col);
const expectedCols = wide.columns === 3 ? "0,0,1,1,2,2" : "0,0,0,1,1,1";
if (assignedCols.join(",") === expectedCols) console.log("round-robin: PASS");
else { console.error("round-robin: FAIL", assignedCols.join(","), "expected", expectedCols); process.exitCode = 1; }

await browser.close();
if (viteProcess) viteProcess.kill();
console.log(process.exitCode ? "FAILED" : "all checks PASS");
