---
title: APIMart GPT-Image-2
status: 待实现验证
tags: [商品图匠, APIMart, 图像生成]
---

# APIMart GPT-Image-2

参考文档：[GPT-Image-2 图像生成](https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation)。

## 调用流程

1. `POST https://api.apimart.ai/v1/images/generations`。
2. 使用 `Authorization: Bearer <key>`，模型为 `gpt-image-2`。
3. 记录异步 `task_id`，写入本地任务表。
4. `GET /v1/tasks/{task_id}` 轮询，采用退避与随机抖动。
5. 完成后立即下载结果 URL 到项目目录，并记录 `expires_at`。

## 参数约束

- 支持 1K、2K、4K 和文档列出的比例。
- 参考图片 URL 或 Base64；单张与总量限制必须在上传前校验。
- 供应商返回的费用和过期时间优先于本地估算。
- 用户取消仅停止本地轮询；是否可取消云端任务以供应商能力为准。

## 错误策略

- 401/403：停止重试并提示检查密钥。
- 429：遵守 `Retry-After`，进入限流状态。
- 5xx/网络超时：指数退避，默认最多 3 次。
- 内容或参数错误：不自动重试，显示脱敏诊断信息。

