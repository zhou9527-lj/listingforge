import i18n from "i18next";
import { initReactI18next } from "react-i18next";

void i18n.use(initReactI18next).init({
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  resources: {
    "zh-CN": {
      translation: {
        nav: { projects: "项目", materials: "素材", generate: "生成", results: "结果", canvas: "画布", export: "导出", tasks: "任务", settings: "设置" },
        top: { newProject: "新建项目", save: "保存" },
        status: { localSaved: "本地保存", network: "网络状态", normal: "正常", apiBalance: "API 余额" },
      },
    },
    en: {
      translation: {
        nav: { projects: "Projects", materials: "Assets", generate: "Generate", results: "Results", canvas: "Canvas", export: "Export", tasks: "Tasks", settings: "Settings" },
        top: { newProject: "New project", save: "Save" },
        status: { localSaved: "Saved locally", network: "Network", normal: "Online", apiBalance: "API balance" },
      },
    },
  },
});

export default i18n;
