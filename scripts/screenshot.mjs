/**
 * 八个屏幕的浏览器截图脚本（开发期视觉回归）。
 * 用法：node scripts/screenshot.mjs [--width 1586] [--height 992]
 * 依赖：puppeteer-core + 系统 Edge（无需下载浏览器）
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const widthArg = process.argv.indexOf("--width");
const heightArg = process.argv.indexOf("--height");
const width = widthArg > -1 ? Number(process.argv[widthArg + 1]) : 1586;
const height = heightArg > -1 ? Number(process.argv[heightArg + 1]) : 992;
const outDir = "design/implementation";
fs.mkdirSync(outDir, { recursive: true });

const EDGE = process.env.EDGE_PATH
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = "http://localhost:1420/";
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "listingforge-shot-"));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  // 独立 profile：避免与已运行的 Edge 实例冲突导致 launch 挂起
  args: ["--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-sandbox", `--user-data-dir=${profileDir}`],
});

const page = await browser.newPage();
page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text()); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
// 该 Edge 上 setViewport 需在页面加载后调用，否则 CDP 序列化失败
await page.setViewport({ width, height });
// 等待应用外壳渲染完成（含 hydrate 的异步 DB 加载），避免截到白屏或点击被后续渲染重置
await page.waitForSelector(".app-shell", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

/** 点击侧栏/顶栏导航切换到指定屏，再截图；selector 为 CSS 选择器 */
async function snap(name, screen) {
  const selector = `.app-nav__item[data-screen="${screen}"]`;
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
  await page.waitForFunction((expected) => document.querySelector(`.app-nav__item[data-screen="${expected}"]`)?.classList.contains("is-active"), { timeout: 10000 }, screen);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("saved:", `${name}.png`);
}

// 八个屏幕：默认落在项目管理器（无项目时），其余经导航点击。
// 左侧导航顺序：项目管理器/素材库/生成/结果/画布/导出中心；底部：任务中心/设置。
await snap(`09-${width}x${height}-01-project-manager`, "projects");
await snap(`09-${width}x${height}-02-materials`, "materials");
await snap(`09-${width}x${height}-03-generation-workbench`, "generate");
await snap(`09-${width}x${height}-04-results-review`, "results");
await snap(`09-${width}x${height}-05-canvas-editor`, "canvas");
await snap(`09-${width}x${height}-06-export-center`, "exports");
await snap(`09-${width}x${height}-07-task-center`, "tasks");
await snap(`09-${width}x${height}-08-api-settings`, "settings");

await browser.close();
fs.rmSync(profileDir, { recursive: true, force: true });
console.log("done");
