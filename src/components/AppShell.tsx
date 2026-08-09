import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Boxes,
  ExternalLink,
  Folder,
  Image as ImageIcon,
  PanelTop,
  Play,
  Scan,
  Settings,
} from "lucide-react";
import { StatusDot } from "./ui";
import { useAppStore } from "../store/appStore";
import type { ScreenId } from "../types";

const navItems: Array<{ id: ScreenId; labelKey: string; icon: typeof Folder }> = [
  { id: "projects", labelKey: "nav.projects", icon: Folder },
  { id: "materials", labelKey: "nav.materials", icon: Boxes },
  { id: "generate", labelKey: "nav.generate", icon: PanelTop },
  { id: "results", labelKey: "nav.results", icon: ImageIcon },
  { id: "canvas", labelKey: "nav.canvas", icon: Scan },
  { id: "exports", labelKey: "nav.export", icon: ExternalLink },
];

const formatTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const screen = useAppStore((state) => state.screen);
  const theme = useAppStore((state) => state.theme);
  const locale = useAppStore((state) => state.locale);
  const currentProject = useAppStore((state) => state.currentProject);
  const setScreen = useAppStore((state) => state.setScreen);
  const tasks = useAppStore((state) => state.tasks);
  const providers = useAppStore((state) => state.providers);
  const providerBalances = useAppStore((state) => state.providerBalances);
  const [clock, setClock] = useState(() => formatTime(new Date()));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [i18n, locale]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatTime(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "analyzing").length;

  return (
    <div className={`app-shell app-shell--${screen}`}>
      <div className="app-body">
        <nav className="app-nav" aria-label="应用导航">
          <div className="app-nav__main">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`app-nav__item ${screen === item.id ? "is-active" : ""}`} onClick={() => setScreen(item.id)}>
                  <Icon size={21} strokeWidth={1.7} />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
          <div className="app-nav__footer">
            <button className={`app-nav__item ${screen === "tasks" ? "is-active" : ""}`} onClick={() => setScreen("tasks")}>
              <span className="app-nav__icon-wrap"><Play size={21} strokeWidth={1.7} />{activeTasks > 0 ? <b>{activeTasks}</b> : null}</span>
              <span>{t("nav.tasks")}</span>
            </button>
            <button className={`app-nav__item ${screen === "settings" ? "is-active" : ""}`} onClick={() => setScreen("settings")}>
              <Settings size={21} strokeWidth={1.7} />
              <span>{t("nav.settings")}</span>
            </button>
          </div>
        </nav>
        <main className="screen-area">{children}</main>
      </div>

      <footer className="statusbar">
        <div className="statusbar__cell statusbar__path" title={currentProject?.path ?? ""}>项目路径 <span>{currentProject?.path ?? "未打开项目"}</span> <Folder size={14} /></div>
        <div className="statusbar__cell"><StatusDot tone="success" /> {t("status.localSaved")} <span>{clock}</span></div>
        <button className="statusbar__cell statusbar__button" onClick={() => setScreen("tasks")}><Bot size={15} /> 任务队列 <b>{activeTasks}</b></button>
        <div className="statusbar__cell"><StatusDot tone="success" /> {t("status.network")} <strong>{t("status.normal")}</strong></div>
        <div className="statusbar__cell statusbar__balances" title="三家服务商余额 · 在「设置 → API 与模型」测试连接后刷新">
          {providers.map((provider) => (
            <span key={provider.id} title={provider.title}><StatusDot tone={provider.status === "connected" ? "success" : "muted"} />{provider.title.split("· ").pop()}{providerBalances[provider.id] === null ? " —" : ` ¥${providerBalances[provider.id]!.toFixed(2)}`}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
