use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use crate::secrets;

const APIMART_BASE: &str = "https://api.apimart.ai/v1";
const DEEPSEEK_BASE: &str = "https://api.deepseek.com";
const QWEN_BASE: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub latency_ms: u128,
    pub message: String,
    pub balance: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationRequest {
    pub prompt: String,
    pub size: String,
    pub resolution: String,
    #[serde(default)]
    pub image_urls: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTaskSubmission {
    pub task_id: String,
    pub status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub system: String,
    pub user: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionRequest {
    pub image_data_url: String,
    pub instructions: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("ListingForge/0.1")
        .build()
        .map_err(|_| "无法初始化网络客户端".to_string())
}

fn safe_message(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "认证失败，请检查 API Key".to_string(),
        402 => "账户余额不足".to_string(),
        429 => "请求过于频繁，请稍后重试".to_string(),
        500..=599 => "云端服务暂时不可用".to_string(),
        code => format!("云端返回错误（HTTP {code}）"),
    }
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(safe_message(status));
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| "云端响应格式无效".to_string())
}

#[tauri::command]
pub async fn test_api_provider(provider: String) -> Result<ProviderTestResult, String> {
    let key = secrets::read(&provider)?;
    let client = client()?;
    let started = Instant::now();
    let response = match provider.as_str() {
        "apimart" => {
            client
                .get(format!("{APIMART_BASE}/balance"))
                .bearer_auth(&key)
                .send()
                .await
        }
        "deepseek" => {
            client
                .get(format!("{DEEPSEEK_BASE}/models"))
                .bearer_auth(&key)
                .send()
                .await
        }
        "qwen" => {
            client
                .get(format!("{QWEN_BASE}/models"))
                .bearer_auth(&key)
                .send()
                .await
        }
        _ => return Err("不支持的 API 服务商".to_string()),
    }
    .map_err(|_| "无法连接云端服务，请检查网络".to_string())?;

    let status = response.status();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Ok(ProviderTestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis(),
            message: safe_message(status),
            balance: None,
        });
    }
    let balance = body.get("remain_balance").and_then(Value::as_f64);
    Ok(ProviderTestResult {
        ok: true,
        latency_ms: started.elapsed().as_millis(),
        message: "连接成功".to_string(),
        balance,
    })
}

#[tauri::command]
pub async fn submit_image_generation(
    request: ImageGenerationRequest,
) -> Result<ImageTaskSubmission, String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() || prompt.len() > 16_000 {
        return Err("提示词不能为空且不得超过 16000 字节".to_string());
    }
    const SIZES: [&str; 16] = [
        "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2",
        "3:1", "1:3", "21:9", "9:21",
    ];
    if !SIZES.contains(&request.size.as_str())
        || !["1k", "2k", "4k"].contains(&request.resolution.as_str())
    {
        return Err("图片比例或分辨率无效".to_string());
    }
    if request.image_urls.len() > 16
        || request
            .image_urls
            .iter()
            .any(|url| !(url.starts_with("https://") || url.starts_with("data:image/")))
    {
        return Err("参考图必须为 HTTPS URL 或图片 Data URL，且最多 16 张".to_string());
    }

    let key = secrets::read("apimart")?;
    let body = json!({
        "model": "gpt-image-2",
        "prompt": prompt,
        "n": 1,
        "size": request.size,
        "resolution": request.resolution,
        "image_urls": request.image_urls,
    });
    let value = response_json(
        client()?
            .post(format!("{APIMART_BASE}/images/generations"))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|_| "提交生成任务失败，请检查网络".to_string())?,
    )
    .await?;
    let item = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| "生成服务未返回任务信息".to_string())?;
    let task_id = item
        .get("task_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "生成服务未返回任务 ID".to_string())?
        .to_string();
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("submitted")
        .to_string();
    Ok(ImageTaskSubmission { task_id, status })
}

#[tauri::command]
pub async fn get_image_task(task_id: String) -> Result<Value, String> {
    if !valid_task_id(&task_id) {
        return Err("任务 ID 无效".to_string());
    }
    let key = secrets::read("apimart")?;
    response_json(
        client()?
            .get(format!("{APIMART_BASE}/tasks/{task_id}"))
            .bearer_auth(key)
            .send()
            .await
            .map_err(|_| "查询生成任务失败，请检查网络".to_string())?,
    )
    .await
}

fn valid_task_id(task_id: &str) -> bool {
    task_id.len() >= 8
        && task_id.len() <= 128
        && task_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub local_path: String,
    pub file_name: String,
    pub size_bytes: usize,
}

/// 下载 APIMart 任务结果到项目 results/ 目录。
/// 仅接受 https 图片 URL，扩展名从 Content-Type 推断，文件写入前校验目录安全。
#[tauri::command]
pub async fn download_task_result(
    task_id: String,
    url: String,
    project_path: String,
) -> Result<DownloadResult, String> {
    if !valid_task_id(&task_id) {
        return Err("任务 ID 无效".to_string());
    }
    if !url.starts_with("https://") {
        return Err("结果地址不是安全的 HTTPS 链接".to_string());
    }

    let root = PathBuf::from(&project_path);
    if root
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("项目路径不得包含上级目录跳转".to_string());
    }
    let results_dir = root.join("results");
    tokio::fs::create_dir_all(&results_dir)
        .await
        .map_err(|_| "创建结果目录失败".to_string())?;

    let key = secrets::read("apimart")?;
    let response = client()?
        .get(&url)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| "下载生成结果失败，请检查网络".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(safe_message(status));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let extension = match content_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => {
            // 没有可信的图片 Content-Type 时不落盘，避免把非图片内容写入项目。
            return Err("云端返回的不是受支持的图片格式".to_string());
        }
    };
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "读取生成结果失败".to_string())?;
    if bytes.is_empty() {
        return Err("生成结果为空".to_string());
    }

    let file_name = format!("{task_id}.{extension}");
    let target = results_dir.join(&file_name);
    tokio::fs::write(&target, &bytes)
        .await
        .map_err(|_| "写入生成结果失败".to_string())?;

    Ok(DownloadResult {
        local_path: target.to_string_lossy().to_string(),
        file_name,
        size_bytes: bytes.len(),
    })
}

#[tauri::command]
pub async fn run_deepseek_agent(request: AgentRequest) -> Result<Value, String> {
    if request.user.trim().is_empty() || request.user.len() > 32_000 {
        return Err("Agent 输入无效".to_string());
    }
    let key = secrets::read("deepseek")?;
    let body = json!({
        "model": "deepseek-v4-flash",
        "stream": false,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": request.system },
            { "role": "user", "content": request.user }
        ]
    });
    response_json(
        client()?
            .post(format!("{DEEPSEEK_BASE}/chat/completions"))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|_| "DeepSeek 请求失败，请检查网络".to_string())?,
    )
    .await
}

#[tauri::command]
pub async fn analyze_product(request: VisionRequest) -> Result<Value, String> {
    if !request.image_data_url.starts_with("data:image/")
        || request.image_data_url.len() > 24 * 1024 * 1024
    {
        return Err("商品图必须为不超过 24MB 的图片 Data URL".to_string());
    }
    let key = secrets::read("qwen")?;
    let body = json!({
        "model": "qwen3.6-flash",
        "stream": false,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image_url", "image_url": { "url": request.image_data_url } },
                { "type": "text", "text": request.instructions }
            ]
        }]
    });
    response_json(
        client()?
            .post(format!("{QWEN_BASE}/chat/completions"))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|_| "通义千问请求失败，请检查网络".to_string())?,
    )
    .await
}
