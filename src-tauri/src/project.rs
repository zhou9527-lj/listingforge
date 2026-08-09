use crate::segmentation::sha256_hex;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    pub id: Uuid,
    pub path: String,
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
            .map_err(|error| format!("创建项目目录失败（{}）：{error}", root.display()))?;
    }
    Ok(())
}

async fn write_manifest(root: &Path, name: &str, platform: &str, category: &str) -> Result<ProjectManifest, String> {
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
    let content = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| "序列化项目清单失败".to_string())?;
    fs::write(root.join("project.json"), content)
        .await
        .map_err(|error| format!("写入项目清单失败（{}）：{error}", root.display()))?;
    Ok(manifest)
}

#[tauri::command]
pub async fn create_project(request: CreateProjectRequest) -> Result<CreatedProject, String> {
    let name = safe_segment(&request.name)?;
    let root = PathBuf::from(request.parent_path).join(name);
    validate_project_path(&root)?;
    if fs::try_exists(&root)
        .await
        .map_err(|error| format!("无法检查项目目录（{}）：{error}", root.display()))?
    {
        return Err("同名项目目录已存在".to_string());
    }
    if let Err(error) = ensure_project_structure(&root).await {
        let _ = fs::remove_dir_all(&root).await;
        return Err(error);
    }
    let manifest = match write_manifest(&root, name, &request.platform, &request.category).await {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&root).await;
            return Err(error);
        }
    };
    Ok(CreatedProject {
        id: manifest.id,
        path: root.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_project_with_a_chinese_name() {
        let parent = std::env::temp_dir().join(format!(
            "listingforge-project-test-{}",
            Uuid::new_v4()
        ));
        let request = CreateProjectRequest {
            parent_path: parent.to_string_lossy().to_string(),
            name: "便携榨汁杯".to_string(),
            platform: "未指定".to_string(),
            category: "未指定".to_string(),
        };

        let created = tauri::async_runtime::block_on(create_project(request))
            .expect("project creation should succeed");
        let root = PathBuf::from(created.path);
        assert!(root.join("project.json").is_file());
        for folder in ["assets", "results", "canvas", "exports", "logs"] {
            assert!(root.join(folder).is_dir());
        }

        tauri::async_runtime::block_on(fs::remove_dir_all(&parent))
            .expect("temporary project cleanup should succeed");
    }
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
pub async fn update_project_manifest(project_path: String, name: String) -> Result<String, String> {
    let name = safe_segment(&name)?;
    let root = PathBuf::from(project_path);
    validate_project_path(&root)?;
    let manifest_path = root.join("project.json");
    let bytes = fs::read(&manifest_path)
        .await
        .map_err(|_| "读取项目清单失败".to_string())?;
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "解析项目清单失败".to_string())?;
    manifest["name"] = serde_json::Value::String(name.to_string());
    manifest["updatedAt"] = serde_json::Value::String(Utc::now().to_rfc3339());
    let content =
        serde_json::to_vec_pretty(&manifest).map_err(|_| "序列化项目清单失败".to_string())?;
    fs::write(&manifest_path, content)
        .await
        .map_err(|_| "写入项目清单失败".to_string())?;
    Ok(name.to_string())
}

#[tauri::command]
pub async fn delete_project_directory(project_path: String) -> Result<(), String> {
    let root = PathBuf::from(project_path);
    validate_project_path(&root)?;
    // 只允许删除带有 project.json 清单的项目目录，防止误删用户文件
    if !fs::try_exists(root.join("project.json"))
        .await
        .map_err(|_| "无法检查项目清单".to_string())?
    {
        return Err("目录中不存在 project.json，已拒绝删除".to_string());
    }
    fs::remove_dir_all(&root)
        .await
        .map_err(|_| "删除项目目录失败".to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub path: String,
    pub sha256: String,
    pub mime: String,
}

async fn inspect_image_source(source: &Path) -> Result<(&'static str, String, String), String> {
    if !fs::try_exists(source)
        .await
        .map_err(|_| "无法检查源文件".to_string())?
    {
        return Err("源文件不存在".to_string());
    }
    let extension = source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| "图片缺少文件扩展名".to_string())?;
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err("仅支持 PNG / JPG / WebP 图片".to_string()),
    };
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("asset")
        .to_string();
    Ok((mime, stem, extension))
}

fn safe_role(value: &str) -> Result<&str, String> {
    match value {
        "product" | "logo" | "package" | "detail" | "style" => Ok(value),
        _ => Err("素材角色无效".to_string()),
    }
}

/// 把用户选择的图片复制到项目 assets/<role>/ 目录并计算哈希；素材库与生成工作台共用。
#[tauri::command]
pub async fn import_asset(
    project_path: String,
    source_path: String,
    role: String,
) -> Result<ImportedAsset, String> {
    let root = PathBuf::from(project_path);
    validate_project_path(&root)?;
    let role = safe_role(&role)?;
    let source = PathBuf::from(source_path);
    let (mime, stem, extension) = inspect_image_source(&source).await?;
    let assets_dir = root.join("assets").join(role);
    fs::create_dir_all(&assets_dir)
        .await
        .map_err(|_| "创建素材目录失败".to_string())?;
    let target = assets_dir.join(format!("{}-{stem}.{extension}", Uuid::new_v4()));
    fs::copy(&source, &target)
        .await
        .map_err(|_| "复制素材失败".to_string())?;
    let bytes = fs::read(&target)
        .await
        .map_err(|_| "读取素材失败".to_string())?;
    Ok(ImportedAsset {
        path: target.to_string_lossy().to_string(),
        sha256: sha256_hex(&bytes).await,
        mime: mime.to_string(),
    })
}

/// 把图片复制到应用级素材库。应用级素材不会自动进入任何项目。
#[tauri::command]
pub async fn import_global_asset(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<ImportedAsset, String> {
    let source = PathBuf::from(source_path);
    let (mime, stem, extension) = inspect_image_source(&source).await?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法解析应用数据目录".to_string())?
        .join("global-assets");
    fs::create_dir_all(&root)
        .await
        .map_err(|_| "创建全局素材目录失败".to_string())?;
    let target = root.join(format!("{}-{stem}.{extension}", Uuid::new_v4()));
    fs::copy(&source, &target)
        .await
        .map_err(|_| "复制全局素材失败".to_string())?;
    let bytes = fs::read(&target)
        .await
        .map_err(|_| "读取全局素材失败".to_string())?;
    Ok(ImportedAsset {
        path: target.to_string_lossy().to_string(),
        sha256: sha256_hex(&bytes).await,
        mime: mime.to_string(),
    })
}

/// 只允许删除应用数据目录 global-assets/ 下的单个文件。
#[tauri::command]
pub async fn delete_global_asset_file(
    app: tauri::AppHandle,
    asset_path: String,
) -> Result<(), String> {
    let library = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法解析应用数据目录".to_string())?
        .join("global-assets");
    let target = PathBuf::from(asset_path);
    let canonical_library = fs::canonicalize(&library)
        .await
        .map_err(|_| "全局素材目录不存在".to_string())?;
    let canonical_target = fs::canonicalize(&target)
        .await
        .map_err(|_| "全局素材文件不存在".to_string())?;
    if !canonical_target.starts_with(&canonical_library) || !canonical_target.is_file() {
        return Err("已拒绝删除素材库之外的文件".to_string());
    }
    fs::remove_file(canonical_target)
        .await
        .map_err(|_| "删除全局素材文件失败".to_string())
}

/// 删除项目 results/ 目录内的结果图片；仅允许结果目录内的文件，防止误删项目其他内容。
#[tauri::command]
pub async fn delete_project_result_file(
    project_path: String,
    file_path: String,
) -> Result<(), String> {
    let root = PathBuf::from(project_path);
    validate_project_path(&root)?;
    let results_dir = root.join("results");
    let canonical_results = fs::canonicalize(&results_dir)
        .await
        .map_err(|_| "结果目录不存在".to_string())?;
    let canonical_target = fs::canonicalize(&PathBuf::from(file_path))
        .await
        .map_err(|_| "结果文件不存在".to_string())?;
    if !canonical_target.starts_with(&canonical_results) || !canonical_target.is_file() {
        return Err("已拒绝删除结果目录之外的文件".to_string());
    }
    fs::remove_file(canonical_target)
        .await
        .map_err(|_| "删除结果文件失败".to_string())
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
