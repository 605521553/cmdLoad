use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;

use crate::models::ai::{AiAnnotationDraft, AiConnectionConfig};

const MAX_BASE_URL_CHARS: usize = 500;
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("AI 服务尚未完整配置：{0}")]
    NotConfigured(String),
    #[error("AI 配置无效：{0}")]
    InvalidConfig(String),
    #[error("AI 请求超时（已等待 {0} 秒）。请检查网络或在设置中增大超时时间。")]
    Timeout(u32),
    #[error("无法连接 AI 服务：{0}")]
    Network(String),
    #[error("AI 服务返回 HTTP {0}。请检查 Base URL、模型名称和账户状态。")]
    Http(u16),
    #[error("API Key 无效或无权限（HTTP {0}）。请重新保存密钥。")]
    Unauthorized(u16),
    #[error("AI 接口不存在（HTTP 404）。请检查 Base URL 是否为 OpenAI 兼容地址。")]
    EndpointNotFound,
    #[error("AI 服务请求过于频繁或额度不足（HTTP {0}）。请稍后重试。")]
    RateLimited(u16),
    #[error("AI 服务拒绝了请求（HTTP {0}）。请检查模型名称或该模型是否兼容 Chat Completions。")]
    BadRequest(u16),
    #[error("AI 服务返回了无法解析的响应。")]
    InvalidResponse,
    #[error("AI 返回的内容不是有效 JSON，或缺少必要字段。可重新生成。")]
    InvalidJson,
    #[error("AI 返回的注释内容为空。请重试或更换模型。")]
    EmptyAnnotation,
    #[error("该命令疑似包含密码、Token 或私钥，已阻止发送到第三方 AI 服务。")]
    SensitiveBlocked,
    #[error("命令内容在生成后已发生变化，请重新生成注释。")]
    StaleCommand,
    #[error("命令不存在或已被删除。")]
    CommandNotFound,
    #[error("AI 请求已取消。")]
    Cancelled,
    #[error("该命令正在生成 AI 注释，请等待完成后再试。")]
    Busy,
    #[error("{0}")]
    InvalidInput(String),
    #[error("AI 注释存储失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("Windows 凭据管理器不可用：{0}")]
    Credential(#[from] super::credentials::CredentialError),
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: Option<String>,
}

pub fn validate_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Base URL 不能为空。".to_owned());
    }
    if trimmed.chars().count() > MAX_BASE_URL_CHARS {
        return Err("Base URL 过长。".to_owned());
    }
    let url = Url::parse(trimmed).map_err(|_| "Base URL 格式无效。".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Base URL 只支持 http 或 https。".to_owned());
    }
    if url.host_str().is_none() {
        return Err("Base URL 缺少主机名。".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Base URL 不应包含用户名或密码。".to_owned());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Base URL 不应包含查询参数或片段。".to_owned());
    }
    Ok(trimmed.trim_end_matches('/').to_owned())
}

pub fn endpoint_for(base_url: &str) -> Result<String, AiError> {
    let normalized = validate_base_url(base_url).map_err(AiError::InvalidConfig)?;
    if normalized.ends_with("/chat/completions") {
        return Ok(normalized);
    }
    Ok(format!("{normalized}/chat/completions"))
}

fn client(timeout_seconds: u32) -> Result<reqwest::Client, AiError> {
    let timeout = Duration::from_secs(timeout_seconds.clamp(5, 120) as u64);
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .user_agent("PataCommands/0.2 (+local desktop)")
        .build()
        .map_err(|error| AiError::Network(error.to_string()))
}

fn map_transport_error(error: reqwest::Error, timeout_seconds: u32) -> AiError {
    if error.is_timeout() {
        AiError::Timeout(timeout_seconds)
    } else {
        AiError::Network(error.to_string())
    }
}

async fn read_limited_text(response: reqwest::Response) -> String {
    let bytes = response
        .bytes()
        .await
        .map(|bytes| {
            bytes
                .iter()
                .take(MAX_RESPONSE_BYTES)
                .copied()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    String::from_utf8_lossy(&bytes).to_string()
}

async fn post_chat(
    config: &AiConnectionConfig,
    request: &Value,
    include_response_format: bool,
) -> Result<ChatResponse, AiError> {
    let endpoint = endpoint_for(&config.base_url)?;
    let timeout_seconds = config.timeout_seconds.clamp(5, 120);
    let http = client(timeout_seconds)?;
    let mut body = request.clone();
    if include_response_format {
        body["response_format"] = json!({ "type": "json_object" });
    } else if let Some(object) = body.as_object_mut() {
        object.remove("response_format");
    }

    let response = http
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| map_transport_error(error, timeout_seconds))?;

    let status = response.status();
    if !status.is_success() {
        let code = status.as_u16();
        let text = read_limited_text(response).await;
        if matches!(code, 400 | 422) && include_response_format {
            let lower = text.to_lowercase();
            if lower.contains("response_format")
                || lower.contains("json_object")
                || (lower.contains("response format") && lower.contains("support"))
            {
                return Box::pin(post_chat(config, request, false)).await;
            }
        }
        return Err(match code {
            401 | 403 => AiError::Unauthorized(code),
            404 => AiError::EndpointNotFound,
            429 => AiError::RateLimited(code),
            400..=499 => AiError::BadRequest(code),
            _ => AiError::Http(code),
        });
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| map_transport_error(error, timeout_seconds))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AiError::InvalidResponse);
    }
    serde_json::from_slice::<ChatResponse>(&bytes).map_err(|_| AiError::InvalidResponse)
}

fn content_of(response: ChatResponse) -> Result<(String, String), AiError> {
    let model = response.model.unwrap_or_default();
    let content = response
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .ok_or(AiError::InvalidResponse)?;
    Ok((content, model))
}

/// Extract a JSON object from common model wrappers such as ```json fences.
/// Returns the original text when no object boundaries are found.
pub fn extract_json_object(content: &str) -> &str {
    let trimmed = content.trim();
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            return &trimmed[start..=end];
        }
    }
    trimmed
}

pub async fn generate_annotation(
    config: &AiConnectionConfig,
    command: &str,
    shell: &str,
    prompt_version: &str,
) -> Result<AiAnnotationDraft, AiError> {
    let (system, user) = super::prompt::annotation_messages(command, shell, prompt_version);
    let mut request = json!({
        "model": config.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "stream": false,
    });
    if let Some(temperature) = config.temperature {
        request["temperature"] = json!(temperature);
    }
    let response = post_chat(config, &request, true).await?;
    let (content, _) = content_of(response)?;
    let json_text = extract_json_object(&content);
    let draft =
        serde_json::from_str::<AiAnnotationDraft>(json_text).map_err(|_| AiError::InvalidJson)?;
    Ok(draft)
}

pub async fn test_connection(config: &AiConnectionConfig) -> Result<(String, u64), AiError> {
    let started = Instant::now();
    let request = json!({
        "model": config.model,
        "messages": [
            { "role": "system", "content": "你是连接测试助手。只回复 OK。" },
            { "role": "user", "content": "请只回复 OK。" },
        ],
        "temperature": 0.0,
        "max_tokens": 8,
        "stream": false,
    });
    let response = post_chat(config, &request, false).await?;
    let (content, model) = content_of(response)?;
    if content.trim().is_empty() {
        return Err(AiError::InvalidResponse);
    }
    Ok((
        if model.is_empty() {
            config.model.clone()
        } else {
            model
        },
        started.elapsed().as_millis() as u64,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_validation_rejects_unsafe_values_and_normalizes_slashes() {
        assert_eq!(
            validate_base_url(" https://api.deepseek.com/v1/ ").expect("valid"),
            "https://api.deepseek.com/v1"
        );
        assert!(validate_base_url("api.deepseek.com").is_err());
        assert!(validate_base_url("file:///etc/passwd").is_err());
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("https://example.com/v1?key=secret").is_err());
        assert_eq!(
            endpoint_for("https://api.deepseek.com/v1").expect("endpoint"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint_for("https://example.com/v1/chat/completions").expect("endpoint"),
            "https://example.com/v1/chat/completions"
        );
    }

    #[test]
    fn json_objects_are_extracted_from_markdown_fences() {
        let raw = "下面是结果：\n```json\n{\"shortDescription\":\"查看容器\"}\n```";
        assert_eq!(
            extract_json_object(raw),
            "{\"shortDescription\":\"查看容器\"}"
        );
        assert_eq!(extract_json_object("not json"), "not json");
    }
}
