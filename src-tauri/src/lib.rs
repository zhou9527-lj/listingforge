mod api;
mod project;
mod secrets;
mod segmentation;

use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_listingforge_core_tables",
            kind: MigrationKind::Up,
            sql: r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                platform TEXT NOT NULL,
                category TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                role TEXT NOT NULL,
                path TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                mime TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS product_profiles (
                project_id TEXT PRIMARY KEY,
                profile_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS generation_plans (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                plan_json TEXT NOT NULL,
                estimated_cost REAL NOT NULL DEFAULT 0,
                confirmed_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                provider_task_id TEXT,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                estimated_cost REAL NOT NULL DEFAULT 0,
                actual_cost REAL,
                error_code TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS results (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                remote_url TEXT,
                local_path TEXT,
                expires_at TEXT,
                quality_score REAL,
                selected INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS canvas_documents (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                document_json TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                UNIQUE(project_id, page_id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS exports (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                format TEXT NOT NULL,
                target_path TEXT NOT NULL,
                checksum TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
            CREATE INDEX IF NOT EXISTS idx_results_task ON results(task_id);
        "#,
        },
        Migration {
            version: 2,
            description: "extend_tasks_for_desktop_ui",
            kind: MigrationKind::Up,
            sql: r#"
            ALTER TABLE tasks ADD COLUMN title TEXT NOT NULL DEFAULT '';
            ALTER TABLE tasks ADD COLUMN dimensions TEXT;
            ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT '';
            ALTER TABLE tasks ADD COLUMN cost_label TEXT NOT NULL DEFAULT '待结算';
            ALTER TABLE tasks ADD COLUMN elapsed TEXT NOT NULL DEFAULT '00:00:00';
            ALTER TABLE tasks ADD COLUMN result_url TEXT;
        "#,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:listingforge.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secrets::save_api_secret,
            secrets::delete_api_secret,
            secrets::get_api_secret_status,
            api::test_api_provider,
            api::submit_image_generation,
            api::get_image_task,
            api::download_task_result,
            api::run_deepseek_agent,
            api::analyze_product,
            project::create_project,
            project::resolve_default_project,
            project::save_canvas_document,
            segmentation::segment_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ListingForge");
}
