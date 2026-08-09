import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Boxes,
  ExternalLink,
  Folder,
  Image as ImageIcon,
  Info,
  Menu,
  Minus,
  PanelTop,
  Play,
  Save,
  Scan,
  Settings,
  Square,
  X,
} from "lucide-react";
import { BrandMark } from "./BrandMark";
import { IconButton, StatusDot } from "./ui";
import { useAppStore } from "../store/appStore";
import type { ScreenId } from "../types";
import { hasTauriRuntime, windowAction } from "../lib/desktop";
import { saveUiSettings, touchProjectRecord } from "../lib/database";

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
  const notify = useAppStore((state) => state.notify);
  const openProjectCreator = useAppStore((state) => state.openProjectCreator);
  const providers = useAppStore((state) => state.providers);
  const providerBalances = useAppStore((state) => state.providerBalances);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(() => formatTime(new Date()));
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", closeOnOutside);
    return () => window.removeEventListener("mousedown", closeOnOutside);
  }, [menuOpen]);

  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "analyzing").length;

  const handleSave = () => {
    void (async () => {
      try {
        await saveUiSettings({ theme, locale });
        if (currentProject) await touchProjectRecord(currentProject.id);
        notify(`已保存到本地 ${formatTime(new Date())}`);
      } catch (error) {
        notify(error instanceof Error ? error.message : "保存失败");
      }
    })();
  };

  const handleMenu = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const breadcrumb = screen === "settings" ? "设置" : screen === "tasks" ? "任务中心" : currentProject ? currentProject.name : "未打开项目";

  return (
    <div className={`app-shell app-shell--${screen}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <BrandMark className="brand__mark" />
          <span className="brand__name">商品图匠</span>
        </div>
        <span className="topbar__divider" />
        <div className="breadcrumb" data-tauri-drag-region title={currentProject?.path ?? ""}>{breadcrumb}</div>
        <div className="topbar__actions">
          <button className="topbar-action" onClick={openProjectCreator}> <Folder size={17} /> {t("top.newProject")}</button>
          <button className="topbar-action" onClick={handleSave}> <Save size={17} /> {t("top.save")}</button>
          <IconButton label="设置" onClick={() => setScreen("settings")} active={screen === "settings"}><Settings size={18} /></IconButton>
          <div className="menu-anchor" ref={menuRef}>
            <IconButton label="菜单" active={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Menu size={18} /></IconButton>
            {menuOpen ? (
              <div className="top-menu" role="menu">
                <button role="menuitem" onClick={() => handleMenu(openProjectCreator)}><Folder size={15} /> 新建项目</button>
                <button role="menuitem" onClick={() => handleMenu(() => setScreen("projects"))}><Boxes size={15} /> 项目管理器</button>
                <button role="menuitem" onClick={() => handleMenu(() => setScreen("tasks"))}><Play size={15} /> 任务中心</button>
                <button role="menuitem" onClick={() => handleMenu(() => setScreen("exports"))}><ExternalLink size={15} /> 导出中心</button>
                <button role="menuitem" onClick={() => handleMenu(() => setScreen("settings"))}><Settings size={15} /> 设置</button>
                <div className="top-menu__divider" />
                <button role="menuitem" onClick={() => handleMenu(() => notify(`商品图匠 0.1.0 · ${hasTauriRuntime() ? "桌面版" : "浏览器预览"}`))}><Info size={15} /> 关于</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="window-controls">
          <IconButton label="最小化" onClick={() => void windowAction("minimize")}><Minus size={16} /></IconButton>
          <IconButton label="最大化或还原" onClick={() => void windowAction("toggleMaximize")}><Square size={13} /></IconButton>
          <IconButton label="关闭" className="window-control--close" onClick={() => void windowAction("close")}><X size={17} /></IconButton>
        </div>
      </header>

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
