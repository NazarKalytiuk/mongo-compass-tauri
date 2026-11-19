mod database_tools;
// Public so the integration tests in tests/ can drive them against a real server.
pub mod ejson;
pub mod mongo;

use mongo::{AppState, ConnectionInfo, DocumentListResult};
use tauri::State;

#[tauri::command]
async fn connect_db(state: State<'_, AppState>, uri: String) -> Result<ConnectionInfo, String> {
    mongo::connect(&state, uri).await
}

#[tauri::command]
async fn disconnect_db(state: State<'_, AppState>) -> Result<(), String> {
    mongo::disconnect(&state).await
}

#[tauri::command]
async fn list_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    mongo::list_databases(&state).await
}

#[tauri::command]
async fn list_collections(state: State<'_, AppState>, db_name: String) -> Result<Vec<String>, String> {
    mongo::list_collections(&state, db_name).await
}

#[tauri::command]
async fn find_documents(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    filter_str: String,
    sort_str: String,
    projection_str: String,
    limit: i64,
    skip: i64,
) -> Result<DocumentListResult, String> {
    mongo::find_documents(
        &state,
        db_name,
        coll_name,
        filter_str,
        sort_str,
        projection_str,
        limit,
        skip,
    )
    .await
}

#[tauri::command]
async fn insert_document(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    doc_json: String,
) -> Result<String, String> {
    mongo::insert_document(&state, db_name, coll_name, doc_json).await
}

#[tauri::command]
async fn replace_document(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    id_json: String,
    doc_json: String,
) -> Result<(), String> {
    mongo::replace_document(&state, db_name, coll_name, id_json, doc_json).await
}

#[tauri::command]
async fn delete_document(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    id_json: String,
) -> Result<(), String> {
    mongo::delete_document(&state, db_name, coll_name, id_json).await
}

#[tauri::command]
async fn get_collections_stats(
    state: State<'_, AppState>,
    db_name: String,
) -> Result<Vec<mongo::CollectionStats>, String> {
    mongo::get_collections_stats(&state, db_name).await
}

#[tauri::command]
async fn create_collection(
    state: State<'_, AppState>,
    db_name: String,
    name: String,
    capped: Option<bool>,
    size: Option<i64>,
    max: Option<i64>,
) -> Result<(), String> {
    mongo::create_collection(&state, db_name, name, capped, size, max).await
}

#[tauri::command]
async fn drop_collection(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
) -> Result<(), String> {
    mongo::drop_collection(&state, db_name, coll_name).await
}

#[tauri::command]
async fn aggregate_documents(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    pipeline_str: String,
) -> Result<Vec<serde_json::Value>, String> {
    mongo::aggregate_documents(&state, db_name, coll_name, pipeline_str).await
}

#[tauri::command]
async fn explain_aggregation(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    pipeline_str: String,
) -> Result<serde_json::Value, String> {
    mongo::explain_aggregation(&state, db_name, coll_name, pipeline_str).await
}

#[tauri::command]
async fn list_indexes(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
) -> Result<Vec<mongo::IndexInfo>, String> {
    mongo::list_indexes(&state, db_name, coll_name).await
}

#[tauri::command]
async fn create_index(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    keys_json: String,
    name: Option<String>,
    unique: Option<bool>,
    sparse: Option<bool>,
) -> Result<(), String> {
    mongo::create_index(&state, db_name, coll_name, keys_json, name, unique, sparse).await
}

#[tauri::command]
async fn drop_index(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    name: String,
) -> Result<(), String> {
    mongo::drop_index(&state, db_name, coll_name, name).await
}

#[tauri::command]
async fn current_ops(state: State<'_, AppState>) -> Result<Vec<mongo::CurrentOp>, String> {
    mongo::current_ops(&state).await
}

#[tauri::command]
async fn kill_op(state: State<'_, AppState>, opid: i64) -> Result<(), String> {
    mongo::kill_op(&state, opid).await
}

#[tauri::command]
async fn server_status(state: State<'_, AppState>) -> Result<mongo::ServerStatusResult, String> {
    mongo::server_status(&state).await
}

#[tauri::command]
async fn repl_set_status(state: State<'_, AppState>) -> Result<mongo::ReplSetStatusResult, String> {
    mongo::repl_set_status(&state).await
}

#[tauri::command]
async fn ensure_database_tools(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<database_tools::DatabaseToolsInfo, String> {
    database_tools::ensure_database_tools(
        &app_handle,
        &state.database_tools_install,
        &state.database_tools_last_checked,
    )
    .await
}

#[tauri::command]
async fn run_mongodump(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    db: Option<String>,
    collection: Option<String>,
    out_path: String,
    gzip: bool,
    oplog: bool,
    num_parallel_collections: Option<i32>,
    dry_run: Option<bool>,
) -> Result<(), String> {
    mongo::run_mongodump(
        &app_handle,
        &state,
        db,
        collection,
        out_path,
        gzip,
        oplog,
        num_parallel_collections,
        dry_run,
    )
    .await
}

#[tauri::command]
async fn run_mongorestore(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    in_path: String,
    db: Option<String>,
    collection: Option<String>,
    drop: bool,
    no_index_restore: bool,
    maintain_insertion_order: bool,
    stop_on_error: bool,
    dry_run: Option<bool>,
) -> Result<(), String> {
    mongo::run_mongorestore(
        &app_handle,
        &state,
        in_path,
        db,
        collection,
        drop,
        no_index_restore,
        maintain_insertion_order,
        stop_on_error,
        dry_run,
    )
    .await
}

#[tauri::command]
async fn get_collection_validator(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
) -> Result<Option<serde_json::Value>, String> {
    mongo::get_collection_validator(&state, db_name, coll_name).await
}

#[tauri::command]
async fn insert_many(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    docs: Vec<serde_json::Value>,
) -> Result<Vec<String>, String> {
    mongo::insert_many(&state, db_name, coll_name, docs).await
}

#[tauri::command]
async fn diagnose_uri(uri: String) -> Result<mongo::ConnectionDiagnostics, String> {
    mongo::diagnose_uri(uri).await
}

#[tauri::command]
async fn get_collection_size(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
) -> Result<u64, String> {
    mongo::get_collection_size(&state, db_name, coll_name).await
}

#[tauri::command]
async fn start_shell(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    mongo::start_shell(&app_handle, &state).await
}

#[tauri::command]
async fn write_shell_command(
    state: State<'_, AppState>,
    command: String,
) -> Result<(), String> {
    mongo::write_shell_command(&state, command).await
}

#[tauri::command]
async fn set_collection_validator(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    validator_json: String,
    validation_level: Option<String>,
    validation_action: Option<String>,
) -> Result<(), String> {
    mongo::set_collection_validator(
        &state,
        db_name,
        coll_name,
        validator_json,
        validation_level,
        validation_action,
    )
    .await
}

#[tauri::command]
async fn update_many(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    filter_json: String,
    update_json: String,
) -> Result<mongo::BulkWriteResult, String> {
    mongo::update_many(&state, db_name, coll_name, filter_json, update_json).await
}

#[tauri::command]
async fn delete_many(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    filter_json: String,
) -> Result<u64, String> {
    mongo::delete_many(&state, db_name, coll_name, filter_json).await
}

#[tauri::command]
async fn count_documents(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    filter_json: String,
) -> Result<u64, String> {
    mongo::count_documents(&state, db_name, coll_name, filter_json).await
}

#[tauri::command]
async fn explain_find(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
    filter_str: String,
    sort_str: String,
    projection_str: String,
    limit: i64,
    skip: i64,
) -> Result<serde_json::Value, String> {
    mongo::explain_find(
        &state,
        db_name,
        coll_name,
        filter_str,
        sort_str,
        projection_str,
        limit,
        skip,
    )
    .await
}

#[tauri::command]
async fn create_view(
    state: State<'_, AppState>,
    db_name: String,
    view_name: String,
    source: String,
    pipeline_str: String,
) -> Result<(), String> {
    mongo::create_view(&state, db_name, view_name, source, pipeline_str).await
}

#[tauri::command]
async fn create_database(
    state: State<'_, AppState>,
    db_name: String,
    coll_name: String,
) -> Result<(), String> {
    mongo::create_database(&state, db_name, coll_name).await
}

#[tauri::command]
async fn drop_database(state: State<'_, AppState>, db_name: String) -> Result<(), String> {
    mongo::drop_database(&state, db_name).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            connect_db,
            disconnect_db,
            list_databases,
            list_collections,
            find_documents,
            insert_document,
            replace_document,
            delete_document,
            get_collections_stats,
            create_collection,
            drop_collection,
            aggregate_documents,
            explain_aggregation,
            list_indexes,
            create_index,
            drop_index,
            current_ops,
            kill_op,
            server_status,
            repl_set_status,
            ensure_database_tools,
            run_mongodump,
            run_mongorestore,
            get_collection_validator,
            insert_many,
            diagnose_uri,
            get_collection_size,
            start_shell,
            write_shell_command,
            set_collection_validator,
            update_many,
            delete_many,
            count_documents,
            explain_find,
            create_view,
            create_database,
            drop_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
