import { useEffect, useState } from "react";
import { Download, FolderOpen, ImagePlus, Layers, Trash2 } from "lucide-react";
import { Button, SectionTitle } from "../components/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { hasTauriRuntime, importAsset } from "../lib/desktop";
import {
  addAssetRecord,
  assetRoleLabel,
  deleteAssetRecord,
  getProjectPath,
  listProjectAssets,
  type AssetRecord,
} from "../lib/database";
import { useAppStore } from "../store/appStore";

const ROLES = ["product", "logo", "package", "detail", "style"] as const;
type Role = (typeof ROLES)[number];

export function Materials() {
  const notify = useAppStore((state) => state.notify);
  const setScreen = useAppStore((state) => state.setScreen);
  const currentProject = useAppStore((state) => state.currentProject);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [role, setRole] = useState<Role | "all">("all");
  const [importing, setImporting] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);

  const refresh = async () => {
    if (!hasTauriRuntime()) return;
    try {
      setProjectPath(await getProjectPath());
      setAssets(await listProjectAssets());
    } catch (error) {
      notify(error instanceof Error ? error.message : "读取素材失败");
    }
  };

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [path, list] = await Promise.all([getProjectPath(), listProjectAssets()]);
        if (cancelled) return;
        setProjectPath(path);
        setAssets(list);
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "读取素材失败");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, notify]);

  const pickAndImport = async (targetRole: Role) => {
    if (!projectPath) {
      notify("请先打开一个项目");
      return;
    }
    setImporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (typeof chosen === "string") {
        const imported = await importAsset(projectPath, chosen, targetRole);
        await addAssetRecord(targetRole, imported.path, imported.sha256, imported.mime);
        notify(`已导入素材到「${assetRoleLabel(targetRole)}」`);
        await refresh();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入素材失败");
    } finally {
      setImporting(false);
    }
  };

  const removeAsset = async (asset: AssetRecord) => {
    try {
      await deleteAssetRecord(asset.id);
      notify("素材已移除");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除素材失败");
    }
  };

  const visible = role === "all" ? assets : assets.filter((asset) => asset.role === role);

  if (!currentProject) {
    return (
      <div className="screen-layout">
        <section className="workspace">
          <div className="empty-state">
            <Layers size={40} strokeWidth={1.4} />
            <h3>尚未打开项目</h3>
            <p>素材库归属于具体项目，请先打开或创建一个项目。</p>
            <Button variant="primary" onClick={() => setScreen("projects")}>前往项目管理器</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-layout screen-layout--materials">
      <section className="workspace materials-workspace">
        <header className="materials-header">
          <div>
            <SectionTitle>项目素材库</SectionTitle>
            <p>素材复制到项目目录 assets/ 下，按角色分类，仅供本项目使用。</p>
          </div>
          <div className="materials-header__actions">
            <select className="role-select" value={role} onChange={(event) => setRole(event.target.value as Role | "all")}>
              <option value="all">全部素材</option>
              {ROLES.map((item) => <option key={item} value={item}>{assetRoleLabel(item)}</option>)}
            </select>
            <div className="role-actions">
              {ROLES.map((item) => (
                <Button key={item} size="sm" disabled={importing} onClick={() => void pickAndImport(item)} icon={<ImagePlus size={14} />}>
                  导入{assetRoleLabel(item)}
                </Button>
              ))}
            </div>
          </div>
        </header>

        {!hasTauriRuntime() ? (
          <div className="empty-state">
            <Download size={40} strokeWidth={1.4} />
            <h3>素材导入仅桌面版可用</h3>
            <p>浏览器预览无法访问本地文件选择器。</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={40} strokeWidth={1.4} />
            <h3>{role === "all" ? "素材库是空的" : `还没有「${assetRoleLabel(role)}」素材`}</h3>
            <p>从上方选择角色导入图片；生成工作台与画布都可直接使用这些素材。</p>
          </div>
        ) : (
          <div className="asset-grid">
            {visible.map((asset) => (
              <article className="asset-card" key={asset.id}>
                <div className="asset-card__thumb">
                  <img src={convertFileSrc(asset.path)} alt={assetRoleLabel(asset.role)} loading="lazy" />
                </div>
                <footer>
                  <span className="asset-card__role">{assetRoleLabel(asset.role)}</span>
                  <span className="asset-card__mime">{asset.mime.replace("image/", "").toUpperCase()}</span>
                  <button className="asset-card__remove" aria-label="移除素材" title="移除素材" onClick={() => void removeAsset(asset)}><Trash2 size={14} /></button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
