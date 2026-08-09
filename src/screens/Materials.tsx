import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, CopyPlus, FolderOpen, ImagePlus, Layers, Pencil, Plus, Search, Square, Trash2, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button, SectionTitle } from "../components/ui";
import { generationTypes as builtinTypes } from "../data/demo";
import { deleteGlobalAssetFile, hasTauriRuntime, importAsset, importGlobalAsset } from "../lib/desktop";
import {
  addAssetRecord,
  addGlobalAssetRecord,
  assetRoleLabel,
  deleteAssetRecord,
  deleteCustomGenerationType,
  deleteGlobalAssetRecord,
  getProjectPath,
  listCustomGenerationTypes,
  listGlobalAssets,
  listProjectAssets,
  renameGlobalAssetRecord,
  saveCustomGenerationType,
  type AssetRecord,
  type CustomGenerationTypeRecord,
  type GlobalAssetRecord,
} from "../lib/database";
import { createId } from "../lib/ids";
import { useAppStore } from "../store/appStore";

const ROLES = ["product", "logo", "package", "detail", "style"] as const;
type Role = (typeof ROLES)[number];
type LibraryTab = "global" | "project" | "types";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? "未命名素材";

export function Materials() {
  const notify = useAppStore((state) => state.notify);
  const currentProject = useAppStore((state) => state.currentProject);
  const openResultInCanvas = useAppStore((state) => state.openResultInCanvas);
  const [tab, setTab] = useState<LibraryTab>("global");
  const [globalAssets, setGlobalAssets] = useState<GlobalAssetRecord[]>([]);
  const [projectAssets, setProjectAssets] = useState<AssetRecord[]>([]);
  const [customTypes, setCustomTypes] = useState<CustomGenerationTypeRecord[]>([]);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [role, setRole] = useState<Role | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<GlobalAssetRecord | AssetRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<GlobalAssetRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "global" | "project" | "type" | "global-batch"; item?: GlobalAssetRecord | AssetRecord | CustomGenerationTypeRecord } | null>(null);
  const [typeEditor, setTypeEditor] = useState<CustomGenerationTypeRecord | "new" | null>(null);

  const refresh = useCallback(async () => {
    if (!hasTauriRuntime()) return;
    try {
      const [path, globalList, projectList, typeList] = await Promise.all([
        getProjectPath(),
        listGlobalAssets(),
        listProjectAssets(),
        listCustomGenerationTypes(),
      ]);
      setProjectPath(path);
      setGlobalAssets(globalList);
      setProjectAssets(projectList);
      setCustomTypes(typeList);
      setSelectedIds((current) => current.filter((id) => globalList.some((asset) => asset.id === id)));
    } catch (error) {
      notify(error instanceof Error ? error.message : "读取素材库失败");
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [currentProject?.id, refresh]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreview(null);
      setRenameTarget(null);
      setDeleteTarget(null);
      setTypeEditor(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const visibleGlobal = useMemo(() => globalAssets.filter((asset) => {
    const matchesRole = role === "all" || asset.role === role;
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesRole && (!keyword || asset.name.toLocaleLowerCase("zh-CN").includes(keyword));
  }), [globalAssets, query, role]);

  const visibleProject = useMemo(() => projectAssets.filter((asset) => {
    const matchesRole = role === "all" || asset.role === role;
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesRole && (!keyword || fileName(asset.path).toLocaleLowerCase("zh-CN").includes(keyword));
  }), [projectAssets, query, role]);

  const pickImage = async (): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({ multiple: false, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    return typeof chosen === "string" ? chosen : null;
  };

  const addGlobal = async (targetRole: Role, sourcePath?: string) => {
    setBusy(true);
    try {
      const chosen = sourcePath ?? await pickImage();
      if (!chosen) return;
      const imported = await importGlobalAsset(chosen);
      await addGlobalAssetRecord(fileName(chosen), targetRole, imported.path, imported.sha256, imported.mime);
      notify(`已加入全局素材库 · ${assetRoleLabel(targetRole)}`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入全局素材失败");
    } finally {
      setBusy(false);
    }
  };

  const addProject = async (targetRole: Role, sourcePath?: string) => {
    if (!projectPath) {
      notify("请先打开一个项目");
      return;
    }
    setBusy(true);
    try {
      const chosen = sourcePath ?? await pickImage();
      if (!chosen) return;
      const imported = await importAsset(projectPath, chosen, targetRole);
      await addAssetRecord(targetRole, imported.path, imported.sha256, imported.mime);
      notify(`已复制到当前项目 · ${assetRoleLabel(targetRole)}`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入项目素材失败");
    } finally {
      setBusy(false);
    }
  };

  const copySelectedToProject = async () => {
    if (!projectPath) {
      notify("请先打开一个项目");
      return;
    }
    const selected = globalAssets.filter((asset) => selectedIds.includes(asset.id));
    if (!selected.length) return;
    setBusy(true);
    try {
      for (const asset of selected) {
        const imported = await importAsset(projectPath, asset.path, asset.role);
        await addAssetRecord(asset.role, imported.path, imported.sha256, imported.mime);
      }
      notify(`已把 ${selected.length} 个全局素材复制到当前项目`);
      setSelectedIds([]);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "复制素材失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget.kind === "global-batch") {
        const targets = globalAssets.filter((asset) => selectedIds.includes(asset.id));
        for (const asset of targets) {
          await deleteGlobalAssetFile(asset.path);
          await deleteGlobalAssetRecord(asset.id);
        }
        notify(`已删除 ${targets.length} 个全局素材及其本地文件`);
        setSelectedIds([]);
      } else if (deleteTarget.kind === "global" && deleteTarget.item) {
        const asset = deleteTarget.item as GlobalAssetRecord;
        await deleteGlobalAssetFile(asset.path);
        await deleteGlobalAssetRecord(asset.id);
        notify("全局素材及其本地文件已删除");
      } else if (deleteTarget.kind === "project" && deleteTarget.item) {
        await deleteAssetRecord(deleteTarget.item.id);
        notify("已从项目素材列表移除；磁盘文件仍保留");
      } else if (deleteTarget.kind === "type" && deleteTarget.item) {
        await deleteCustomGenerationType(deleteTarget.item.id);
        notify("自定义图片类型已删除");
      }
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const allVisibleSelected = visibleGlobal.length > 0 && visibleGlobal.every((asset) => selectedIds.includes(asset.id));

  /** 把项目素材作为画布底图打开（保留本地路径，后续抠图等能力可用）。 */
  const openInCanvas = (assetPath: string) => {
    openResultInCanvas(convertFileSrc(assetPath), undefined, assetPath);
    notify("已从素材库打开画布，可继续编辑或叠加排版");
  };

  return (
    <div className="screen-layout screen-layout--materials">
      <section className="workspace materials-workspace">
        <header className="materials-header materials-header--library">
          <div>
            <SectionTitle>素材与图片类型</SectionTitle>
            <p>全局素材跨项目复用；加入项目时会复制一份，确保工程可迁移。</p>
          </div>
          <div className="materials-tabs" role="tablist">
            <button className={tab === "global" ? "is-active" : ""} onClick={() => setTab("global")}>全局素材 <b>{globalAssets.length}</b></button>
            <button className={tab === "project" ? "is-active" : ""} onClick={() => setTab("project")}>当前项目 <b>{projectAssets.length}</b></button>
            <button className={tab === "types" ? "is-active" : ""} onClick={() => setTab("types")}>图片类型 <b>{builtinTypes.length + customTypes.length}</b></button>
          </div>
        </header>

        {tab !== "types" ? (
          <div className="materials-toolbar">
            <label className="materials-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称" /></label>
            <select className="role-select" value={role} onChange={(event) => setRole(event.target.value as Role | "all")}>
              <option value="all">全部分类</option>
              {ROLES.map((item) => <option key={item} value={item}>{assetRoleLabel(item)}</option>)}
            </select>
            <span />
            {tab === "global" && visibleGlobal.length ? <Button size="sm" icon={allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />} onClick={() => setSelectedIds(allVisibleSelected ? [] : visibleGlobal.map((asset) => asset.id))}>{allVisibleSelected ? "取消全选" : "全选当前"}</Button> : null}
            {tab === "global" && selectedIds.length ? <Button size="sm" icon={<CopyPlus size={14} />} disabled={busy || !currentProject} onClick={() => void copySelectedToProject()}>复制到项目（{selectedIds.length}）</Button> : null}
            {tab === "global" && selectedIds.length ? <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={busy} onClick={() => setDeleteTarget({ kind: "global-batch" })}>删除所选</Button> : null}
            <Button variant="primary" size="sm" icon={<ImagePlus size={14} />} disabled={busy || (tab === "project" && !currentProject)} onClick={() => void (tab === "global" ? addGlobal(role === "all" ? "product" : role) : addProject(role === "all" ? "product" : role))}>导入为{role === "all" ? "主图" : assetRoleLabel(role)}</Button>
          </div>
        ) : null}

        {!hasTauriRuntime() ? (
          <Empty icon={<Layers size={40} />} title="素材管理仅桌面版可用" note="浏览器预览不访问本地文件与 SQLite。" />
        ) : tab === "global" ? (
          visibleGlobal.length ? (
            <div className="asset-grid asset-grid--library">
              {visibleGlobal.map((asset) => {
                const selected = selectedIds.includes(asset.id);
                return <article className={`asset-card ${selected ? "is-selected" : ""}`} key={asset.id}>
                  <button className="asset-card__thumb" onClick={() => setPreview(asset)}><img src={convertFileSrc(asset.path)} alt={asset.name} loading="lazy" /></button>
                  <button className="asset-card__select" aria-label={`选择${asset.name}`} onClick={() => setSelectedIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])}>{selected ? <CheckSquare size={17} /> : <Square size={17} />}</button>
                  <footer><span><strong title={asset.name}>{asset.name}</strong><small>{assetRoleLabel(asset.role)} · {asset.mime.replace("image/", "").toUpperCase()}</small></span><button aria-label="重命名" onClick={() => setRenameTarget(asset)}><Pencil size={14} /></button><button aria-label="删除" onClick={() => setDeleteTarget({ kind: "global", item: asset })}><Trash2 size={14} /></button></footer>
                </article>;
              })}
            </div>
          ) : <Empty icon={<FolderOpen size={40} />} title={query || role !== "all" ? "没有匹配的全局素材" : "全局素材库是空的"} note="导入后可供所有新项目和已有项目选择。" />
        ) : tab === "project" ? (
          !currentProject ? <Empty icon={<FolderOpen size={40} />} title="尚未打开项目" note="打开项目后可查看项目私有素材，或先管理全局素材。" /> : visibleProject.length ? (
            <div className="asset-grid asset-grid--library">
              {visibleProject.map((asset) => <article className="asset-card" key={asset.id}>
                <button className="asset-card__thumb" onClick={() => setPreview(asset)}><img src={convertFileSrc(asset.path)} alt={fileName(asset.path)} loading="lazy" /></button>
                <footer><span><strong title={fileName(asset.path)}>{fileName(asset.path)}</strong><small>{assetRoleLabel(asset.role)} · 仅当前项目</small></span><button aria-label="加入画布" title="加入画布作为底图继续编辑" onClick={() => openInCanvas(asset.path)}><ImagePlus size={14} /></button><button aria-label="加入全局素材库" title="加入全局素材库" disabled={busy} onClick={() => void addGlobal(asset.role as Role, asset.path)}><CopyPlus size={14} /></button><button aria-label="从列表移除" onClick={() => setDeleteTarget({ kind: "project", item: asset })}><Trash2 size={14} /></button></footer>
              </article>)}
            </div>
          ) : <Empty icon={<FolderOpen size={40} />} title="当前项目没有匹配素材" note="项目素材默认保持私有；点击卡片上的复制按钮可明确加入全局库。" />
        ) : (
          <TypeLibrary customTypes={customTypes} onCreate={() => setTypeEditor("new")} onEdit={setTypeEditor} onDelete={(item) => setDeleteTarget({ kind: "type", item })} />
        )}
      </section>

      {preview ? <PreviewModal asset={preview} onClose={() => setPreview(null)} /> : null}
      {renameTarget ? <RenameModal asset={renameTarget} onClose={() => setRenameTarget(null)} onSave={async (name) => { await renameGlobalAssetRecord(renameTarget.id, name); setRenameTarget(null); await refresh(); }} /> : null}
      {typeEditor ? <TypeEditorModal value={typeEditor === "new" ? null : typeEditor} assets={globalAssets} onClose={() => setTypeEditor(null)} onSaved={async () => { setTypeEditor(null); await refresh(); }} /> : null}
      {deleteTarget ? <ConfirmDeleteModal target={deleteTarget} count={deleteTarget.kind === "global-batch" ? selectedIds.length : 1} busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} /> : null}
    </div>
  );
}

function Empty({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="empty-state">{icon}<h3>{title}</h3><p>{note}</p></div>;
}

function TypeLibrary({ customTypes, onCreate, onEdit, onDelete }: { customTypes: CustomGenerationTypeRecord[]; onCreate: () => void; onEdit: (type: CustomGenerationTypeRecord) => void; onDelete: (type: CustomGenerationTypeRecord) => void }) {
  return <div className="type-library">
    <header><div><h2>图片类型</h2><p>内置类型不可修改；你创建的类型会在所有项目的生成工作台中出现。</p></div><Button variant="primary" icon={<Plus size={15} />} onClick={onCreate}>新建自定义类型</Button></header>
    <div className="type-library__section"><h3>内置类型 <span>只读</span></h3><div className="type-card-grid">{builtinTypes.map((type) => <article className="type-card" key={type.id}><div><strong>{type.label}</strong><span>内置</span></div><p>平台标准系列图类型</p><small>{type.ratio} · 默认 {type.count} 张</small></article>)}</div></div>
    <div className="type-library__section"><h3>我的自定义类型 <span>{customTypes.length}</span></h3>{customTypes.length ? <div className="type-card-grid">{customTypes.map((type) => <article className="type-card type-card--custom" key={type.id}><div><strong>{type.name}</strong><span>自定义</span></div><p>{type.purpose}</p><small>{type.ratio} · 候选 {type.candidateCount} 张 · 参考图 {type.referenceAssetIds.length}</small><footer><Button size="sm" icon={<Pencil size={13} />} onClick={() => onEdit(type)}>编辑</Button><Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => onDelete(type)}>删除</Button></footer></article>)}</div> : <Empty icon={<Layers size={36} />} title="还没有自定义图片类型" note="可定义用途、候选数量、比例、提示词要求与参考图。" />}</div>
  </div>;
}

function TypeEditorModal({ value, assets, onClose, onSaved }: { value: CustomGenerationTypeRecord | null; assets: GlobalAssetRecord[]; onClose: () => void; onSaved: () => void }) {
  const notify = useAppStore((state) => state.notify);
  const [name, setName] = useState(value?.name ?? "");
  const [purpose, setPurpose] = useState(value?.purpose ?? "");
  const [candidateCount, setCandidateCount] = useState(value?.candidateCount ?? 1);
  const [ratio, setRatio] = useState<CustomGenerationTypeRecord["ratio"]>(value?.ratio ?? "1:1");
  const [promptRequirements, setPromptRequirements] = useState(value?.promptRequirements ?? "");
  const [referenceAssetIds, setReferenceAssetIds] = useState(value?.referenceAssetIds ?? []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !purpose.trim() || !promptRequirements.trim()) {
      notify("请填写名称、用途和提示词要求");
      return;
    }
    setBusy(true);
    try {
      await saveCustomGenerationType({ id: value?.id ?? createId(), name: name.trim(), purpose: purpose.trim(), candidateCount, ratio, promptRequirements: promptRequirements.trim(), referenceAssetIds });
      notify(value ? "自定义图片类型已更新" : "自定义图片类型已创建");
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存图片类型失败");
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal type-editor-modal" role="dialog" aria-modal="true" aria-label={value ? "编辑自定义图片类型" : "新建自定义图片类型"}>
    <header><h2>{value ? "编辑自定义图片类型" : "新建自定义图片类型"}</h2><button className="modal-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
    <div className="type-editor-grid">
      <label className="modal-field"><span>类型名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="例如：使用场景对比图" /></label>
      <label className="modal-field"><span>用途说明</span><input value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={100} placeholder="帮助 Agent 理解这类图解决什么问题" /></label>
      <label className="modal-field"><span>候选数量</span><select value={candidateCount} onChange={(event) => setCandidateCount(Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
      <label className="modal-field"><span>尺寸比例</span><select value={ratio} onChange={(event) => setRatio(event.target.value as CustomGenerationTypeRecord["ratio"])}>{["1:1", "3:4", "4:3", "9:16"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="modal-field modal-field--wide"><span>提示词要求</span><textarea value={promptRequirements} onChange={(event) => setPromptRequirements(event.target.value)} maxLength={800} placeholder="例如：突出使用前后差异，保持商品结构与颜色一致，不生成画内文字" /></label>
      <fieldset className="reference-picker"><legend>可选参考图（全局素材）</legend>{assets.length ? <div>{assets.map((asset) => <label key={asset.id}><input type="checkbox" checked={referenceAssetIds.includes(asset.id)} onChange={() => setReferenceAssetIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])} /><img src={convertFileSrc(asset.path)} alt="" /><span>{asset.name}</span></label>)}</div> : <p>全局素材库暂无图片，可稍后编辑添加。</p>}</fieldset>
    </div>
    <footer className="modal-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存类型"}</Button></footer>
  </section></div>;
}

function PreviewModal({ asset, onClose }: { asset: GlobalAssetRecord | AssetRecord; onClose: () => void }) {
  const name = "name" in asset ? asset.name : fileName(asset.path);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="asset-preview-modal" role="dialog" aria-modal="true" aria-label={`预览${name}`}><header><div><h2>{name}</h2><p>{assetRoleLabel(asset.role)} · {asset.mime.replace("image/", "").toUpperCase()}</p></div><button aria-label="关闭" onClick={onClose}><X size={18} /></button></header><img src={convertFileSrc(asset.path)} alt={name} /><code>{asset.path}</code></section></div>;
}

function RenameModal({ asset, onClose, onSave }: { asset: GlobalAssetRecord; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(asset.name);
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!name.trim()) return; setBusy(true); try { await onSave(name.trim()); } finally { setBusy(false); } };
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="重命名素材"><header><h2>重命名全局素材</h2><button className="modal-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></header><label className="modal-field"><span>素材名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} /></label><footer className="modal-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>保存</Button></footer></section></div>;
}

function ConfirmDeleteModal({ target, count, busy, onClose, onConfirm }: { target: { kind: "global" | "project" | "type" | "global-batch" }; count: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const text = target.kind === "project" ? "只移除 SQLite 素材记录，项目目录中的图片文件会保留。" : target.kind === "type" ? "该类型会从所有项目的生成工作台中消失；已生成的结果不受影响。" : `将删除 ${count} 个全局素材记录及应用素材库中的本地文件，已复制到项目的副本不受影响。`;
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="确认删除"><header><h2>确认删除</h2><button className="modal-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></header><p className="modal-warning">{text}</p><footer className="modal-actions"><Button onClick={onClose}>取消</Button><Button variant="danger" disabled={busy} onClick={onConfirm}>{busy ? "删除中…" : "确认删除"}</Button></footer></section></div>;
}
