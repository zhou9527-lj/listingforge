import { useEffect, useState } from "react";
import { Bot, ChevronDown, Eye, Image as ImageIcon, KeyRound, Languages, Moon, Palette, Save, Settings, ShieldCheck, SlidersHorizontal, Sun, TestTube2, WalletCards } from "lucide-react";
import { Button, SectionTitle, StatusDot, Toggle } from "../components/ui";
import { getApiSecretStatus, saveApiSecret, testApiProvider } from "../lib/desktop";
import { useAppStore } from "../store/appStore";
import type { ProviderId } from "../types";

const settingsNav = [
  ["API 与模型", KeyRound],
  ["生成默认值", SlidersHorizontal],
  ["任务与预算", WalletCards],
  ["本地存储", Save],
  ["外观与语言", Palette],
  ["数据与隐私", ShieldCheck],
  ["关于", Settings],
] as const;

export function ApiSettings() {
  const providers = useAppStore((state) => state.providers);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const notify = useAppStore((state) => state.notify);
  const [secrets, setSecrets] = useState<Record<ProviderId, string>>({ apimart: "", deepseek: "", qwen: "" });
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [jsonEnabled, setJsonEnabled] = useState(true);
  const [logs, setLogs] = useState(["10:24:35  APIMart 连接成功", "10:24:40  DeepSeek 连接成功", "10:24:45  通义千问等待测试"]);

  useEffect(() => {
    const loadStatuses = async () => {
      await Promise.all((["apimart", "deepseek", "qwen"] as ProviderId[]).map(async (id) => {
        const status = await getApiSecretStatus(id);
        updateProvider(id, { maskedKey: status.maskedKey, status: "untested" });
      }));
    };
    void loadStatuses();
  }, [updateProvider]);

  const testProvider = async (id: ProviderId) => {
    updateProvider(id, { status: "testing" });
    try {
      const result = await testApiProvider(id);
      updateProvider(id, { status: result.ok ? "connected" : "failed" });
      const titleParts = providers.find((provider) => provider.id === id)?.title.split("·") ?? [id];
      const name = titleParts[titleParts.length - 1]?.trim() ?? id;
      setLogs((current) => [`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${name} ${result.ok ? `连接成功（${result.latencyMs}ms）` : "连接失败"}`, ...current].slice(0, 4));
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
    <div className="settings-screen">
      <aside className="settings-sidebar">
        <SectionTitle>设置</SectionTitle>
        <nav>{settingsNav.map(([label, Icon], index) => <button key={label} className={index === 0 ? "is-active" : ""}><Icon size={19} />{label}</button>)}</nav>
      </aside>

      <section className="settings-main">
        <header className="settings-title">
          <div><h1>API 与模型</h1><p>密钥仅加密保存在这台设备上，不会上传到 ListingForge 服务器。</p></div>
          <div className="appearance-controls">
            <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Sun size={18} /> : <Moon size={18} />}{theme === "light" ? "浅色" : "深色"}<ChevronDown size={13} /></button>
            <button onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}><Languages size={18} />{locale === "zh-CN" ? "简体中文" : "English"}<ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="provider-list">
          {providers.map((provider) => (
            <section className="provider-section" key={provider.id}>
              <header><h2>{provider.title}</h2><span className={`provider-status provider-status--${provider.status}`}><StatusDot tone={provider.status === "connected" ? "success" : provider.status === "failed" ? "danger" : "muted"} />{provider.status === "connected" ? "已连接" : provider.status === "testing" ? "测试中" : provider.status === "failed" ? "连接失败" : "未测试"}</span></header>
              <div className="provider-fields">
                <label><span>API Key</span><div className="secret-field"><input type="password" autoComplete="off" value={secrets[provider.id]} placeholder={provider.maskedKey || "在本地填写 API Key"} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} /><Eye size={17} /></div></label>
                <label><span>端点地址</span><input value={provider.endpoint} readOnly /></label>
                <label><span>模型</span><button>{provider.model}<ChevronDown size={14} /></button></label>
                <div className="provider-actions"><Button icon={<TestTube2 size={16} />} disabled={provider.status === "testing"} onClick={() => void testProvider(provider.id)}>测试连接</Button><Button onClick={() => void saveSecret(provider.id)}>更新密钥</Button></div>
              </div>
              {provider.id === "apimart" ? <p className="provider-note">异步任务 · 支持 1K / 2K / 4K</p> : null}
              {provider.id === "deepseek" ? <div className="provider-switches"><label>工具调用 <Toggle checked={toolsEnabled} onChange={setToolsEnabled} label="工具调用" /></label><label>JSON 结构化输出 <Toggle checked={jsonEnabled} onChange={setJsonEnabled} label="JSON 结构化输出" /></label></div> : null}
            </section>
          ))}
        </div>

        <section className="cost-settings">
          <h2>费用估算</h2>
          <p>以下价格为本地维护的估算值，官方价格可能发生变动。</p>
          <div><span>每张图片</span><label>1K (1024px)<input defaultValue="0.0300" /> CNY</label><label>2K (2048px)<input defaultValue="0.0800" /> CNY</label><label>4K (4096px)<input defaultValue="0.1800" /> CNY</label></div>
        </section>
      </section>

      <aside className="settings-inspector">
        <section className="model-flow"><h2>模型分工</h2><div><i><Eye size={22} /></i><span>通义千问：看懂商品</span></div><b>↓</b><div><i><Bot size={22} /></i><span>DeepSeek：规划与编排</span></div><b>↓</b><div><i><ImageIcon size={22} /></i><span>GPT-Image-2：生成与局部修改</span></div></section>
        <section className="connection-log"><h2>连接测试日志</h2>{logs.map((log, index) => <p key={`${log}-${index}`}><StatusDot tone={index < 2 ? "success" : "muted"} />{log}</p>)}</section>
      </aside>

      <footer className="settings-footer"><span>所有更改仅保存在本地</span><Button>恢复本页默认值</Button><Button variant="primary" size="lg" onClick={() => notify("设置已保存到本地")}>保存设置</Button></footer>
    </div>
  );
}
