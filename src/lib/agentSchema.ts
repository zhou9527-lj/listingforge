import { supportedPlatforms } from "../data/platformPresets";

/**
 * Agent 操作助手可写动作的合法枚举——单一来源。
 * 应用侧（GenerationWorkbench applyAgentActions）与提示词注入共用，
 * 模型输出非法值会被校验拒绝并明确反馈，不再静默丢弃。
 */

/** 生成平台（中文全称，含空格与斜杠，必须与 platformPresets 完全一致）。 */
export const AGENT_PLATFORMS: readonly string[] = supportedPlatforms;

export const AGENT_CATEGORIES = ["3C 数码", "美妆护肤", "服饰鞋包", "食品饮料", "家居日用", "母婴玩具", "运动户外", "其他"];

export const AGENT_SCREENS = ["projects", "materials", "generate", "results", "canvas", "tasks", "settings", "exports"];

/** 操作助手动作类型白名单（与 OperatorAction.type 对齐）。 */
export const AGENT_ACTION_TYPES = ["set_platform", "set_category", "set_brief", "set_generation_type", "navigate"] as const;
