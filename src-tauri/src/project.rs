use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub parent_path: String,
    pub name: String,
    pub platform: String,
    pub category: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub id: Uuid,
    pub name: String,
    pub platform: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

fn safe_segment(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 80
        || value.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
    {
        return Err("项目名称包含无效字符".to_string());
    }
    Ok(value)
}

fn safe_page_id(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("画布页面 ID 无效".to_string());
    }
    Ok(value)
}

fn validate_project_path(path: &Path) -> Result<(), String> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("项目路径不得包含上级目录跳转".to_string());
    }
    Ok(())
}

async fn ensure_project_structure(root: &Path) -> Result<(), String> {
    for folder in ["assets", "results", "canvas", "exports", "logs"] {
        fs::create_dir_all(root.join(folder))
            .await
            .map_err(|_| "创建项目目录失败".to_string())?;
    }
    Ok(())
}

async fn write_manifest(root: &Path, name: &str, platform: &str, category: &str) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let manifest = ProjectManifest {
        schema_version: 1,
        id: Uuid::new_v4(),
        name: name.to_string(),
        platform: platform.to_string(),
        category: category.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    let content =
        serde_json::to_vec_pretty(&manifest).map_err(|_| "序列化项目清单失败".to_string())?;
    fs::write(root.join("project.json"), content)
        .await
        .map_err(|_| "写入项目清单失败".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn create_project(request: CreateProjectRequest) -> Result<String, String> {
    let name = safe_segment(&request.name)?;
    let root = PathBuf::from(request.parent_path).join(name);
    validate_project_path(&root)?;
    if fs::try_exists(&root)
        .await
        .map_err(|_| "无法检查项目目录".to_string())?
    {
        return Err("同名项目目录已存在".to_string());
    }
    ensure_project_structure(&root).await?;
    write_manifest(&root, name, &request.platform, &request.category).await?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn resolve_default_project(parent_path: String) -> Result<String, String> {
    let root = PathBuf::from(parent_path).join("listingforge-default");
    validate_project_path(&root)?;
    ensure_project_structure(&root).await?;
    if !fs::try_exists(root.join("project.json"))
        .await
        .map_err(|_| "无法检查项目清单".to_string())?
    {
        write_manifest(&root, "当前项目", "未指定", "未指定").await?;
    }
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_canvas_document(
    project_path: String,
    page_id: String,
    document: serde_json::Value,
) -> Result<String, String> {
    let root = PathBuf::from(project_path);
    validate_project_path(&root)?;
    let page_id = safe_page_id(&page_id)?;
    let canvas_dir = root.join("canvas");
    fs::create_dir_all(&canvas_dir)
        .await
        .map_err(|_| "创建画布目录失败".to_string())?;
    let target = canvas_dir.join(format!("{page_id}.json"));
    let content = serde_json::to_vec_pretty(&document).map_err(|_| "序列化画布失败".to_string())?;
    fs::write(&target, content)
        .await
        .map_err(|_| "保存画布失败".to_string())?;
    Ok(target.to_string_lossy().to_string())
}
