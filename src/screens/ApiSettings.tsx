import { useEffect, useState } from "react";
import { Bot, Eye, FolderOpen, Globe, Image as ImageIcon, KeyRound, Moon, Palette, RefreshCcw, Save, Settings, ShieldCheck, SlidersHorizontal, Sun, TestTube2, Trash2, X } from "lucide-react";
import { Button, SectionTitle, StatusDot, Toggle } from "../components/ui";
import { getApiSecretStatus, hasTauriRuntime, saveApiSecret, testApiProvider } from "../lib/desktop";
import { clearProjectCanvasDocuments, clearProjectExports, loadSettingJson, saveSettingJson, saveUiSettings } from "../lib/database";
import { useAppStore } from "../store/appStore";
import type { ProviderId } from "../types";

type SettingsTabId = "api" | "defaults" | "storage" | "appearance" | "privacy" | "about";

const settingsNav: Array<{ id: SettingsTabId; label: string; icon: typeof KeyRound }> = [
  { id: "api", label: "API 与模型", icon: KeyRound },
  { id: "defaults", label: "生成默认值", icon: SlidersHorizontal },
  { id: "storage", label: "本地存储", icon: Save },
  { id: "appearance", label: "外观与语言", icon: Palette },
  { id: "privacy", label: "数据与隐私", icon: ShieldCheck },
  { id: "about", label: "关于", icon: Settings },
];

const tabTitles: Record<SettingsTabId, { title: string; note: string }> = {
  api: { title: "API 与模型", note: "密钥仅加密保存在这台设备上，不会上传到 ListingForge 服务器。" },
  defaults: { title: "生成默认值", note: "新方案将使用这些默认值；可在生成工作台中临时调整。" },
  storage: { title: "本地存储", note: "项目、任务、素材与导出记录全部保存在本机。" },
  appearance: { title: "外观与语言", note: "外观设置即时生效并自动保存。" },
  privacy: { title: "数据与隐私", note: "删除操作不可恢复，请谨慎使用。" },
  about: { title: "关于", note: "商品图匠 · ListingForge" },
};

export function ApiSettings() {
  const [tab, setTab] = useState<SettingsTabId>("api");
  const notify = useAppStore((state) => state.notify);
  const canReset = tab === "api" || tab === "defaults" || tab === "appearance";
  return (
    <div className="settings-screen">
      <aside className="settings-sidebar">
        <SectionTitle>设置</SectionTitle>
        <nav>{settingsNav.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon size={19} />{label}</button>)}</nav>
      </aside>

      <section className="settings-main">
        <header className="settings-title">
          <div><h1>{tabTitles[tab].title}</h1><p>{tabTitles[tab].note}</p></div>
        </header>
        {tab === "api" ? <ApiTab /> : null}
        {tab === "defaults" ? <DefaultsTab /> : null}
        {tab === "storage" ? <StorageTab /> : null}
        {tab === "appearance" ? <AppearanceTab /> : null}
        {tab === "privacy" ? <PrivacyTab /> : null}
        {tab === "about" ? <AboutTab /> : null}
      </section>

      <aside className="settings-inspector">
        <section className="model-flow"><h2>模型分工</h2><div><i><Eye size={22} /></i><span>通义千问：看懂商品</span></div><b>↓</b><div><i><Bot size={22} /></i><span>DeepSeek：规划与编排</span></div><b>↓</b><div><i><ImageIcon size={22} /></i><span>GPT-Image-2：生成与局部修改</span></div></section>
        <section className="connection-log"><h2>说明</h2><p>· 密钥保存在系统凭据库（OS Keychain / Credential Manager）。</p><p>· 费用按云端实际扣费回推展示，与官方账单一致。</p><p>· 本地数据迁移：复制整个数据目录即可。</p></section>
      </aside>

      <footer className="settings-footer">
        <span>所有更改仅保存在本地</span>
        {canReset ? <Button onClick={() => window.dispatchEvent(new CustomEvent("listingforge:settings-reset", { detail: { tab } }))}>恢复本页默认值</Button> : null}
        <Button className="settings-footer__save" variant="primary" size="lg" onClick={() => { window.dispatchEvent(new CustomEvent("listingforge:settings-save", { detail: { tab } })); void saveUiSettings({ theme: useAppStore.getState().theme, locale: useAppStore.getState().locale }); notify(`设置已保存到本地 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`); }}>保存设置</Button>
      </footer>
    </div>
  );
}

function ApiTab() {
  const providers = useAppStore((state) => state.providers);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const setProviderBalance = useAppStore((state) => state.setProviderBalance);
  const providerBalances = useAppStore((state) => state.providerBalances);
  const notify = useAppStore((state) => state.notify);
  const [secrets, setSecrets] = useState<Record<ProviderId, string>>({ apimart: "", deepseek: "", qwen: "" });
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [jsonEnabled, setJsonEnabled] = useState(true);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<ProviderId, boolean>>({ apimart: false, deepseek: false, qwen: false });

  useEffect(() => {
    let cancelled = false;
    const loadStatuses = async () => {
      const entries = await Promise.all((["apimart", "deepseek", "qwen"] as ProviderId[]).map(async (id) => [id, await getApiSecretStatus(id)] as const));
      if (cancelled) return;
      entries.forEach(([id, status]) => updateProvider(id, { maskedKey: status.maskedKey, status: "untested" }));
    };
    void loadStatuses();
    return () => { cancelled = true; };
  }, [updateProvider]);

  useEffect(() => {
    void loadSettingJson<{ toolsEnabled?: boolean; jsonEnabled?: boolean }>("deepseek_features").then((value) => {
      if (!value) return;
      setToolsEnabled(value.toolsEnabled ?? true);
      setJsonEnabled(value.jsonEnabled ?? true);
    });
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab !== "api") return;
      setSecrets({ apimart: "", deepseek: "", qwen: "" });
      setToolsEnabled(true);
      setJsonEnabled(true);
      notify("已清空未保存的密钥输入，并恢复 DeepSeek 功能默认值");
    };
    const save = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab !== "api") return;
      void saveSettingJson("deepseek_features", { toolsEnabled, jsonEnabled });
    };
    window.addEventListener("listingforge:settings-reset", reset);
    window.addEventListener("listingforge:settings-save", save);
    return () => { window.removeEventListener("listingforge:settings-reset", reset); window.removeEventListener("listingforge:settings-save", save); };
  }, [jsonEnabled, notify, toolsEnabled]);

  const testProvider = async (id: ProviderId) => {
    updateProvider(id, { status: "testing" });
    try {
      const result = await testApiProvider(id);
      updateProvider(id, { status: result.ok ? "connected" : "failed" });
      setProviderBalance(id, result.ok && typeof result.balance === "number" ? result.balance : null);
      if (result.ok) {
        const balanceText = typeof result.balance === "number" ? ` · 余额 ¥${result.balance.toFixed(2)}` : "";
        notify(`连接成功（${result.latencyMs}ms）${balanceText}`);
      } else {
        notify(`连接失败：${result.message}`);
      }
    } catch (error) {
      updateProvider(id, { status: "failed" });
      notify(error instanceof Error ? error.message : "连接测试失败");
    }
  };

  const saveSecret = async (id: ProviderId) => {
    const secret = secrets[id].trim();
    if (!secret) {
      notify("请先在本地填写 API Key");
      return;
    }
    try {
      const maskedKey = await saveApiSecret(id, secret);
      updateProvider(id, { maskedKey, status: "untested" });
      setSecrets((current) => ({ ...current, [id]: "" }));
      notify("密钥已保存到系统安全凭据库");
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存密钥失败");
    }
  };

  return (
    <>
      <div className="provider-list">
        {providers.map((provider) => (
          <section className="provider-section" key={provider.id}>
            <header><h2>{provider.title}</h2><span className={`provider-status provider-status--${provider.status}`}><StatusDot tone={provider.status === "connected" ? "success" : provider.status === "failed" ? "danger" : "muted"} />{provider.status === "connected" ? "已连接" : provider.status === "testing" ? "测试中" : provider.status === "failed" ? "连接失败" : "未测试"}</span></header>
            <div className="provider-fields">
              <label><span>API Key</span><div className="secret-field"><input type={visibleSecrets[provider.id] ? "text" : "password"} autoComplete="off" value={secrets[provider.id]} placeholder={provider.maskedKey || "在本地填写 API Key"} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} /><button type="button" aria-label={visibleSecrets[provider.id] ? "隐藏密钥" : "显示密钥"} onClick={() => setVisibleSecrets((current) => ({ ...current, [provider.id]: !current[provider.id] }))}><Eye size={17} /></button></div></label>
              <label><span>端点地址</span><input value={provider.endpoint} readOnly /></label>
              <label><span>模型</span><select className="field-select-static" value={provider.model} disabled title="当前版本固定使用该模型"><option value={provider.model}>{provider.model}</option></select></label>
              <div className="provider-actions"><Button icon={<TestTube2 size={16} />} disabled={provider.status === "testing"} onClick={() => void testProvider(provider.id)}>测试连接</Button><Button onClick={() => void saveSecret(provider.id)}>更新密钥</Button></div>
            </div>
            {provider.id === "apimart" ? <p className="provider-note">异步任务 · 支持 1K / 2K / 4K</p> : null}
            {provider.id === "deepseek" ? <div className="provider-switches"><label>工具调用 <Toggle checked={toolsEnabled} onChange={setToolsEnabled} label="工具调用" /></label><label>JSON 结构化输出 <Toggle checked={jsonEnabled} onChange={setJsonEnabled} label="JSON 结构化输出" /></label></div> : null}
          </section>
        ))}
      </div>

      <section className="cost-settings">
        <h2>账户余额</h2>
        <p>点击上方「测试连接」后，此处与状态栏会分别显示三家服务商的最新余额；无余额接口的服务商显示 —。</p>
        <div className="storage-rows">
          {providers.map((provider) => (
            <label key={provider.id}><span>{provider.title}</span><code>{providerBalances[provider.id] === null ? "—" : `¥${providerBalances[provider.id]!.toFixed(2)}`}</code></label>
          ))}
        </div>
        <h2>费用说明</h2>
        <p>按 API 接口方实际扣费回推单价并展示在状态栏与任务列表中；三家服务商的余额分别显示。</p>
      </section>
    </>
  );
}

function DefaultsTab() {
  const [resolution, setResolution] = useState<string>("1k");
  const [concurrency, setConcurrency] = useState(2);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const defaults = await loadSettingJson<{ resolution: string; concurrency: number }>("generation_defaults");
      if (cancelled || !defaults) return;
      setResolution(defaults.resolution);
      setConcurrency(defaults.concurrency);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab !== "defaults") return;
      setResolution("1k");
      setConcurrency(2);
      void saveSettingJson("generation_defaults", { resolution: "1k", concurrency: 2 });
    };
    window.addEventListener("listingforge:settings-reset", reset);
    return () => window.removeEventListener("listingforge:settings-reset", reset);
  }, []);

  const persist = async () => {
    await saveSettingJson("generation_defaults", { resolution, concurrency });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <section className="cost-settings">
      <h2>新方案的默认参数</h2>
      <p>以下值会在生成工作台初始化时使用，可在提交前调整。</p>
      <div>
        <span>清晰度</span>
        <label>分辨率<select className="field-select-static" value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="1k">1K</option><option value="2k">2K</option><option value="4k">4K</option></select></label>
        <span>并发任务数</span>
        <label>并发<select className="field-select-static" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
      </div>
      <Button variant="primary" onClick={() => void persist()}>{saved ? "已保存 ✓" : "保存默认值"}</Button>
    </section>
  );
}

function StorageTab() {
  const notify = useAppStore((state) => state.notify);
  const currentProject = useAppStore((state) => state.currentProject);
  const [appData, setAppData] = useState<string>("");

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const dir = await appDataDir();
      if (!cancelled) setAppData(dir);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab === "storage") notify("存储位置由系统和当前项目决定，无可重置项");
    };
    window.addEventListener("listingforge:settings-reset", reset);
    return () => window.removeEventListener("listingforge:settings-reset", reset);
  }, [notify]);

  const openPath = async (path: string, label: string) => {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(path);
    } catch {
      notify(`无法打开${label}`);
    }
  };

  return (
    <section className="cost-settings">
      <h2>数据位置</h2>
      <p>数据库文件 listingforge.db 与密钥管理独立；项目目录由用户选择。</p>
      <div className="storage-rows">
        <label><span>应用数据目录</span><code>{appData || "（仅桌面版可见）"}</code></label>
        <label><span>当前项目目录</span><code>{currentProject?.path ?? "未打开项目"}</code></label>
      </div>
      <div className="storage-actions">
        <Button icon={<FolderOpen size={15} />} disabled={!hasTauriRuntime() || !appData} onClick={() => void openPath(appData, "数据目录")}>打开数据目录</Button>
        <Button icon={<FolderOpen size={15} />} disabled={!hasTauriRuntime() || !currentProject} onClick={() => void openPath(currentProject!.path, "项目目录")}>打开当前项目目录</Button>
      </div>
      <p className="provider-note">迁移或备份：关闭应用后复制整个数据目录即可。</p>
    </section>
  );
}

function AppearanceTab() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab !== "appearance") return;
      setTheme("dark");
      setLocale("zh-CN");
      void saveUiSettings({ theme: "dark", locale: "zh-CN" });
    };
    window.addEventListener("listingforge:settings-reset", reset);
    return () => window.removeEventListener("listingforge:settings-reset", reset);
  }, [setLocale, setTheme]);
  return (
    <section className="cost-settings">
      <h2>主题</h2>
      <div className="storage-rows">
        <label><span>外观模式</span><button className={`theme-switch ${theme === "light" ? "is-light" : ""}`} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Sun size={16} /> : <Moon size={16} />}{theme === "light" ? "浅色" : "深色"}</button></label>
        <label><span>界面语言</span><select className="field-select-static" value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en")}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      </div>
      <p className="provider-note">外观与语言设置会自动保存并跨启动生效。</p>
    </section>
  );
}

function PrivacyTab() {
  const notify = useAppStore((state) => state.notify);
  const currentProject = useAppStore((state) => state.currentProject);
  const [confirming, setConfirming] = useState<"canvas" | "exports" | "ui" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab === "privacy") notify("隐私页没有可恢复的默认值；清理数据必须单独确认");
    };
    window.addEventListener("listingforge:settings-reset", reset);
    return () => window.removeEventListener("listingforge:settings-reset", reset);
  }, [notify]);

  const runClear = async (kind: "canvas" | "exports" | "ui") => {
    setBusy(true);
    try {
      if (kind === "canvas") {
        const count = await clearProjectCanvasDocuments();
        notify(`已清除 ${count} 条画布文档记录`);
      } else if (kind === "exports") {
        const count = await clearProjectExports();
        notify(`已清除 ${count} 条导出记录`);
      } else {
        localStorage.removeItem("listingforge-ui");
        notify("界面设置已重置，应用即将刷新");
        window.setTimeout(() => window.location.reload(), 800);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <section className="cost-settings">
      <h2>清除本地数据</h2>
      <p>以下操作只影响当前项目「{currentProject?.name ?? "未打开项目"}」，删除后不可恢复。</p>
      <div className="storage-actions">
        <Button icon={<Trash2 size={15} />} variant="danger" disabled={!hasTauriRuntime() || !currentProject || busy} onClick={() => setConfirming("canvas")}>清除画布文档</Button>
        <Button icon={<Trash2 size={15} />} variant="danger" disabled={!hasTauriRuntime() || !currentProject || busy} onClick={() => setConfirming("exports")}>清除导出记录</Button>
        <Button icon={<RefreshCcw size={15} />} disabled={busy} onClick={() => setConfirming("ui")}>重置界面设置</Button>
      </div>
      {confirming ? (
        <div className="modal-backdrop" role="dialog">
          <div className="modal">
            <header><h2>{confirming === "canvas" ? "清除画布文档" : confirming === "exports" ? "清除导出记录" : "重置界面设置"}</h2><button className="modal-close" aria-label="关闭" onClick={() => setConfirming(null)}><X size={16} /></button></header>
            <p className="modal-warning">{confirming === "ui" ? "将清除界面外观与语言设置并刷新应用。" : "删除后不可恢复，确定继续吗？"}</p>
            <footer className="modal-actions"><Button onClick={() => setConfirming(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => void runClear(confirming)}>{busy ? "处理中…" : "确认清除"}</Button></footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AboutTab() {
  const notify = useAppStore((state) => state.notify);
  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ tab: SettingsTabId }>).detail.tab === "about") notify("关于页没有可恢复的默认值");
    };
    window.addEventListener("listingforge:settings-reset", reset);
    return () => window.removeEventListener("listingforge:settings-reset", reset);
  }, [notify]);
  const openRepo = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/zhou9527-lj/listingforge");
    } catch {
      notify("请在浏览器中打开 https://github.com/zhou9527-lj/listingforge");
    }
  };
  return (
    <section className="cost-settings">
      <h2>商品图匠 · ListingForge</h2>
      <p>AI 电商商品图生产工作台：上传素材 → Agent 规划 → 三模型协作出图 → 画布精修 → 导出。</p>
      <div className="storage-rows">
              <label><span>版本</span><code>0.1.3（{hasTauriRuntime() ? "桌面版" : "浏览器预览"}）</code></label>
        <label><span>数据</span><code>SQLite 本地存储 · 密钥走系统凭据库</code></label>
        <label><span>项目主页</span><code>github.com/zhou9527-lj/listingforge</code></label>
      </div>
      <div className="storage-actions">
        <Button icon={<Globe size={15} />} onClick={() => void openRepo()}>打开项目主页</Button>
      </div>
    </section>
  );
}
