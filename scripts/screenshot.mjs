/**
 * 八个屏幕的浏览器截图脚本（开发期视觉回归）。
 * 用法：node scripts/screenshot.mjs [--width 1586] [--height 992]
 * 依赖：puppeteer-core + 系统 Edge（无需下载浏览器）
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const widthArg = process.argv.indexOf("--width");
const heightArg = process.argv.indexOf("--height");
const width = widthArg > -1 ? Number(process.argv[widthArg + 1]) : 1586;
const height = heightArg > -1 ? Number(process.argv[heightArg + 1]) : 992;
const outDir = "design/implementation";
fs.mkdirSync(outDir, { recursive: true });

const EDGE = process.env.EDGE_PATH
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = "http://localhost:1420/";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  // 独立 profile：避免与已运行的 Edge 实例冲突导致 launch 挂起
  args: ["--disable-gpu", "--no-sandbox", "--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/listingforge-shot-profile"],
});

const page = await browser.newPage();
page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text()); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(base, { waitUntil: "networkidle2", timeout: 30000 });
// 该 Edge 上 setViewport 需在页面加载后调用，否则 CDP 序列化失败
await page.setViewport({ width, height });
// 等待应用外壳渲染完成（含 hydrate 的异步 DB 加载），避免截到白屏或点击被后续渲染重置
await page.waitForSelector(".app-shell", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

/** 点击侧栏/顶栏导航切换到指定屏，再截图；selector 为 CSS 选择器 */
async function snap(name, selector) {
  if (selector) {
    await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("saved:", `${name}.png`);
}

// 八个屏幕：默认落在项目管理器（无项目时），其余经导航点击。
// 左侧导航顺序：项目管理器/素材库/生成/结果/画布/导出中心；底部：任务中心/设置。
await snap(`09-${width}x${height}-01-project-manager`);
await snap(`09-${width}x${height}-02-materials`, ".app-nav__main .app-nav__item:nth-child(2)");
await snap(`09-${width}x${height}-03-generation-workbench`, ".app-nav__main .app-nav__item:nth-child(3)");
await snap(`09-${width}x${height}-04-results-review`, ".app-nav__main .app-nav__item:nth-child(4)");
await snap(`09-${width}x${height}-05-canvas-editor`, ".app-nav__main .app-nav__item:nth-child(5)");
await snap(`09-${width}x${height}-06-export-center`, ".app-nav__main .app-nav__item:nth-child(6)");
await snap(`09-${width}x${height}-07-task-center`, ".app-nav__footer .app-nav__item:first-child");
await snap(`09-${width}x${height}-08-api-settings`, ".app-nav__footer .app-nav__item:nth-child(2)");

await browser.close();
console.log("done");
