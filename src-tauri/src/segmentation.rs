//! 本地 U²-Net ONNX 抠图。
//!
//! 模型：u2netp.onnx（Apache-2.0）。官方来源、SHA-256 与许可证记录见
//! `docs/04-AI与API/本地抠图模型.md`。模型由本模块在首次使用时经 HTTPS
//! 下载到应用数据目录 `models/`，下载后与固定哈希比对，不一致即拒绝使用。

use image::{GrayImage, Luma, Rgba, RgbaImage};
use ndarray::Array3;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tokio::fs;

const MODEL_URL: &str =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx";
const MODEL_SHA256: &str = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";
const MODEL_FILE: &str = "u2netp.onnx";
const INPUT_NAME: &str = "input.1";
const INPUT_SIZE: u32 = 320;
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];
/// 抠图输入上限：单边不超过 8192px 且总面积不超过 2500 万像素，防止内存耗尽。
const MAX_DIMENSION: u32 = 8192;
const MAX_PIXELS: u64 = 25_000_000;

async fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// 确保本地存在哈希校验通过的模型文件，返回其路径。
async fn ensure_model(model_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(model_dir)
        .await
        .map_err(|_| "创建模型目录失败".to_string())?;
    let target = model_dir.join(MODEL_FILE);
    if target.exists() {
        let bytes = fs::read(&target)
            .await
            .map_err(|_| "读取模型文件失败".to_string())?;
        if sha256_hex(&bytes).await.eq_ignore_ascii_case(MODEL_SHA256) {
            return Ok(target);
        }
        // 哈希不符视为损坏文件，删除后重新下载
        fs::remove_file(&target)
            .await
            .map_err(|_| "删除校验失败的模型文件失败".to_string())?;
    }
    let response = reqwest::get(MODEL_URL)
        .await
        .map_err(|_| "模型下载失败，请检查网络".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("模型下载失败（HTTP {status}）"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "模型下载中断".to_string())?;
    if !sha256_hex(&bytes).await.eq_ignore_ascii_case(MODEL_SHA256) {
        return Err("模型文件校验失败（SHA-256 不匹配），已拒绝使用".to_string());
    }
    fs::write(&target, &bytes)
        .await
        .map_err(|_| "写入模型文件失败".to_string())?;
    Ok(target)
}

/// 同步推理：读图 → 320×320 归一化 → 取显著性掩码 → 放大回原尺寸 → 输出透明 PNG。
fn segment_image_sync(model_path: &Path, image_path: &Path, output_path: &Path) -> Result<(u32, u32), String> {
    let source = image::open(image_path).map_err(|_| "无法读取图片".to_string())?;
    let (width, height) = (source.width(), source.height());
    if width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || (u64::from(width) * u64::from(height)) > MAX_PIXELS
    {
        return Err("图片过大，无法抠图（单边不超过 8192px，总面积不超过 2500 万像素）".to_string());
    }

    let small = source.resize(INPUT_SIZE, INPUT_SIZE, image::imageops::FilterType::Triangle);
    let rgb = small.to_rgb8();
    // NCHW + ImageNet 归一化，输入张量 [1, 3, 320, 320] float32
    let mut input = vec![0f32; (INPUT_SIZE * INPUT_SIZE * 3) as usize];
    let plane = (INPUT_SIZE * INPUT_SIZE) as usize;
    for y in 0..INPUT_SIZE {
        for x in 0..INPUT_SIZE {
            let pixel = rgb.get_pixel(x, y);
            let offset = (y * INPUT_SIZE + x) as usize;
            for channel in 0..3 {
                let normalized =
                    (pixel[channel] as f32 / 255.0 - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel];
                input[channel as usize * plane + offset] = normalized;
            }
        }
    }
    let array = Array3::from_shape_vec((3, INPUT_SIZE as usize, INPUT_SIZE as usize), input)
        .map_err(|_| "构造模型输入失败".to_string())?;
    let value = ort::value::Value::from_array(array)
        .map_err(|_| "构造模型输入失败".to_string())?;

    let mut session = ort::session::Session::builder()
        .map_err(|error| format!("初始化抠图引擎失败：{error}"))?
        .commit_from_file(model_path)
        .map_err(|error| format!("加载抠图模型失败：{error}"))?;
    let outputs = session
        .run(ort::inputs![INPUT_NAME => &value])
        .map_err(|error| format!("抠图推理失败：{error}"))?;
    // 取第一个输出作为显著性掩码；模型已内置 Sigmoid，值域 0–1
    let mask = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|error| format!("读取抠图掩码失败：{error}"))?;

    let mut mask_small = GrayImage::new(INPUT_SIZE, INPUT_SIZE);
    for y in 0..INPUT_SIZE {
        for x in 0..INPUT_SIZE {
            let value = mask[[0, 0, y as usize, x as usize]];
            let gray = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
            mask_small.put_pixel(x, y, Luma([gray]));
        }
    }
    let mask_full = image::imageops::resize(
        &mask_small,
        width,
        height,
        image::imageops::FilterType::Triangle,
    );

    // 前景保留原色，背景 alpha=0
    let rgba_source = source.to_rgba8();
    let mut output = RgbaImage::new(width, height);
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let rgba = rgba_source.get_pixel(x, y);
        *pixel = Rgba([rgba[0], rgba[1], rgba[2], mask_full.get_pixel(x, y)[0]]);
    }
    output
        .save(output_path)
        .map_err(|_| "保存抠图结果失败".to_string())?;
    Ok((width, height))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentResult {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub model_sha256: &'static str,
}

/// 对本地图片执行 U²-Net 抠图，透明 PNG 写入当前项目 `cutouts/`。
///
/// `project_path` 为当前项目目录（前端经 `resolve_default_project` 获得）；
/// 模型文件位于项目目录同级的 `models/`（应用数据目录下）。
#[tauri::command]
pub async fn segment_image(
    project_path: String,
    image_path: String,
) -> Result<SegmentResult, String> {
    let project_dir = PathBuf::from(&project_path);
    if project_dir
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("项目路径不得包含上级目录跳转".to_string());
    }
    let image_path = PathBuf::from(&image_path);
    if image_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("图片路径不得包含上级目录跳转".to_string());
    }
    if !image_path.is_file() {
        return Err("图片不存在".to_string());
    }

    let model_dir = project_dir
        .parent()
        .unwrap_or(&project_dir)
        .join("models");
    let model_path = ensure_model(&model_dir).await?;

    // 输出到当前项目 cutouts/
    let cutouts_dir = project_dir.join("cutouts");
    fs::create_dir_all(&cutouts_dir)
        .await
        .map_err(|_| "创建抠图输出目录失败".to_string())?;
    let stem = image_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("cutout");
    let output_path = cutouts_dir.join(format!("{stem}-cutout.png"));

    // 推理是 CPU 密集操作，移出异步执行线程
    let (width, height) = tokio::task::spawn_blocking({
        let model_path = model_path.clone();
        let image_path = image_path.clone();
        let output_path = output_path.clone();
        move || segment_image_sync(&model_path, &image_path, &output_path)
    })
    .await
    .map_err(|_| "抠图线程异常".to_string())??;

    Ok(SegmentResult {
        output_path: output_path.to_string_lossy().to_string(),
        width,
        height,
        model_sha256: MODEL_SHA256,
    })
}
