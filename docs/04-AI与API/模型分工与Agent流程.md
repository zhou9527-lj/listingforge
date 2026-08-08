---
title: 模型分工与 Agent 流程
status: 已确定
tags: [商品图匠, Agent, AI]
---

# 模型分工与 Agent 流程

## 固定分工

- 通义千问 `qwen3.6-flash`：读取产品图片，输出商品档案、可见文字、材质、结构和风险提示。
- DeepSeek `deepseek-v4-flash`：把档案、平台预设和用户意图转换为生成计划、提示词、工具调用与质量修复建议。
- APIMart `gpt-image-2`：执行生成、参考图生成和局部图片修改。

## Agent 状态机

```mermaid
stateDiagram-v2
  [*] --> Collecting
  Collecting --> Understanding
  Understanding --> ProfileReview
  ProfileReview --> Planning
  Planning --> CostApproval
  CostApproval --> Queued
  Queued --> Generating
  Generating --> Reviewing
  Reviewing --> Editing
  Editing --> Exported
  Generating --> Failed
  Failed --> Queued: retry
```

## 工具边界

Agent 可以读取项目档案、平台预设和选中素材，创建/修改生成计划，提交经用户确认的任务，轮询状态并提出修复建议。Agent 不得自行提高预算、删除原素材、导出覆盖文件或把密钥加入提示词。

## 结构化输出

所有跨模型数据用版本化 JSON Schema 校验。无法解析时最多进行一次修复调用；仍失败则保留原响应摘要并要求用户重试。

