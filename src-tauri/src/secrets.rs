use keyring::Entry;
use serde::Serialize;

const SERVICE: &str = "com.listingforge.app";
const PROVIDERS: [&str; 3] = ["apimart", "deepseek", "qwen"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub configured: bool,
    pub masked_key: String,
}

fn provider_name(provider: &str) -> Result<&str, String> {
    let provider = provider.trim().to_ascii_lowercase();
    PROVIDERS
        .into_iter()
        .find(|candidate| *candidate == provider)
        .ok_or_else(|| "不支持的 API 服务商".to_string())
}

fn entry(provider: &str) -> Result<Entry, String> {
    let provider = provider_name(provider)?;
    Entry::new(SERVICE, provider).map_err(|_| "无法访问系统安全凭据库".to_string())
}

fn mask(secret: &str) -> String {
    let suffix = secret
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("••••••••{suffix}")
}

pub fn read(provider: &str) -> Result<String, String> {
    entry(provider)?
        .get_password()
        .map_err(|_| "尚未配置 API Key".to_string())
}

#[tauri::command]
pub fn save_api_secret(provider: String, secret: String) -> Result<String, String> {
    let secret = secret.trim();
    if secret.len() < 8 || secret.len() > 512 {
        return Err("API Key 长度无效".to_string());
    }
    entry(&provider)?
        .set_password(secret)
        .map_err(|_| "保存到系统安全凭据库失败".to_string())?;
    Ok(mask(secret))
}

#[tauri::command]
pub fn delete_api_secret(provider: String) -> Result<(), String> {
    entry(&provider)?
        .delete_credential()
        .map_err(|_| "删除系统凭据失败".to_string())
}

#[tauri::command]
pub fn get_api_secret_status(provider: String) -> Result<SecretStatus, String> {
    match entry(&provider)?.get_password() {
        Ok(secret) => Ok(SecretStatus {
            configured: true,
            masked_key: mask(&secret),
        }),
        Err(keyring::Error::NoEntry) => Ok(SecretStatus {
            configured: false,
            masked_key: String::new(),
        }),
        Err(_) => Err("读取系统安全凭据库失败".to_string()),
    }
}
