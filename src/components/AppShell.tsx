import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Boxes,
  ExternalLink,
  Folder,
  Image as ImageIcon,
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
import { windowAction } from "../lib/desktop";

const navItems: Array<{ id: ScreenId; labelKey: string; icon: typeof Folder }> = [
  { id: "projects", labelKey: "nav.projects", icon: Folder },
  { id: "materials", labelKey: "nav.materials", icon: Boxes },
  { id: "generate", labelKey: "nav.generate", icon: PanelTop },
  { id: "results", labelKey: "nav.results", icon: ImageIcon },
  { id: "canvas", labelKey: "nav.canvas", icon: Scan },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const screen = useAppStore((state) => state.screen);
  const theme = useAppStore((state) => state.theme);
  const locale = useAppStore((state) => state.locale);
  const setScreen = useAppStore((state) => state.setScreen);
  const tasks = useAppStore((state) => state.tasks);
  const notify = useAppStore((state) => state.notify);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [i18n, locale]);

  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "analyzing").length;

  const navigate = (id: ScreenId) => {
    if (id === "projects" || id === "materials") {
      setScreen("generate");
      notify(id === "projects" ? "已打开当前项目" : "已定位到项目素材");
      return;
    }
    setScreen(id);
  };

  return (
    <div className={`app-shell app-shell--${screen}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <BrandMark className="brand__mark" />
          <span className="brand__name">商品图匠</span>
        </div>
        <span className="topbar__divider" />
        <div className="breadcrumb" data-tauri-drag-region>
          {screen === "settings" ? "设置" : screen === "tasks" ? "任务中心" : "便携榨汁杯 / 淘宝主图套装"}
        </div>
        <div className="topbar__actions">
          <button className="topbar-action" onClick={() => notify("新建项目向导已准备")}> <Folder size={17} /> {t("top.newProject")}</button>
          <button className="topbar-action" onClick={() => notify("项目已保存到本地")}> <Save size={17} /> {t("top.save")}</button>
          <IconButton label="设置" onClick={() => setScreen("settings")} active={screen === "settings"}><Settings size={18} /></IconButton>
          <IconButton label="菜单"><Menu size={18} /></IconButton>
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
                <button key={item.id} className={`app-nav__item ${screen === item.id ? "is-active" : ""}`} onClick={() => navigate(item.id)}>
                  <Icon size={21} strokeWidth={1.7} />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
            <button className="app-nav__item" onClick={() => notify("导出中心将在画布导出时打开")}>
              <ExternalLink size={21} strokeWidth={1.7} />
              <span>{t("nav.export")}</span>
            </button>
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
        <div className="statusbar__cell statusbar__path">项目路径 <span>D:\ListingForge\Projects\便携榨汁杯_淘宝主图套装</span> <Folder size={14} /></div>
        <div className="statusbar__cell"><StatusDot tone="success" /> {t("status.localSaved")} <span>10:28:06</span></div>
        <button className="statusbar__cell statusbar__button" onClick={() => setScreen("tasks")}><Bot size={15} /> 任务队列 <b>{activeTasks}</b></button>
        <div className="statusbar__cell"><StatusDot tone="success" /> {t("status.network")} <strong>{t("status.normal")}</strong></div>
        <div className="statusbar__cell">{t("status.apiBalance")} <span>¥122.24</span></div>
      </footer>
    </div>
  );
}
