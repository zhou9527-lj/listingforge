import { useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, ImagePlus, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { AgentPanel } from "../components/AgentPanel";
import { Button, CheckBox, SectionTitle } from "../components/ui";
import { getPlatformDimensions, supportedPlatforms, type SupportedPlatform } from "../data/platformPresets";
import { estimateUnitPrice, formatYuan } from "../lib/billing";
import { hasTauriRuntime } from "../lib/desktop";
import { saveGeneratedTasks } from "../lib/database";
import { fileToDataUrl, runGenerationPipeline } from "../lib/generationPipeline";
import { validateImageFiles } from "../lib/imageFiles";
import { useAppStore } from "../store/appStore";

const categories = ["3C 数码", "美妆护肤", "服饰鞋包", "食品饮料", "家居日用", "母婴玩具", "运动户外", "其他"];
type ReferenceRole = "logo" | "package" | "detail" | "style";
type ReferenceFiles = Record<ReferenceRole, File[]>;

export function GenerationWorkbench() {
  const types = useAppStore((state) => state.generationTypes);
  const toggleType = useAppStore((state) => state.toggleGenerationType);
  const setCount = useAppStore((state) => state.setGenerationCount);
  const setScreen = useAppStore((state) => state.setScreen);
  const notify = useAppStore((state) => state.notify);
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
  const mainPreview = useMemo(() => mainFile ? URL.createObjectURL(mainFile) : null, [mainFile]);

  useEffect(() => () => {
    if (mainPreview) URL.revokeObjectURL(mainPreview);
  }, [mainPreview]);

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
      return;
    }
    try {
      await validateImageFiles([files[0]], referenceBytes);
      setMainFile(files[0]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片校验失败");
    }
  };

  const acceptReferenceFiles = async (role: ReferenceRole, files: File[]) => {
    const current = referenceFiles[role];
    if (files.length < current.length) {
      setReferenceFiles((state) => ({ ...state, [role]: files }));
      return;
    }
    const otherBytes = (mainFile?.size ?? 0) + referenceBytes - current.reduce((sum, file) => sum + file.size, 0);
    const otherCount = Object.values(referenceFiles).flat().length - current.length;
    try {
      await validateImageFiles(files, otherBytes, otherCount);
      setReferenceFiles((state) => ({ ...state, [role]: files }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片校验失败");
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
      fileInput.current?.click();
      return;
    }
    setSubmitting(true);
    try {
      const imageDataUrl = await fileToDataUrl(mainFile);
      const referenceImageDataUrls = await Promise.all(Object.values(referenceFiles).flat().map(fileToDataUrl));
      const tasks = await runGenerationPipeline({ imageDataUrl, referenceImageDataUrls, platform, category, customBrief, types, targetDimensions, concurrency, resolution });
      await saveGeneratedTasks(tasks, platform, category);
      addTasks(tasks);
      setConfirmOpen(false);
      notify(`已提交 ${tasks.length} 个生成任务`);
      setScreen("tasks");
    } catch (error) {
      notify(error instanceof Error ? error.message : "生成任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <div className="screen-layout screen-layout--workbench">
      <aside className="context-sidebar material-sidebar">
        <SectionTitle>素材</SectionTitle>
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void acceptMainFiles(Array.from(event.target.files ?? []))} />
        <button className="drop-zone" onClick={() => fileInput.current?.click()}><Plus size={18} /> 添加主产品图</button>
        <AssetSection title="主产品图" files={mainFile ? [mainFile] : []} max={1} size="large" inputRef={fileInput} onFiles={acceptMainFiles} />
        <AssetSection title="Logo" files={referenceFiles.logo} max={1} onFiles={(files) => acceptReferenceFiles("logo", files)} />
        <AssetSection title="包装" files={referenceFiles.package} max={4} onFiles={(files) => acceptReferenceFiles("package", files)} />
        <AssetSection title="细节图" files={referenceFiles.detail} max={8} onFiles={(files) => acceptReferenceFiles("detail", files)} />
        <AssetSection title="风格参考" files={referenceFiles.style} max={4} onFiles={(files) => acceptReferenceFiles("style", files)} />
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
                  <CheckBox checked={item.selected} label={`选择${item.label}`} onChange={() => toggleType(item.id)} />
                  {item.preview ? <img src={item.preview} alt="" /> : <span className="plan-row__placeholder"><ImagePlus size={16} strokeWidth={1.5} /></span>}
                  <strong>{item.label} <small>{item.ratio}</small></strong>
                  <span>{item.ratio}<small>{targetDimensions[item.id]}</small></span>
                  <div className="count-control">
                    <button aria-label="减少数量" onClick={() => setCount(item.id, item.count - 1)}><Minus size={13} /></button>
                    <b>{item.count}</b><em>张</em>
                    <button aria-label="增加数量" onClick={() => setCount(item.id, item.count + 1)}><Plus size={13} /></button>
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
          <Button variant="primary" size="lg" disabled={totalImages === 0} onClick={() => setConfirmOpen(true)}>确认并生成</Button>
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
    </>
  );
}

function AssetSection({ title, files, max, size, inputRef, onFiles }: { title: string; files: File[]; max: number; size?: "large"; inputRef?: React.RefObject<HTMLInputElement | null>; onFiles: (files: File[]) => void | Promise<void> }) {
  const localInput = useRef<HTMLInputElement | null>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const openPicker = () => (inputRef?.current ?? localInput.current)?.click();
  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    void onFiles([...files, ...Array.from(selected)].slice(0, max));
  };

  return (
    <section className="asset-section">
      <header><strong>{title} <small>{files.length}/{max}</small></strong><Ellipsis size={16} /></header>
      {!inputRef ? <input ref={localInput} className="visually-hidden" type="file" multiple={max > 1} accept="image/png,image/jpeg,image/webp" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} /> : null}
      <div className={`asset-grid ${size === "large" ? "asset-grid--large" : ""}`}>
        {previews.map(({ file, url }, index) => <button key={`${file.name}-${file.lastModified}-${index}`} className="asset-thumb" title={`移除 ${file.name}`} onClick={() => void onFiles(files.filter((_, fileIndex) => fileIndex !== index))}><img src={url} alt={file.name} /><X size={13} /></button>)}
        {files.length < max ? <button className="asset-placeholder" aria-label={`添加${title}`} onClick={openPicker}><ImagePlus size={25} /></button> : null}
      </div>
    </section>
  );
}
