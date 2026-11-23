/// Stable, non-cryptographic content fingerprint for duplicate detection and
/// clipboard history indexing. The original content is always stored verbatim.
pub fn content_hash(content: &str) -> String {
    // FNV-1a 64-bit: stable across processes and Rust versions, unlike
    // DefaultHasher.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// Obvious secrets that must never be cached into local clipboard history
/// without explicit user action. This is intentionally conservative; false
/// positives only require a confirmation before saving.
pub fn is_sensitive_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    let compact = lower.split_whitespace().collect::<String>();
    const PHRASES: &[&str] = &[
        "-----begin private key-----",
        "-----begin rsa private key-----",
        "-----begin openssh private key-----",
        "-----begin ec private key-----",
        "-----begin encrypted private key-----",
        "authorization:bearer",
        "authorization=bearer",
        "aws_secret_access_key=",
        "aws_access_key_id=",
        "accountkey=",
        "client_secret=",
        "refresh_token=",
        "access_token=",
        "api_key=",
        "apikey=",
        "password=",
        "passwd=",
        "pwd=",
        "secret=",
    ];
    if PHRASES.iter().any(|phrase| compact.contains(phrase)) {
        return true;
    }
    if lower.contains("-----begin") && lower.contains("private key-----") {
        return true;
    }
    if lower.contains("bearer ") && lower.len() > 40 {
        return true;
    }

    for token in text.split(|character: char| {
        character.is_whitespace()
            || matches!(character, '"' | '\'' | '=' | ':' | ',' | ';' | '(' | ')')
    }) {
        let token = token.trim();
        if token.len() < 16 {
            continue;
        }
        if token.starts_with("sk-") && token.len() >= 24 {
            return true;
        }
        if token.starts_with("ghp_")
            || token.starts_with("github_pat_")
            || token.starts_with("xoxb-")
            || token.starts_with("xoxp-")
        {
            return true;
        }
        if token.starts_with("AKIA")
            && token.len() >= 20
            && token
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        {
            return true;
        }
    }

    // Common credential-bearing connection strings.
    (lower.contains("mysql://")
        || lower.contains("postgres://")
        || lower.contains("postgresql://")
        || lower.contains("mongodb://")
        || lower.contains("redis://"))
        && lower.contains('@')
        && lower.contains(':')
}

/// Generate a human-readable title without modifying the saved command text.
pub fn suggest_title(content: &str) -> String {
    let mut fallback: Option<&str> = None;
    for raw_line in content.lines() {
        let line = strip_prompt(raw_line.trim());
        if line.is_empty() {
            continue;
        }
        if fallback.is_none() {
            fallback = Some(line);
        }
        if line.starts_with('#') && !line.starts_with("#!") {
            continue;
        }
        return truncate_title(line);
    }
    fallback
        .map(truncate_title)
        .unwrap_or_else(|| "未命名命令".to_owned())
}

fn strip_prompt(line: &str) -> &str {
    if let Some(rest) = line.strip_prefix("PS ") {
        return strip_prompt(rest.trim_start());
    }
    for prefix in ["$ ", "> ", "❯ "] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return rest.trim_start();
        }
    }
    // Windows prompt such as "C:\src> command".
    if let Some((before, after)) = line.split_once("> ") {
        if before.len() <= 160 && (before.contains(":\\") || before.ends_with(']')) {
            return after.trim_start();
        }
    }
    line
}

fn truncate_title(value: &str) -> String {
    let mut chars = value.chars();
    let title = chars.by_ref().take(80).collect::<String>();
    if chars.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

/// Small local heuristic. Ambiguous cross-platform commands intentionally
/// return `unknown` rather than guessing a shell.
pub fn suggest_shell(content: &str) -> &'static str {
    let first = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let lower = first.to_lowercase();
    let whole = content.to_lowercase();

    if lower.starts_with("get-")
        || lower.starts_with("set-")
        || lower.starts_with("new-")
        || lower.starts_with("remove-")
        || lower.starts_with("start-")
        || lower.starts_with("stop-")
        || lower.starts_with("write-")
        || lower.starts_with("select-")
        || lower.starts_with("where-")
        || lower.starts_with("foreach-")
        || lower.contains("-eq ")
        || lower.contains("-like ")
        || lower.contains("$env:")
        || first.starts_with('$')
    {
        return "powershell";
    }

    if lower.starts_with("dir ")
        || lower.starts_with("dir/")
        || lower.starts_with("copy ")
        || lower.starts_with("move ")
        || lower.starts_with("del ")
        || lower.starts_with("erase ")
        || lower.starts_with("set ")
        || lower.starts_with("cmd ")
        || lower.starts_with("cls")
        || lower.starts_with("tasklist")
        || lower.contains("%path%")
        || lower.contains("%username%")
    {
        return "cmd";
    }

    if lower.starts_with("ls ")
        || lower == "ls"
        || lower.starts_with("cd ")
        || lower.starts_with("pwd")
        || lower.starts_with("cat ")
        || lower.starts_with("grep ")
        || lower.starts_with("rg ")
        || lower.starts_with("chmod ")
        || lower.starts_with("chown ")
        || lower.starts_with("sudo ")
        || lower.starts_with("export ")
        || lower.starts_with("rm ")
        || lower.starts_with("mv ")
        || lower.starts_with("cp ")
        || lower.starts_with("./")
        || lower.starts_with("bash ")
        || lower.starts_with("sh ")
        || lower.starts_with("zsh ")
        || whole.contains("$path")
        || whole.contains("$home")
    {
        return "bash";
    }

    "unknown"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_hash_is_deterministic_and_whitespace_sensitive() {
        assert_eq!(content_hash("docker ps"), content_hash("docker ps"));
        assert_ne!(content_hash("docker ps"), content_hash("docker ps "));
        let first = content_hash("x");
        let second = std::thread::spawn(|| content_hash("x"))
            .join()
            .expect("join");
        assert_eq!(first, second);
    }

    #[test]
    fn titles_use_first_meaningful_line_and_keep_content_separate() {
        assert_eq!(suggest_title("docker ps"), "docker ps");
        assert_eq!(
            suggest_title("\n# comment\n\nGet-Process | Select-Object -First 5"),
            "Get-Process | Select-Object -First 5"
        );
        assert_eq!(
            suggest_title("PS C:\\src> docker compose up -d"),
            "docker compose up -d"
        );
        assert_eq!(suggest_title("   "), "未命名命令");
        let long = "a".repeat(200);
        assert!(suggest_title(&long).chars().count() <= 81);
    }

    #[test]
    fn shell_guesses_only_clear_cases() {
        assert_eq!(suggest_shell("Get-Process"), "powershell");
        assert_eq!(suggest_shell("dir /b"), "cmd");
        assert_eq!(suggest_shell("ls -la"), "bash");
        assert_eq!(suggest_shell("docker ps"), "unknown");
        assert_eq!(suggest_shell("git status"), "unknown");
        assert_eq!(suggest_shell("echo %PATH%"), "cmd");
    }

    #[test]
    fn detects_obvious_secrets_without_flagging_plain_commands() {
        assert!(is_sensitive_text(
            "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        ));
        assert!(is_sensitive_text("password=hunter2"));
        assert!(is_sensitive_text("-----BEGIN RSA PRIVATE KEY-----\nAAAA"));
        assert!(is_sensitive_text("api_key=abcd1234"));
        assert!(is_sensitive_text("mysql://root:secret@localhost/database"));
        assert!(!is_sensitive_text("docker ps -a"));
        assert!(!is_sensitive_text("ssh yons@192.168.11.34"));
        assert!(!is_sensitive_text("echo hello world"));
    }
}
