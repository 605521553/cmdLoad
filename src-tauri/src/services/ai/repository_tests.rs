#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{
        models::{
            ai::{
                AiAnnotationDraft, GeneratedAiAnnotation, ManualAnnotationMode,
                SaveAiAnnotationInput, AI_PROMPT_VERSION,
            },
            command::CommandInput,
        },
        services::{
            ai::{AiError, AiService},
            database::Database,
            library::LibraryService,
        },
    };

    fn setup() -> (tempfile::TempDir, Database) {
        let temp = tempdir().expect("temp dir");
        let database = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("db")
            .database;
        (temp, database)
    }

    fn input(title: &str, command: &str, description: &str) -> CommandInput {
        CommandInput {
            title: title.to_owned(),
            command: command.to_owned(),
            description: description.to_owned(),
            shell: "bash".to_owned(),
            category_id: None,
            tags: Vec::new(),
        }
    }

    fn generated(
        command: &crate::models::command::Command,
        short: &str,
        detailed: &str,
    ) -> GeneratedAiAnnotation {
        GeneratedAiAnnotation {
            command_id: command.id.clone(),
            command_content_hash: command.content_hash.clone(),
            provider: "deepseek".to_owned(),
            model: "deepseek-chat".to_owned(),
            prompt_version: AI_PROMPT_VERSION.to_owned(),
            generated_at: 100,
            annotation: AiAnnotationDraft {
                short_description: short.to_owned(),
                detailed_description: detailed.to_owned(),
                parameters: Vec::new(),
                requirements: vec!["已安装 Docker".to_owned()],
                warnings: Vec::new(),
                suggested_shell: "bash".to_owned(),
                risk_level: "low".to_owned(),
            },
        }
    }

    #[test]
    fn saved_annotation_is_separate_and_marks_command_ready() {
        let (_temp, database) = setup();
        let library = LibraryService::new(&database);
        let command = library
            .create_command(input("docker ps -a", "docker ps -a", ""))
            .expect("command");
        let annotation = AiService::new(&database)
            .save_generated(SaveAiAnnotationInput {
                generated: generated(&command, "查看所有 Docker 容器", "列出全部容器。"),
                manual_mode: ManualAnnotationMode::Keep,
            })
            .expect("save");
        assert_eq!(annotation.short_description, "查看所有 Docker 容器");
        assert!(!annotation.is_stale);

        let loaded = library.get_command(&command.id).expect("loaded");
        assert_eq!(loaded.command, "docker ps -a");
        assert_eq!(loaded.title, "docker ps -a");
        assert_eq!(loaded.ai_annotation_status, "ready");
        let ai = loaded.ai_annotation.expect("annotation");
        assert_eq!(ai.short_description, "查看所有 Docker 容器");
        assert_eq!(ai.parameters.len(), 0);
        assert_eq!(ai.provider, "deepseek");
    }

    #[test]
    fn stale_hash_is_rejected_without_writing() {
        let (_temp, database) = setup();
        let library = LibraryService::new(&database);
        let command = library
            .create_command(input("docker ps -a", "docker ps -a", ""))
            .expect("command");
        let mut payload = generated(&command, "查看所有 Docker 容器", "列出全部容器。");
        payload.command_content_hash = "stale".to_owned();
        let error = AiService::new(&database)
            .save_generated(SaveAiAnnotationInput {
                generated: payload,
                manual_mode: ManualAnnotationMode::Keep,
            })
            .expect_err("stale must fail");
        assert!(matches!(error, AiError::StaleCommand));
        let loaded = library.get_command(&command.id).expect("loaded");
        assert!(loaded.ai_annotation.is_none());
        assert_eq!(loaded.ai_annotation_status, "none");
    }

    #[test]
    fn append_and_replace_require_explicit_modes_and_never_change_command_text() {
        let (_temp, database) = setup();
        let library = LibraryService::new(&database);
        let command = library
            .create_command(input("查看容器", "docker ps -a", "手写详细说明"))
            .expect("command");
        let service = AiService::new(&database);

        let appended = service
            .save_generated(SaveAiAnnotationInput {
                generated: generated(&command, "查看所有 Docker 容器", "列出全部容器。"),
                manual_mode: ManualAnnotationMode::Append,
            })
            .expect("append");
        assert_eq!(appended.short_description, "查看所有 Docker 容器");
        let loaded = library.get_command(&command.id).expect("loaded");
        assert_eq!(loaded.command, "docker ps -a");
        assert!(loaded.title.contains("AI：查看所有 Docker 容器"));
        assert!(loaded.description.contains("手写详细说明"));
        assert!(loaded.description.contains("AI 补充：列出全部容器。"));

        service
            .save_generated(SaveAiAnnotationInput {
                generated: generated(&command, "再次解释容器", "替换后的详细说明。"),
                manual_mode: ManualAnnotationMode::Replace,
            })
            .expect("replace");
        let loaded = library.get_command(&command.id).expect("replaced");
        assert_eq!(loaded.command, "docker ps -a");
        assert_eq!(loaded.title, "再次解释容器");
        assert_eq!(loaded.description, "替换后的详细说明。");
    }

    #[test]
    fn interrupted_pending_status_recovers_as_failed() {
        let (_temp, database) = setup();
        let library = LibraryService::new(&database);
        let command = library
            .create_command(input("docker ps -a", "docker ps -a", ""))
            .expect("command");
        let service = AiService::new(&database);
        service
            .mark_status(&command.id, "pending")
            .expect("pending");
        assert_eq!(
            service.command_state(&command.id).expect("state").status,
            "pending"
        );
        assert_eq!(service.recover_interrupted().expect("recover"), 1);
        assert_eq!(
            service.command_state(&command.id).expect("state").status,
            "failed"
        );
    }
}
