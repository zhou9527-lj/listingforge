/**
 * Browser interaction smoke test with an in-memory Tauri/SQLite bridge.
 * It verifies local UI behavior only and fails if a paid generation command is invoked.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

await page.evaluateOnNewDocument(() => {
  const state = { projects: [], paidInvocations: 0 };
  window.__LISTINGFORGE_SMOKE__ = state;
  window.__TAURI_INTERNALS__ = {
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
        if (/FROM projects p WHERE p\.id/i.test(query)) return state.projects.filter((item) => item.id === values[0]);
        if (/FROM projects p/i.test(query)) return state.projects;
        if (/SELECT path FROM projects/i.test(query)) return state.projects.filter((item) => item.id === values[0]).map((item) => ({ path: item.path }));
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
        return [1, 1];
      }
      if (command === "create_project") {
        const name = payload.request?.name ?? "smoke-project";
        return { id: "smoke-project-id", path: `C:\\ListingForge\\${name}` };
      }
      if (command === "get_api_secret_status") return { configured: false, maskedKey: "" };
      if (command.startsWith("plugin:path|")) return "C:\\ListingForge";
      if (command.startsWith("plugin:dialog|")) return null;
      return null;
    },
  };
});

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

  await go("materials");
  for (const tab of await page.$$(".materials-tabs button")) await tab.click();
  const typeCreate = await page.$(".type-library > header .button");
  if (typeCreate) {
    await typeCreate.click();
    await page.waitForSelector('[role="dialog"]');
    await page.keyboard.press("Escape");
  }

  await go("generate");
  for (const button of await page.$$(".plan-row button, .agent-mode-switch button")) {
    if (!(await button.evaluate((node) => node.disabled))) await button.click();
  }
  await page.click(".agent-mode-switch button:first-child");
  await page.click(".agent-mode-switch button:nth-of-type(2)");

  await go("results");
  for (const button of await page.$$(".filter-list button")) await button.click();
  await page.click(".results-actions button:first-child");
  assert(await activeScreen("generate"), "results: regenerate did not navigate to generation");

  await go("canvas");
  for (const button of await page.$$(".tool-group--modes button, .inspector-tabs button")) await button.click();
  await page.click(".layer-footer .button");
  await page.click(".canvas-controls .button");
  await page.click(".editor-toolbar > .button");
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press("Escape");

  await go("exports");
  await go("tasks");
  for (const button of await page.$$(".filter-list button")) await button.click();
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
