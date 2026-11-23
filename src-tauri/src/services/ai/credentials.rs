use std::ptr;

use thiserror::Error;

pub const CREDENTIAL_TARGET: &str = "PataCommands/AI/OpenAICompatible";
const MAX_API_KEY_BYTES: usize = 2048;

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("Windows 凭据管理器操作失败（错误码 {0}）。API Key 未写入设置或日志。")]
    Windows(u32),
    #[error("API Key 为空或格式无效。")]
    InvalidKey,
    #[cfg(not(target_os = "windows"))]
    #[error("当前平台不支持 Windows 凭据管理器。")]
    Unsupported,
}

pub fn has_api_key() -> Result<bool, CredentialError> {
    read_api_key().map(|key| key.is_some())
}

pub fn save_api_key(api_key: &str) -> Result<(), CredentialError> {
    write_api_key_to(CREDENTIAL_TARGET, api_key)
}

pub fn delete_api_key() -> Result<(), CredentialError> {
    delete_api_key_at(CREDENTIAL_TARGET)
}

pub fn read_api_key() -> Result<Option<String>, CredentialError> {
    read_api_key_from(CREDENTIAL_TARGET)
}

fn validate_key(api_key: &str) -> Result<&str, CredentialError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_API_KEY_BYTES
        || trimmed.chars().any(|ch| ch.is_control())
    {
        return Err(CredentialError::InvalidKey);
    }
    Ok(trimmed)
}

pub fn is_valid_api_key(api_key: &str) -> bool {
    validate_key(api_key).is_ok()
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn write_api_key_to(target: &str, api_key: &str) -> Result<(), CredentialError> {
    use windows_sys::Win32::{
        Foundation::GetLastError,
        Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    let key = validate_key(api_key)?;
    let mut target = wide(target);
    let mut username = wide("pata-commands");
    let mut comment = wide("Pata Commands AI API key");
    let mut blob = key.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: comment.as_mut_ptr(),
        LastWritten: Default::default(),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: username.as_mut_ptr(),
    };
    let written = unsafe { CredWriteW(&credential, 0) };
    // Best effort: clear the transient key buffer before it is released.
    blob.fill(0);
    if written == 0 {
        return Err(CredentialError::Windows(unsafe { GetLastError() }));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_api_key_to(_target: &str, _api_key: &str) -> Result<(), CredentialError> {
    Err(CredentialError::Unsupported)
}

#[cfg(target_os = "windows")]
fn read_api_key_from(target: &str) -> Result<Option<String>, CredentialError> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
    };

    let mut target = wide(target);
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    let read = unsafe { CredReadW(target.as_mut_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if read == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_NOT_FOUND {
            return Ok(None);
        }
        return Err(CredentialError::Windows(error));
    }
    if credential.is_null() {
        return Err(CredentialError::Windows(0));
    }

    let key = unsafe {
        let entry = &*credential;
        let bytes = if entry.CredentialBlob.is_null() || entry.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize)
                .to_vec()
        };
        CredFree(credential as *const std::ffi::c_void);
        bytes
    };
    if key.is_empty() {
        return Ok(None);
    }
    String::from_utf8(key)
        .map(Some)
        .map_err(|_| CredentialError::InvalidKey)
}

#[cfg(not(target_os = "windows"))]
fn read_api_key_from(_target: &str) -> Result<Option<String>, CredentialError> {
    Err(CredentialError::Unsupported)
}

#[cfg(target_os = "windows")]
fn delete_api_key_at(target: &str) -> Result<(), CredentialError> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
    };

    let mut target = wide(target);
    let deleted = unsafe { CredDeleteW(target.as_mut_ptr(), CRED_TYPE_GENERIC, 0) };
    if deleted == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_NOT_FOUND {
            return Ok(());
        }
        return Err(CredentialError::Windows(error));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn delete_api_key_at(_target: &str) -> Result<(), CredentialError> {
    Err(CredentialError::Unsupported)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn api_key_round_trips_through_windows_credential_manager() {
        let target = format!("PataCommands/Tests/{}", uuid::Uuid::new_v4());
        assert!(read_api_key_from(&target).expect("read none").is_none());
        write_api_key_to(&target, "sk-test-not-a-real-key-123456").expect("write");
        assert_eq!(
            read_api_key_from(&target).expect("read").as_deref(),
            Some("sk-test-not-a-real-key-123456")
        );
        delete_api_key_at(&target).expect("delete");
        assert!(read_api_key_from(&target).expect("read deleted").is_none());
        // Deleting a missing credential is idempotent.
        delete_api_key_at(&target).expect("delete missing");
    }
}
