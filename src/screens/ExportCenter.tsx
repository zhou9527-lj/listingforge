import { useEffect, useState } from "react";
import { Download, FileJson, FileUp, Image as ImageIcon, Trash2 } from "lucide-react";
import { Button, SectionTitle } from "../components/ui";
import { hasTauriRuntime } from "../lib/desktop";
import {
  addExportRecord,
  deleteExportRecord,
  getProjectPath,
  listExportRecords,
  loadPersistedResults,
  type ExportRecord,
} from "../lib/database";
import { useAppStore } from "../store/appStore";

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
};

export function ExportCenter() {
  const notify = useAppStore((state) => state.notify);
  const setScreen = useAppStore((state) => state.setScreen);
  const currentProject = useAppStore((state) => state.currentProject);
  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [results, setResults] = useState<Array<{ id: string; taskTitle: string; localPath: string }>>([]);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!hasTauriRuntime()) return;
    try {
      setProjectPath(await getProjectPath());
      setRecords(await listExportRecords());
      setResults((await loadPersistedResults()).map((row) => ({ id: row.id, taskTitle: row.task_title, localPath: row.local_path ?? "" })));
    } catch (error) {
      notify(error instanceof Error ? error.message : "读取导出记录失败");
    }
  };

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [path, list, resultRows] = await Promise.all([getProjectPath(), listExportRecords(), loadPersistedResults()]);
        if (cancelled) return;
        setProjectPath(path);
        setRecords(list);
        setResults(resultRows.map((row) => ({ id: row.id, taskTitle: row.task_title, localPath: row.local_path ?? "" })));
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "读取导出记录失败");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, notify]);

  const pickTarget = async (defaultName: string, extension: string): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({
      directory: false,
      defaultPath: `${projectPath ?? ""}/${defaultName}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    return typeof chosen === "string" ? chosen : null;
  };

  const exportCanvas = async () => {
    if (!projectPath) {
      notify("请先打开一个项目");
      return;
    }
    setBusy(true);
    try {
      const { loadCanvasDocumentRecord } = await import("../lib/database");
      const record = await loadCanvasDocumentRecord("main");
      const target = await pickTarget("canvas-main.json", "json");
      if (!target) return;
      const content = record ? record.document_json : "{}";
      const bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(content), null, 2));
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(target, bytes);
      const checksum = await sha256Hex(bytes);
      await addExportRecord("canvas-json", target, checksum);
      notify("画布文档已导出");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出画布失败");
    } finally {
      setBusy(false);
    }
  };

  const exportResult = async (localPath: string) => {
    setBusy(true);
    try {
      const fileName = localPath.split(/[\\/]/).pop() ?? "result.png";
      const extension = fileName.includes(".") ? fileName.split(".").pop() ?? "png" : "png";
      const target = await pickTarget(fileName, extension);
      if (!target) return;
      const { copyFile, readFile } = await import("@tauri-apps/plugin-fs");
      await copyFile(localPath, target);
      const checksum = await sha256Hex(await readFile(localPath));
      await addExportRecord("result-image", target, checksum);
      notify("结果图片已导出");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出图片失败");
    } finally {
      setBusy(false);
    }
  };

  const removeRecord = async (record: ExportRecord) => {
    try {
      await deleteExportRecord(record.id);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除记录失败");
    }
  };

  if (!currentProject) {
    return (
      <div className="screen-layout">
        <section className="workspace">
          <div className="empty-state">
            <FileUp size={40} strokeWidth={1.4} />
            <h3>尚未打开项目</h3>
            <p>导出记录归属于具体项目，请先打开或创建一个项目。</p>
            <Button variant="primary" onClick={() => setScreen("projects")}>前往项目管理器</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-layout screen-layout--exports">
      <section className="workspace exports-workspace">
        <header className="exports-header">
          <div>
            <SectionTitle>项目导出中心</SectionTitle>
            <p>把画布文档或结果图片另存到指定位置，并记录校验信息。</p>
          </div>
          <Button variant="primary" icon={<FileJson size={16} />} disabled={busy || !hasTauriRuntime()} onClick={() => void exportCanvas()}>导出画布文档</Button>
        </header>

        {!hasTauriRuntime() ? (
          <div className="empty-state">
            <Download size={40} strokeWidth={1.4} />
            <h3>导出仅桌面版可用</h3>
            <p>浏览器预览无法访问本地文件系统。</p>
          </div>
        ) : (
          <>
            <section className="export-section">
              <h3 className="export-section__title">已下载的结果图片</h3>
              {results.length === 0 ? (
                <p className="export-section__empty">暂无已下载的结果图片，可在「结果」页下载后导出。</p>
              ) : (
                <div className="export-result-list">
                  {results.map((result) => (
                    <div className="export-result-row" key={result.id}>
                      <ImageIcon size={16} />
                      <span className="export-result-row__name" title={result.localPath}>{result.taskTitle}</span>
                      <Button size="sm" disabled={busy} onClick={() => void exportResult(result.localPath)}>导出…</Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="export-section">
              <h3 className="export-section__title">导出记录</h3>
              {records.length === 0 ? (
                <p className="export-section__empty">暂无导出记录。</p>
              ) : (
                <div className="export-history">
                  {records.map((record) => (
                    <div className="export-history__row" key={record.id}>
                      <span className="export-history__format">{record.format === "canvas-json" ? "画布 JSON" : "结果图片"}</span>
                      <span className="export-history__time">{formatTime(record.createdAt)}</span>
                      <span className="export-history__path" title={record.targetPath}>{record.targetPath}</span>
                      <button className="export-history__remove" aria-label="删除记录" onClick={() => void removeRecord(record)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
