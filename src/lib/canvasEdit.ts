/** 局部 AI 编辑提交前置校验；返回错误信息，通过时返回 null。 */
export const validateEditSubmit = (options: { desktop: boolean; prompt: string; hasMask: boolean }): string | null => {
  if (!options.desktop) return "局部编辑仅在桌面版可用";
  if (!options.prompt.trim()) return "请输入编辑指令";
  if (!options.hasMask) return "请先绘制蒙版区域";
  return null;
};
