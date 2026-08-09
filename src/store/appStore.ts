import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiProviders, generationTypes } from "../data/demo";
import { setActiveProjectId } from "../lib/database";
import type { ApiProviderConfig, LocaleCode, ScreenId, TaskItem, ThemeMode } from "../types";

export interface CurrentProjectInfo {
  id: string;
  name: string;
  path: string;
}

interface AppState {
  screen: ScreenId;
  theme: ThemeMode;
  locale: LocaleCode;
  currentProject: CurrentProjectInfo | null;
  generationTypes: typeof generationTypes;
  selectedResults: string[];
  favoriteResults: string[];
  resultFilter: "all" | "white" | "scene" | "poster" | "detail";
  tasks: TaskItem[];
  queuePaused: boolean;
  selectedTaskId: string;
  selectedCanvasPage: string;
  selectedLayerId: string;
  inspectorTab: "properties" | "ai";
  providers: ApiProviderConfig[];
  /** 三家服务商最近一次连接测试返回的余额；未测试/无余额接口时为 null。 */
  providerBalances: Record<ApiProviderConfig["id"], number | null>;
  setProviderBalance: (id: ApiProviderConfig["id"], balance: number | null) => void;
  toast: string | null;
  canvasSource: string | null;
  canvasSourcePath: string | null;
  canvasSourceDimensions: { width: number; height: number } | null;
  setScreen: (screen: ScreenId) => void;
  openProject: (project: CurrentProjectInfo) => void;
  closeProject: () => void;
  pendingCreateProject: boolean;
  openProjectCreator: () => void;
  consumeProjectCreator: () => void;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleCode) => void;
  toggleGenerationType: (id: string) => void;
  setGenerationCount: (id: string, count: number) => void;
  toggleResult: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setResultFilter: (filter: AppState["resultFilter"]) => void;
  setQueuePaused: (paused: boolean) => void;
  selectTask: (id: string) => void;
  retryTask: (id: string) => void;
  addTasks: (tasks: TaskItem[]) => void;
  hydrateLocalState: (tasks: TaskItem[], settings: { theme: ThemeMode; locale: LocaleCode } | null) => void;
  updateTask: (id: string, patch: Partial<TaskItem>) => void;
  setCanvasPage: (id: string) => void;
  setSelectedLayer: (id: string) => void;
  setInspectorTab: (tab: AppState["inspectorTab"]) => void;
  setCanvasSource: (src: string | null) => void;
  openResultInCanvas: (src: string, dimensions?: { width: number; height: number }, localPath?: string) => void;
  updateProvider: (id: ApiProviderConfig["id"], patch: Partial<ApiProviderConfig>) => void;
  notify: (message: string) => void;
  clearToast: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      screen: "generate",
      theme: "dark",
      locale: "zh-CN",
      currentProject: null,
      generationTypes,
      selectedResults: [],
      favoriteResults: [],
      resultFilter: "all",
      tasks: [],
      queuePaused: false,
      selectedTaskId: "",
      selectedCanvasPage: "poster",
      selectedLayerId: "headline",
      inspectorTab: "properties",
      providers: apiProviders,
      providerBalances: { apimart: null, deepseek: null, qwen: null },
      toast: null,
      canvasSource: null,
      canvasSourcePath: null,
      canvasSourceDimensions: null,
      setScreen: (screen) => set({ screen }),
      openProject: (project) => {
        setActiveProjectId(project.id);
        set({ currentProject: project, screen: "generate" });
      },
      closeProject: () => {
        setActiveProjectId("");
        set({ currentProject: null, screen: "projects" });
      },
      pendingCreateProject: false,
      openProjectCreator: () => set({ screen: "projects", pendingCreateProject: true }),
      consumeProjectCreator: () => set({ pendingCreateProject: false }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      toggleGenerationType: (id) => set((state) => ({
        generationTypes: state.generationTypes.map((item) => item.id === id ? { ...item, selected: !item.selected } : item),
      })),
      setGenerationCount: (id, count) => set((state) => ({
        generationTypes: state.generationTypes.map((item) => item.id === id ? { ...item, count: Math.min(4, Math.max(1, count)) } : item),
      })),
      toggleResult: (id) => set((state) => ({
        selectedResults: state.selectedResults.includes(id)
          ? state.selectedResults.filter((resultId) => resultId !== id)
          : [...state.selectedResults, id],
      })),
      toggleFavorite: (id) => set((state) => ({
        favoriteResults: state.favoriteResults.includes(id)
          ? state.favoriteResults.filter((resultId) => resultId !== id)
          : [...state.favoriteResults, id],
      })),
      setResultFilter: (resultFilter) => set({ resultFilter }),
      setQueuePaused: (queuePaused) => set({ queuePaused }),
      selectTask: (selectedTaskId) => set({ selectedTaskId }),
      retryTask: (id) => set((state) => ({
        tasks: state.tasks.map((task) => task.id === id ? { ...task, status: "queued", progress: 0, error: undefined, elapsed: "00:00:00" } : task),
        toast: "任务已重新加入队列",
      })),
      addTasks: (tasks) => set((state) => ({ tasks: [...tasks, ...state.tasks] })),
      hydrateLocalState: (tasks, settings) => set((state) => ({
        tasks,
        theme: settings?.theme ?? state.theme,
        locale: settings?.locale ?? state.locale,
        selectedTaskId: tasks[0]?.id ?? "",
      })),
      updateTask: (id, patch) => set((state) => ({
        tasks: state.tasks.map((task) => task.id === id ? { ...task, ...patch } : task),
      })),
      setCanvasPage: (selectedCanvasPage) => set({ selectedCanvasPage }),
      setSelectedLayer: (selectedLayerId) => set({ selectedLayerId }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setCanvasSource: (canvasSource) => set({ canvasSource, canvasSourcePath: null }),
      openResultInCanvas: (src, dimensions, localPath) => set({ canvasSource: src, canvasSourcePath: localPath ?? null, canvasSourceDimensions: dimensions ?? null, screen: "canvas" }),
      updateProvider: (id, patch) => set((state) => ({
        providers: state.providers.map((provider) => provider.id === id ? { ...provider, ...patch } : provider),
      })),
      setProviderBalance: (id, balance) => set((state) => ({
        providerBalances: { ...state.providerBalances, [id]: balance },
      })),
      notify: (toast) => set({ toast }),
      clearToast: () => set({ toast: null }),
    }),
    {
      name: "listingforge-ui",
      partialize: (state) => ({ theme: state.theme, locale: state.locale, currentProject: state.currentProject }),
    },
  ),
);
