import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, Library, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { AgentPanel } from "../components/AgentPanel";
import { Button, CheckBox, SectionTitle } from "../components/ui";
import { getPlatformDimensions, supportedPlatforms, type SupportedPlatform } from "../data/platformPresets";
import { estimateUnitPrice, formatYuan } from "../lib/billing";
import { desktopErrorMessage, hasTauriRuntime, importAsset } from "../lib/desktop";
import { addAssetRecord, deleteProjectAssetsNotIn, getProjectPath, listCustomGenerationTypes, listGlobalAssets, listProjectAssets, loadSettingJson, saveGeneratedTasks, type GlobalAssetRecord } from "../lib/database";
import { fileToDataUrl, runGenerationPipeline } from "../lib/generationPipeline";
import { validateImageFiles } from "../lib/imageFiles";
import { useAppStore } from "../store/appStore";
import type { GenerationType } from "../types";

const categories = ["3C 数码", "美妆护肤", "服饰鞋包", "食品饮料", "家居日用", "母婴玩具", "运动户外", "其他"];
type ReferenceRole = "logo" | "package" | "detail" | "style";
type ReferenceFiles = Record<ReferenceRole, File[]>;
/** assets 表中主图的角色名（与素材库/selectGlobalAsset 保持一致） */
const MAIN_ASSET_ROLE = "product";
const REFERENCE_ROLES: ReferenceRole[] = ["logo", "package", "detail", "style"];
const pathBasename = (value: string) => value.split(/[\\/]/).pop() ?? value;

export function GenerationWorkbench() {
  const builtinTypes = useAppStore((state) => state.generationTypes);
  const toggleType = useAppStore((state) => state.toggleGenerationType);
  const setCount = useAppStore((state) => state.setGenerationCount);
  const setScreen = useAppStore((state) => state.setScreen);
  const notify = useAppStore((state) => state.notify);
  const currentProject = useAppStore((state) => state.currentProject);
  const tasks = useAppStore((state) => state.tasks);
  const addTasks = useAppStore((state) => state.addTasks);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFiles>({ logo: [], package: [], detail: [], style: [] });
  const [platform, setPlatform] = useState<SupportedPlatform>(supportedPlatforms[0]);
  const [category, setCategory] = useState(categories[0]);
  const [customBrief, setCustomBrief] = useState("");
  const [concurrency, setConcurrency] = useState(2);
  const [resolution, setResolution] = useState<"1k" | "2k" | "4k">("1k");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customTypes, setCustomTypes] = useState<GenerationType[]>([]);
  const [globalAssets, setGlobalAssets] = useState<GlobalAssetRecord[]>([]);
  const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
  /** 已落库到项目 assets 的素材：role → (文件显示名 → 项目内路径)，用于移除时同步清理记录 */
  const persistedAssetPaths = useRef<Map<string, Map<string, string>>>(new Map());
  const recordPersistedAsset = (role: string, name: string, path: string) => {
    let byName = persistedAssetPaths.current.get(role);
    if (!byName) {
      byName = new Map();
      persistedAssetPaths.current.set(role, byName);
    }
    byName.set(name, path);
  };
  /** 当前生效的素材变更后，删除该角色下已不在保留集合中的 assets 记录（Tauri 模式） */
  const syncPersistedAssets = async (role: string, files: File[]) => {
    if (!hasTauriRuntime()) return;
    const byName = persistedAssetPaths.current.get(role);
    if (!byName) return;
    const keep = files.map((file) => byName.get(file.name)).filter((path): path is string => Boolean(path));
    await deleteProjectAssetsNotIn(role, keep);
  };

  /** 用项目内已落库的图片路径重建浏览器 File（读文件由 fs 插件完成，已在 capabilities 中放开读取范围） */
  const localFileFromPath = async (path: string, name: string, mime: string) => {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return new File([await readFile(path)], name, { type: mime });
  };

  /** 原生文件对话框选择图片：Tauri 模式下拿到真实路径 → 复制进项目并落库，浏览器模式回退到隐藏 input */
  const pickViaDialog = async (role: ReferenceRole | typeof MAIN_ASSET_ROLE, max: number) => {
    if (!hasTauriRuntime()) return;
    if (!currentProject) {
      notify("请先打开一个项目");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: max > 1,
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      const chosen: string[] = selected === null ? [] : Array.isArray(selected) ? selected : [selected];
      const paths = chosen.slice(0, max);
      if (!paths.length) return;
      setSubmitting(true);
      const projectPath = await getProjectPath();
      if (!projectPath) throw new Error("当前项目目录不可用");
      const files = await Promise.all(paths.map(async (sourcePath) => {
        const imported = await importAsset(projectPath, sourcePath, role);
        await addAssetRecord(role, imported.path, imported.sha256, imported.mime);
        const name = pathBasename(imported.path);
        recordPersistedAsset(role, name, imported.path);
        return localFileFromPath(imported.path, name, imported.mime);
      }));
      if (role === MAIN_ASSET_ROLE) await acceptMainFiles(files);
      else await acceptReferenceFiles(role, [...referenceFiles[role], ...files]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入图片失败");
    } finally {
      setSubmitting(false);
    }
  };
  const mainPreview = useMemo(() => mainFile ? URL.createObjectURL(mainFile) : null, [mainFile]);
  const types = useMemo(() => [...builtinTypes, ...customTypes], [builtinTypes, customTypes]);

  useEffect(() => () => {
    if (mainPreview) URL.revokeObjectURL(mainPreview);
  }, [mainPreview]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [savedTypes, assets, defaults, projectAssets] = await Promise.all([
          listCustomGenerationTypes(),
          listGlobalAssets(),
          loadSettingJson<{ resolution: "1k" | "2k" | "4k"; concurrency: number }>("generation_defaults"),
          listProjectAssets(),
        ]);
        if (cancelled) return;
        setCustomTypes(savedTypes.map((type) => ({
          id: type.id,
          label: type.name,
          ratio: type.ratio,
          selected: false,
          count: type.candidateCount,
          purpose: type.purpose,
          promptRequirements: type.promptRequirements,
          referenceAssetIds: type.referenceAssetIds,
          custom: true,
        })));
        setGlobalAssets(assets);
        if (defaults) {
          setResolution(defaults.resolution);
          setConcurrency(Math.min(4, Math.max(1, defaults.concurrency)));
        }
        // 恢复上次会话已落库的主图/参考图：assets 表存的是项目内路径，读回文件后回填状态
        for (const asset of projectAssets) recordPersistedAsset(asset.role, pathBasename(asset.path), asset.path);
        const main = projectAssets.find((asset) => asset.role === MAIN_ASSET_ROLE);
        if (main) setMainFile(await localFileFromPath(main.path, pathBasename(main.path), main.mime));
        for (const role of REFERENCE_ROLES) {
          const roleAssets = projectAssets.filter((asset) => asset.role === role);
          if (!roleAssets.length) continue;
          const restored = await Promise.all(roleAssets.map((asset) => localFileFromPath(asset.path, pathBasename(asset.path), asset.mime)));
          setReferenceFiles((state) => ({ ...state, [role]: restored }));
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : "读取生成配置失败");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [currentProject?.id, notify]);

  useEffect(() => {
    const applyAgentActions = (event: Event) => {
      const detail = (event as CustomEvent<{ actions?: Array<{ type?: string; value?: unknown; typeId?: string; selected?: boolean; count?: number }> }>).detail;
      for (const action of detail.actions ?? []) {
        if (action.type === "set_platform" && supportedPlatforms.includes(action.value as SupportedPlatform)) setPlatform(action.value as SupportedPlatform);
        if (action.type === "set_category" && categories.includes(String(action.value))) setCategory(String(action.value));
        if (action.type === "set_brief" && typeof action.value === "string") setCustomBrief(action.value.slice(0, 2000));
        if (action.type === "set_generation_type" && action.typeId) {
          if (builtinTypes.some((item) => item.id === action.typeId)) {
            const current = useAppStore.getState().generationTypes.find((item) => item.id === action.typeId);
            if (current && typeof action.selected === "boolean" && current.selected !== action.selected) toggleType(action.typeId);
            if (typeof action.count === "number") setCount(action.typeId, action.count);
          } else {
            setCustomTypes((current) => current.map((item) => item.id === action.typeId ? {
              ...item,
              selected: typeof action.selected === "boolean" ? action.selected : item.selected,
              count: typeof action.count === "number" ? Math.min(4, Math.max(1, action.count)) : item.count,
            } : item));
          }
        }
      }
    };
    window.addEventListener("listingforge:agent-actions", applyAgentActions);
    return () => window.removeEventListener("listingforge:agent-actions", applyAgentActions);
  }, [builtinTypes, setCount, toggleType]);

  const selectedCount = types.filter((item) => item.selected).reduce((sum, item) => sum + item.count, 0);
  const totalImages = selectedCount;
  /** 按已完成任务的实际扣费回推单张单价；尚无数据时为 null。 */
  const unitPrice = estimateUnitPrice(tasks);
  const estimatedTotal = unitPrice === null ? null : unitPrice * totalImages;
  const targetDimensions = Object.fromEntries(types.map((type) => [type.id, getPlatformDimensions(platform, type.ratio)]));
  const selectedDimensions = [...new Set(types.filter((type) => type.selected).map((type) => targetDimensions[type.id]))].join(" / ");
  const referenceBytes = Object.values(referenceFiles).flat().reduce((sum, file) => sum + file.size, 0);

  const acceptMainFiles = async (files: File[]) => {
    if (!files.length) {
      setMainFile(null);
      void syncPersistedAssets(MAIN_ASSET_ROLE, []);
      return;
    }
    try {
      await validateImageFiles([files[0]], referenceBytes);
      setMainFile(files[0]);
      void syncPersistedAssets(MAIN_ASSET_ROLE, [files[0]]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片校验失败");
    }
  };

  const acceptReferenceFiles = async (role: ReferenceRole, files: File[]) => {
    const current = referenceFiles[role];
    if (files.length < current.length) {
      setReferenceFiles((state) => ({ ...state, [role]: files }));
      void syncPersistedAssets(role, files);
      return;
    }
    const otherBytes = (mainFile?.size ?? 0) + referenceBytes - current.reduce((sum, file) => sum + file.size, 0);
    const otherCount = Object.values(referenceFiles).flat().length - current.length;
    try {
      await validateImageFiles(files, otherBytes, otherCount);
      setReferenceFiles((state) => ({ ...state, [role]: files }));
      void syncPersistedAssets(role, files);
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片校验失败");
    }
  };

  const selectGlobalAsset = async (asset: GlobalAssetRecord) => {
    if (!currentProject) {
      notify("请先打开一个项目");
      return;
    }
    setSubmitting(true);
    try {
      const projectPath = await getProjectPath();
      if (!projectPath) throw new Error("当前项目目录不可用");
      const role = (["product", "logo", "package", "detail", "style"].includes(asset.role) ? asset.role : "style") as "product" | ReferenceRole;
      const imported = await importAsset(projectPath, asset.path, role);
      await addAssetRecord(role, imported.path, imported.sha256, imported.mime);
      recordPersistedAsset(role, asset.name, imported.path);
      const file = await localFileFromPath(imported.path, asset.name, imported.mime);
      if (role === "product") await acceptMainFiles([file]);
      else await acceptReferenceFiles(role, [...referenceFiles[role], file]);
      setGlobalPickerOpen(false);
      notify(`已复制并使用全局素材「${asset.name}」`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "使用全局素材失败");
    } finally {
      setSubmitting(false);
    }
  };

  const startGeneration = async () => {
    if (!hasTauriRuntime()) {
      notify("请在 ListingForge 桌面应用中提交云端生成任务");
      return;
    }
    if (!mainFile) {
      notify("请先上传一张真实的主产品图");
      setConfirmOpen(false);
      if (hasTauriRuntime()) void pickViaDialog(MAIN_ASSET_ROLE, 1);
      else fileInput.current?.click();
      return;
    }
    if (!currentProject) {
      notify("请先创建或打开项目，再提交付费生成任务");
      setConfirmOpen(false);
      return;
    }
    setSubmitting(true);
    try {
      const imageDataUrl = await fileToDataUrl(mainFile);
      const selectedReferenceIds = [...new Set(types.filter((type) => type.selected).flatMap((type) => type.referenceAssetIds ?? []))];
      const projectPath = await getProjectPath();
      const automaticReferenceFiles: File[] = [];
      for (const asset of globalAssets.filter((item) => selectedReferenceIds.includes(item.id))) {
        if (!projectPath) throw new Error("当前项目目录不可用");
        const imported = await importAsset(projectPath, asset.path, asset.role);
        await addAssetRecord(asset.role, imported.path, imported.sha256, imported.mime);
        automaticReferenceFiles.push(await localFileFromPath(imported.path, asset.name, imported.mime));
      }
      const referenceImageDataUrls = await Promise.all([...Object.values(referenceFiles).flat(), ...automaticReferenceFiles].map(fileToDataUrl));
      const tasks = await runGenerationPipeline({ imageDataUrl, referenceImageDataUrls, platform, category, customBrief, types, targetDimensions, concurrency, resolution });
      // 云端已受理即先入任务中心，本地落库失败不再阻断展示（否则任务会"提交了却不显示"）
      addTasks(tasks);
      setConfirmOpen(false);
      setScreen("tasks");
      try {
        await saveGeneratedTasks(tasks, platform, category);
        notify(`已提交 ${tasks.length} 个生成任务`);
      } catch (error) {
        notify(`已提交 ${tasks.length} 个生成任务，但本地记录保存失败：${desktopErrorMessage(error, "数据库写入失败")}`);
      }
    } catch (error) {
      notify(desktopErrorMessage(error, "生成任务提交失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <div className="screen-layout screen-layout--workbench">
      <aside className="context-sidebar material-sidebar">
        <div className="material-sidebar__title"><SectionTitle>本次素材</SectionTitle><button onClick={() => setGlobalPickerOpen(true)}><Library size={14} /> 从素材库选择</button></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void acceptMainFiles(Array.from(event.target.files ?? []))} />
        <button className="drop-zone" onClick={() => { if (hasTauriRuntime()) void pickViaDialog(MAIN_ASSET_ROLE, 1); else fileInput.current?.click(); }}><Plus size={18} /> 添加主产品图</button>
        <AssetSection title="主产品图" files={mainFile ? [mainFile] : []} max={1} size="large" inputRef={fileInput} onFiles={acceptMainFiles} onDialogPick={hasTauriRuntime() ? () => void pickViaDialog(MAIN_ASSET_ROLE, 1) : undefined} />
        <AssetSection title="Logo" files={referenceFiles.logo} max={1} onFiles={(files) => acceptReferenceFiles("logo", files)} onDialogPick={hasTauriRuntime() ? () => void pickViaDialog("logo", 1) : undefined} />
        <AssetSection title="包装" files={referenceFiles.package} max={4} onFiles={(files) => acceptReferenceFiles("package", files)} onDialogPick={hasTauriRuntime() ? () => void pickViaDialog("package", 4) : undefined} />
        <AssetSection title="细节图" files={referenceFiles.detail} max={8} onFiles={(files) => acceptReferenceFiles("detail", files)} onDialogPick={hasTauriRuntime() ? () => void pickViaDialog("detail", 8) : undefined} />
        <AssetSection title="风格参考" files={referenceFiles.style} max={4} onFiles={(files) => acceptReferenceFiles("style", files)} onDialogPick={hasTauriRuntime() ? () => void pickViaDialog("style", 4) : undefined} />
      </aside>

      <section className="workspace generation-workspace">
        <header className="workspace__header"><SectionTitle>生成方案</SectionTitle></header>
        <div className="generation-body">
          <div className="product-profile">
            <label>原图（主产品图）</label>
            {mainPreview ? <div className="product-preview"><img src={mainPreview} alt="主产品图预览" /></div> : <div className="product-preview product-preview--empty"><ImagePlus size={30} strokeWidth={1.4} /></div>}
            <div className="file-meta"><strong>{mainFile?.name ?? "尚未上传主产品图"}</strong><span>{mainFile ? `${(mainFile.size / 1024 / 1024).toFixed(2)} MB` : "上传后提交生成，演示素材不会进入云端任务"}</span></div>
            <div className="profile-summary">
              <h3>商品信息 <span>AI 提取</span></h3>
              {mainFile ? (
                <dl>
                  <dt>品类</dt><dd>{category}</dd>
                  <dt>说明</dt><dd>生成前由 Agent 自动分析主图提取卖点；可稍后在任务详情中查看。</dd>
                </dl>
              ) : (
                <p className="profile-summary__empty">上传主产品图后，Agent 会自动分析并提取商品信息。</p>
              )}
            </div>
          </div>

          <div className="generation-plan">
            <div className="plan-selectors">
              <label>平台 <select value={platform} onChange={(event) => setPlatform(event.target.value as SupportedPlatform)}>{supportedPlatforms.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>类目 <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <label className="custom-brief">自定义要求<textarea value={customBrief} onChange={(event) => setCustomBrief(event.target.value)} placeholder="例如：生成适合夏季上新的清爽系列图，保持商品颜色与 Logo 完全一致" /></label>
            <div className="plan-table">
              <div className="plan-table__caption">图像类型与数量</div>
              <div className="plan-table__head"><span>类型</span><span>比例</span><span>数量（每类型）</span></div>
              {types.map((item) => (
                <div className={`plan-row ${item.selected ? "is-selected" : ""}`} key={item.id}>
                  <CheckBox checked={item.selected} label={`选择${item.label}`} onChange={() => item.custom ? setCustomTypes((current) => current.map((type) => type.id === item.id ? { ...type, selected: !type.selected } : type)) : toggleType(item.id)} />
                  {item.preview ? <img src={item.preview} alt="" /> : <span className="plan-row__placeholder"><ImagePlus size={16} strokeWidth={1.5} /></span>}
                  <strong>{item.label} <small>{item.ratio}</small></strong>
                  <span>{item.ratio}<small>{targetDimensions[item.id]}</small></span>
                  <div className="count-control">
                    <button aria-label="减少数量" onClick={() => item.custom ? setCustomTypes((current) => current.map((type) => type.id === item.id ? { ...type, count: Math.max(1, type.count - 1) } : type)) : setCount(item.id, item.count - 1)}><Minus size={13} /></button>
                    <b>{item.count}</b><em>张</em>
                    <button aria-label="增加数量" onClick={() => item.custom ? setCustomTypes((current) => current.map((type) => type.id === item.id ? { ...type, count: Math.min(4, type.count + 1) } : type)) : setCount(item.id, item.count + 1)}><Plus size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="plan-limits">
              <label>清晰度 <select value={resolution} onChange={(event) => setResolution(event.target.value as "1k" | "2k" | "4k")}><option value="1k">1K</option><option value="2k">2K</option><option value="4k">4K</option></select></label>
              <label>并发任务数 <span><button aria-label="减少并发" onClick={() => setConcurrency((value) => Math.max(1, value - 1))}><Minus size={13} /></button><b>{concurrency}</b><button aria-label="增加并发" onClick={() => setConcurrency((value) => Math.min(4, value + 1))}><Plus size={13} /></button></span></label>
            </div>
          </div>
        </div>
        <footer className="generation-footer">
          <div><strong>预计 <b>{totalImages}</b> 张{estimatedTotal === null ? <> · 费用按实际扣费回推</> : <> · 约 <b>{formatYuan(estimatedTotal, 2)}</b></>}</strong><span>单张单价按已完成任务的实际扣费均值回推；尚无数据时先出图，结算后展示。</span></div>
          <Button variant="primary" size="lg" disabled={totalImages === 0 || !currentProject} onClick={() => setConfirmOpen(true)}>{currentProject ? "确认并生成" : "请先打开项目"}</Button>
        </footer>
      </section>

      <AgentPanel />
    </div>
    {confirmOpen ? (
      <div className="modal-backdrop" role="presentation">
        <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="generation-confirm-title">
          <header><div><small>付费操作确认</small><h2 id="generation-confirm-title">提交商品系列图生成</h2></div><button aria-label="关闭" onClick={() => setConfirmOpen(false)}><X size={18} /></button></header>
          <dl><div><dt>平台 / 类目</dt><dd>{platform} · {category}</dd></div><div><dt>图片任务</dt><dd>{totalImages} 张 · {resolution.toUpperCase()}<small>{selectedDimensions}</small></dd></div><div><dt>并发上限</dt><dd>{concurrency}</dd></div><div><dt>预估费用</dt><dd className="cost-value">{estimatedTotal === null ? "生成后按实际扣费显示" : formatYuan(estimatedTotal, 2)}</dd></div><div><dt>计费明细</dt><dd>{totalImages} 张图像生成（APIMart）{estimatedTotal === null ? "按实际扣费" : `约 ${formatYuan(estimatedTotal, 2)}`}<small>通义千问商品理解、DeepSeek Agent 规划按各自接口实际扣费记录</small></dd></div></dl>
          <p>将依次调用通义千问商品理解、DeepSeek Agent 规划与 APIMart GPT-Image-2。实际费用以供应商结算为准。</p>
          <footer><Button onClick={() => setConfirmOpen(false)}>返回调整</Button><Button variant="primary" disabled={submitting} onClick={() => void startGeneration()} icon={submitting ? <LoaderCircle className="spin" size={16} /> : undefined}>{submitting ? "正在提交…" : "确认付费并提交"}</Button></footer>
        </section>
      </div>
    ) : null}
    {globalPickerOpen ? (
      <div className="modal-backdrop" role="presentation">
        <section className="confirm-modal global-picker-modal" role="dialog" aria-modal="true" aria-labelledby="global-picker-title">
          <header><div><small>跨项目素材库</small><h2 id="global-picker-title">选择全局素材</h2></div><button aria-label="关闭" onClick={() => setGlobalPickerOpen(false)}><X size={18} /></button></header>
          {globalAssets.length ? <div className="global-picker-grid">{globalAssets.map((asset) => <button key={asset.id} disabled={submitting} onClick={() => void selectGlobalAsset(asset)}><img src={convertFileSrc(asset.path)} alt="" /><span><strong>{asset.name}</strong><small>{assetRoleLabelSafe(asset.role)}</small></span></button>)}</div> : <div className="empty-state"><Library size={36} /><h3>全局素材库是空的</h3><p>请先到「素材」页导入图片。</p></div>}
          <p>选择后会先复制到当前项目目录，再作为本次素材使用。</p>
        </section>
      </div>
    ) : null}
    </>
  );
}

const assetRoleLabelSafe = (role: string) => ({ product: "主图", logo: "Logo", package: "包装", detail: "细节图", style: "风格参考" }[role] ?? role);

function AssetSection({ title, files, max, size, inputRef, onFiles, onDialogPick }: { title: string; files: File[]; max: number; size?: "large"; inputRef?: React.RefObject<HTMLInputElement | null>; onFiles: (files: File[]) => void | Promise<void>; onDialogPick?: () => void }) {
  const localInput = useRef<HTMLInputElement | null>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const openPicker = () => { if (onDialogPick) onDialogPick(); else (inputRef?.current ?? localInput.current)?.click(); };
  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    void onFiles([...files, ...Array.from(selected)].slice(0, max));
  };

  return (
    <section className="asset-section">
      <header><strong>{title} <small>{files.length}/{max}</small></strong></header>
      {!inputRef ? <input ref={localInput} className="visually-hidden" type="file" multiple={max > 1} accept="image/png,image/jpeg,image/webp" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} /> : null}
      <div className={`asset-grid ${size === "large" ? "asset-grid--large" : ""}`}>
        {previews.map(({ file, url }, index) => <button key={`${file.name}-${file.lastModified}-${index}`} className="asset-thumb" title={`移除 ${file.name}`} onClick={() => void onFiles(files.filter((_, fileIndex) => fileIndex !== index))}><img src={url} alt={file.name} /><X size={13} /></button>)}
        {files.length < max ? <button className="asset-placeholder" aria-label={`添加${title}`} onClick={openPicker}><ImagePlus size={25} /></button> : null}
      </div>
    </section>
  );
}
