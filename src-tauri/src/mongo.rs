use mongodb::{
    bson::{self, doc, Document},
    options::{ClientOptions, FindOptions},
    Client,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Emitter;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// Global application state to store the active MongoDB Client and connection URI
pub struct AppState {
    pub client: Arc<Mutex<Option<Client>>>,
    pub uri: Arc<Mutex<Option<String>>>,
    pub shell_stdin: Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            uri: Arc::new(Mutex::new(None)),
            shell_stdin: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Return a cloned `Client` from shared state, or an error if not connected.
/// `Client` is `Arc`-backed so cloning is cheap.
async fn get_client(state: &AppState) -> Result<Client, String> {
    let guard = state.client.lock().await;
    guard
        .as_ref()
        .ok_or_else(|| "Not connected to MongoDB".to_string())
        .cloned()
}

/// Return the active connection URI from shared state.
async fn get_uri(state: &AppState) -> Result<String, String> {
    let guard = state.uri.lock().await;
    guard
        .as_ref()
        .ok_or_else(|| "Not connected to MongoDB".to_string())
        .cloned()
}

/// Parse a JSON pipeline string into a `Vec<Document>` ready for aggregation.
fn parse_pipeline(pipeline_str: &str) -> Result<Vec<Document>, String> {
    let pipeline_json: serde_json::Value = serde_json::from_str(pipeline_str)
        .map_err(|e| format!("Invalid pipeline JSON syntax: {}", e))?;
    let pipeline_array = pipeline_json
        .as_array()
        .ok_or("Pipeline must be a JSON array of stages")?;
    pipeline_array
        .iter()
        .enumerate()
        .map(|(idx, stage_val)| {
            let stage_bson = bson::to_bson(stage_val)
                .map_err(|e| format!("BSON conversion error at stage {}: {}", idx, e))?;
            #[allow(clippy::clone_on_copy)]
            stage_bson
                .as_document()
                .map(|d| d.clone())
                .ok_or_else(|| format!("Stage {} must be a JSON object", idx))
        })
        .collect()
}

/// Spawn an external process, stream stdout/stderr as Tauri events, and wait
/// for completion.  `event_name` is the Tauri event emitted for each line.
async fn stream_subprocess(
    app_handle: &tauri::AppHandle,
    event_name: &str,
    exec_path: PathBuf,
    args: Vec<String>,
) -> Result<(), String> {
    let mut cmd = Command::new(&exec_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", exec_path.display(), e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut stdout_done = false;
    let mut stderr_done = false;

    loop {
        tokio::select! {
            line = stdout_reader.next_line(), if !stdout_done => {
                match line {
                    Ok(Some(line)) => { let _ = app_handle.emit(event_name, LogPayload { text: line }); }
                    _ => { stdout_done = true; }
                }
            }
            line = stderr_reader.next_line(), if !stderr_done => {
                match line {
                    Ok(Some(line)) => { let _ = app_handle.emit(event_name, LogPayload { text: line }); }
                    _ => { stderr_done = true; }
                }
            }
            status = child.wait() => {
                let status = status.map_err(|e| format!("Execution failed: {}", e))?;
                while let Ok(Some(line)) = stdout_reader.next_line().await {
                    let _ = app_handle.emit(event_name, LogPayload { text: line });
                }
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    let _ = app_handle.emit(event_name, LogPayload { text: line });
                }
                if !status.success() {
                    return Err(format!("Process exited with error status: {}", status));
                }
                break;
            }
        }
    }
    Ok(())
}

// ── Public API ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionInfo {
    pub version: String,
    pub databases: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DocumentListResult {
    pub documents: Vec<serde_json::Value>,
    pub total_count: u64,
}

// Helper: Parse a JSON query string into a BSON Document
fn json_to_document(json_str: &str) -> Result<Document, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Document::new());
    }
    let json_val: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid JSON syntax: {}", e))?;
    
    let bson_val = bson::to_bson(&json_val)
        .map_err(|e| format!("BSON conversion error: {}", e))?;
        
    match bson_val {
        bson::Bson::Document(doc) => Ok(doc),
        _ => Err("Expected a JSON object structure".to_string()),
    }
}

// Connect to MongoDB and return server build version & database names
pub async fn connect(state: &AppState, uri: String) -> Result<ConnectionInfo, String> {
    let mut client_options = ClientOptions::parse(&uri)
        .await
        .map_err(|e| format!("Failed to parse URI: {}", e))?;
        
    // Set a reasonable timeout so it doesn't hang indefinitely (e.g. 5 seconds)
    client_options.connect_timeout = Some(std::time::Duration::from_secs(5));
    client_options.server_selection_timeout = Some(std::time::Duration::from_secs(5));

    let client = Client::with_options(client_options)
        .map_err(|e| format!("Failed to create client: {}", e))?;

    // Verify connectivity by running buildInfo on the admin database
    let admin_db = client.database("admin");
    let build_info = admin_db
        .run_command(doc! { "buildInfo": 1 })
        .await
        .map_err(|e| format!("Connection test failed. Verify network/auth: {}", e))?;
        
    let version = build_info
        .get_str("version")
        .unwrap_or("unknown")
        .to_string();

    // Store the connected client and URI in global state
    let mut guard = state.client.lock().await;
    *guard = Some(client.clone());
    let mut uri_guard = state.uri.lock().await;
    *uri_guard = Some(uri.clone());

    // Fetch initial list of databases
    let databases = client
        .list_database_names()
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;

    Ok(ConnectionInfo { version, databases })
}

// Disconnect the active client
pub async fn disconnect(state: &AppState) -> Result<(), String> {
    let mut guard = state.client.lock().await;
    *guard = None;
    let mut uri_guard = state.uri.lock().await;
    *uri_guard = None;
    let mut stdin_guard = state.shell_stdin.lock().await;
    *stdin_guard = None;
    Ok(())
}

// List all database names
pub async fn list_databases(state: &AppState) -> Result<Vec<String>, String> {
    let client = get_client(&state).await?;
    
    client
        .list_database_names()
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))
}

// List collections in a specific database
pub async fn list_collections(state: &AppState, db_name: String) -> Result<Vec<String>, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    db.list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))
}

// Query documents from a database collection
pub async fn find_documents(
    state: &AppState,
    db_name: String,
    coll_name: String,
    filter_str: String,
    sort_str: String,
    projection_str: String,
    limit: i64,
    skip: i64,
) -> Result<DocumentListResult, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);

    let filter_doc = json_to_document(&filter_str)?;
    let sort_doc = json_to_document(&sort_str)?;
    let proj_doc = json_to_document(&projection_str)?;

    // Configure options
    let mut find_options = FindOptions::default();
    if limit > 0 {
        find_options.limit = Some(limit);
    }
    if skip > 0 {
        find_options.skip = Some(skip as u64);
    }
    if !sort_doc.is_empty() {
        find_options.sort = Some(sort_doc);
    }
    if !proj_doc.is_empty() {
        find_options.projection = Some(proj_doc);
    }

    // Run query
    let mut cursor = collection
        .find(filter_doc.clone())
        .with_options(find_options)
        .await
        .map_err(|e| format!("Query execution failed: {}", e))?;

    let mut documents = Vec::new();
    while cursor.advance().await.map_err(|e| format!("Cursor error: {}", e))? {
        let doc = cursor.deserialize_current().map_err(|e| format!("Deserialization error: {}", e))?;
        let json_val = serde_json::to_value(&doc)
            .map_err(|e| format!("BSON to JSON conversion error: {}", e))?;
        documents.push(json_val);
    }

    // Get count
    let count = if filter_doc.is_empty() {
        collection
            .estimated_document_count()
            .await
            .map_err(|e| format!("Failed to get document count: {}", e))?
    } else {
        collection
            .count_documents(filter_doc)
            .await
            .map_err(|e| format!("Failed to get document count: {}", e))?
    };

    Ok(DocumentListResult {
        documents,
        total_count: count,
    })
}

// Insert document into database collection
pub async fn insert_document(
    state: &AppState,
    db_name: String,
    coll_name: String,
    doc_json: String,
) -> Result<String, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let doc = json_to_document(&doc_json)?;
    
    let result = collection
        .insert_one(doc)
        .await
        .map_err(|e| format!("Insertion failed: {}", e))?;
        
    Ok(format!("{:?}", result.inserted_id))
}

// Update document by BSON ID
pub async fn update_document(
    state: &AppState,
    db_name: String,
    coll_name: String,
    id_json: String,
    update_json: String,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let id_val: serde_json::Value = serde_json::from_str(&id_json)
        .map_err(|e| format!("Invalid ID JSON: {}", e))?;
    let id_bson = bson::to_bson(&id_val)
        .map_err(|e| format!("ID BSON conversion error: {}", e))?;
        
    let update_doc = json_to_document(&update_json)?;
    
    collection
        .update_one(doc! { "_id": id_bson }, update_doc)
        .await
        .map_err(|e| format!("Update failed: {}", e))?;
        
    Ok(())
}

// Delete document by BSON ID
pub async fn delete_document(
    state: &AppState,
    db_name: String,
    coll_name: String,
    id_json: String,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let id_val: serde_json::Value = serde_json::from_str(&id_json)
        .map_err(|e| format!("Invalid ID JSON: {}", e))?;
    let id_bson = bson::to_bson(&id_val)
        .map_err(|e| format!("ID BSON conversion error: {}", e))?;
        
    collection
        .delete_one(doc! { "_id": id_bson })
        .await
        .map_err(|e| format!("Deletion failed: {}", e))?;
        
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CollectionStats {
    pub name: String,
    pub document_count: u64,
    pub storage_size: u64,
    pub index_count: u64,
    pub is_capped: bool,
    pub is_view: bool,
}

// Fetch stats for all collections in a database
pub async fn get_collections_stats(
    state: &AppState,
    db_name: String,
) -> Result<Vec<CollectionStats>, String> {
    let client = get_client(&state).await?;

    let db = client.database(&db_name);

    // Map each collection name to whether it is a view (collStats does not apply to views)
    let mut view_map = std::collections::HashMap::new();
    if let Ok(mut specs) = db.list_collections().await {
        while let Ok(true) = specs.advance().await {
            if let Ok(spec) = specs.deserialize_current() {
                let is_view = matches!(spec.collection_type, mongodb::results::CollectionType::View);
                view_map.insert(spec.name.clone(), is_view);
            }
        }
    }

    let coll_names = db
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))?;

    let mut stats_list = Vec::new();

    for name in coll_names {
        let mut doc_count = 0;
        let mut storage_size = 0;
        let mut index_count = 0;
        let mut is_capped = false;
        let is_view = *view_map.get(&name).unwrap_or(&false);

        // Views do not support collStats; skip stats collection for them
        if !is_view {
            // Try collStats command
            if let Ok(stats_doc) = db.run_command(doc! { "collStats": &name }).await {
                doc_count = stats_doc.get_i64("count").unwrap_or(
                    stats_doc.get_i32("count").unwrap_or(0) as i64
                ) as u64;
                storage_size = stats_doc.get_i64("storageSize").unwrap_or(
                    stats_doc.get_i32("storageSize").unwrap_or(0) as i64
                ) as u64;
                index_count = stats_doc.get_i32("nindexes").unwrap_or(0) as u64;
                is_capped = stats_doc.get_bool("capped").unwrap_or(false);
            } else {
                // Fallback for document count
                let collection = db.collection::<Document>(&name);
                if let Ok(count) = collection.estimated_document_count().await {
                    doc_count = count;
                }
            }
        }

        stats_list.push(CollectionStats {
            name,
            document_count: doc_count,
            storage_size,
            index_count,
            is_capped,
            is_view,
        });
    }

    stats_list.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(stats_list)
}

// Create a new collection
pub async fn create_collection(
    state: &AppState,
    db_name: String,
    name: String,
    capped: Option<bool>,
    size: Option<i64>,
    max: Option<i64>,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    
    let mut options = mongodb::options::CreateCollectionOptions::default();
    if capped.unwrap_or(false) {
        options.capped = Some(true);
        if let Some(s) = size {
            options.size = Some(s as u64);
        }
        if let Some(m) = max {
            options.max = Some(m as u64);
        }
    }
    
    db.create_collection(&name)
        .with_options(options)
        .await
        .map_err(|e| format!("Failed to create collection: {}", e))?;
        
    Ok(())
}

// Drop an existing collection
pub async fn drop_collection(
    state: &AppState,
    db_name: String,
    coll_name: String,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    collection
        .drop()
        .await
        .map_err(|e| format!("Failed to drop collection: {}", e))?;
        
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IndexInfo {
    pub name: String,
    pub key: serde_json::Value,
    pub size: u64,
    pub accesses: Option<u64>,
    pub unique: bool,
    pub sparse: bool,
}

// List indexes for a collection
pub async fn list_indexes(
    state: &AppState,
    db_name: String,
    coll_name: String,
) -> Result<Vec<IndexInfo>, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let mut cursor = collection.list_indexes().await
        .map_err(|e| format!("Failed to list indexes: {}", e))?;
        
    // Get index sizes from collStats
    let mut index_sizes = std::collections::HashMap::new();
    if let Ok(stats_doc) = db.run_command(doc! { "collStats": &coll_name }).await {
        if let Ok(sizes_doc) = stats_doc.get_document("indexSizes") {
            for (name, size_val) in sizes_doc {
                let size = match size_val {
                    bson::Bson::Int32(s) => *s as u64,
                    bson::Bson::Int64(s) => *s as u64,
                    bson::Bson::Double(s) => *s as u64,
                    _ => 0,
                };
                index_sizes.insert(name.clone(), size);
            }
        }
    }
    
    // Get index usage from $indexStats aggregation
    let mut index_accesses = std::collections::HashMap::new();
    let pipeline = vec![doc! { "$indexStats": {} }];
    if let Ok(mut cursor_stats) = collection.aggregate(pipeline).await {
        while let Ok(true) = cursor_stats.advance().await {
            if let Ok(stat_doc) = cursor_stats.deserialize_current() {
                if let (Ok(name), Ok(accesses_doc)) = (stat_doc.get_str("name"), stat_doc.get_document("accesses")) {
                    let ops = accesses_doc.get_i64("ops").unwrap_or(
                        accesses_doc.get_i32("ops").unwrap_or(0) as i64
                    ) as u64;
                    index_accesses.insert(name.to_string(), ops);
                }
            }
        }
    }
    
    let mut index_list = Vec::new();
    while cursor.advance().await.map_err(|e| format!("Cursor error: {}", e))? {
        let index_model = cursor.deserialize_current()
            .map_err(|e| format!("Deserialization error: {}", e))?;
            
        let key_json = serde_json::to_value(&index_model.keys)
            .map_err(|e| format!("Failed to convert key BSON to JSON: {}", e))?;
            
        let name = index_model.options.as_ref()
            .and_then(|o| o.name.clone())
            .unwrap_or_else(|| "".to_string());
            
        let unique = index_model.options.as_ref()
            .and_then(|o| o.unique)
            .unwrap_or(false);
            
        let sparse = index_model.options.as_ref()
            .and_then(|o| o.sparse)
            .unwrap_or(false);
            
        let size = *index_sizes.get(&name).unwrap_or(&0);
        let accesses = index_accesses.get(&name).cloned();
        
        index_list.push(IndexInfo {
            name,
            key: key_json,
            size,
            accesses,
            unique,
            sparse,
        });
    }
    
    Ok(index_list)
}

// Create a new index
pub async fn create_index(
    state: &AppState,
    db_name: String,
    coll_name: String,
    keys_json: String,
    name: Option<String>,
    unique: Option<bool>,
    sparse: Option<bool>,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let keys_doc = json_to_document(&keys_json)?;
    
    let mut options = mongodb::options::IndexOptions::default();
    options.name = name.filter(|n| !n.trim().is_empty());
    options.unique = unique;
    options.sparse = sparse;
    
    let index_model = mongodb::IndexModel::builder()
        .keys(keys_doc)
        .options(options)
        .build();
        
    collection.create_index(index_model).await
        .map_err(|e| format!("Failed to create index: {}", e))?;
        
    Ok(())
}

// Drop an existing index by name
pub async fn drop_index(
    state: &AppState,
    db_name: String,
    coll_name: String,
    name: String,
) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    collection.drop_index(name).await
        .map_err(|e| format!("Failed to drop index: {}", e))?;
        
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurrentOp {
    pub opid: i64,
    pub client: Option<String>,
    pub op: Option<String>,
    pub ns: Option<String>,
    pub secs_running: Option<i64>,
    pub query: Option<String>,
}

// Get active database operations (currentOp)
pub async fn current_ops(state: &AppState) -> Result<Vec<CurrentOp>, String> {
    let client = get_client(&state).await?;
    
    let admin_db = client.database("admin");
    let result = admin_db
        .run_command(doc! { "currentOp": 1 })
        .await
        .map_err(|e| format!("Failed to run currentOp command: {}", e))?;
        
    let inprog = result.get_array("inprog")
        .map_err(|_| "Failed to parse currentOp response: missing 'inprog' field".to_string())?;
        
    let mut ops = Vec::new();
    for op_val in inprog {
        if let Some(op_doc) = op_val.as_document() {
            let opid = op_doc.get_i64("opid")
                .or_else(|_| op_doc.get_i32("opid").map(|v| v as i64))
                .unwrap_or(0);
                
            let client_str = op_doc.get_str("client").ok().map(|s| s.to_string());
            let op_type = op_doc.get_str("op").ok().map(|s| s.to_string());
            let ns = op_doc.get_str("ns").ok().map(|s| s.to_string());
            
            let secs_running = op_doc.get_i64("secs_running")
                .or_else(|_| op_doc.get_i32("secs_running").map(|v| v as i64))
                .ok();
                
            let query = if let Ok(cmd_doc) = op_doc.get_document("command") {
                serde_json::to_string(cmd_doc).ok()
            } else if let Ok(q_doc) = op_doc.get_document("query") {
                serde_json::to_string(q_doc).ok()
            } else {
                None
            };
            
            ops.push(CurrentOp {
                opid,
                client: client_str,
                op: op_type,
                ns,
                secs_running,
                query,
            });
        }
    }
    
    Ok(ops)
}

// Terminate an active operation by its ID
pub async fn kill_op(state: &AppState, opid: i64) -> Result<(), String> {
    let client = get_client(&state).await?;
    
    let admin_db = client.database("admin");
    admin_db
        .run_command(doc! { "killOp": 1, "op": opid })
        .await
        .map_err(|e| format!("Failed to kill operation {}: {}", opid, e))?;
        
    Ok(())
}

// Run an aggregation pipeline and return a capped preview list of documents
pub async fn aggregate_documents(
    state: &AppState,
    db_name: String,
    coll_name: String,
    pipeline_str: String,
) -> Result<Vec<serde_json::Value>, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let pipeline = parse_pipeline(&pipeline_str)?;

    let mut cursor = collection
        .aggregate(pipeline)
        .await
        .map_err(|e| format!("Aggregation pipeline failed: {}", e))?;
        
    let mut documents = Vec::new();
    let mut count = 0;
    while cursor.advance().await.map_err(|e| format!("Cursor error: {}", e))? {
        let doc = cursor.deserialize_current().map_err(|e| format!("Deserialization error: {}", e))?;
        let json_val = serde_json::to_value(&doc)
            .map_err(|e| format!("BSON to JSON conversion error: {}", e))?;
        documents.push(json_val);
        count += 1;
        if count >= 20 {
            break;
        }
    }
    
    Ok(documents)
}

// Explain an aggregation pipeline and return the explain plan
pub async fn explain_aggregation(
    state: &AppState,
    db_name: String,
    coll_name: String,
    pipeline_str: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state).await?;
    
    let db = client.database(&db_name);
    let pipeline = parse_pipeline(&pipeline_str)?;
    
    let explain_cmd = doc! {
        "explain": doc! {
            "aggregate": &coll_name,
            "pipeline": pipeline,
            "cursor": doc! {}
        },
        "verbosity": "executionStats"
    };
    
    let result = db.run_command(explain_cmd).await
        .map_err(|e| format!("Explain aggregation failed: {}", e))?;
        
    let json_val = serde_json::to_value(&result)
        .map_err(|e| format!("BSON to JSON conversion error: {}", e))?;
        
    Ok(json_val)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Opcounters {
    pub insert: i64,
    pub query: i64,
    pub update: i64,
    pub delete: i64,
    pub getmore: i64,
    pub command: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionsMetrics {
    pub current: i64,
    pub available: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServerStatusResult {
    pub opcounters: Opcounters,
    pub connections: ConnectionsMetrics,
    pub mem_resident_mb: f64,
    pub network_bytes_in: i64,
    pub network_bytes_out: i64,
    pub wt_cache_used_bytes: Option<i64>,
    pub wt_cache_max_bytes: Option<i64>,
    pub wt_cache_pages_requested: Option<i64>,
    pub wt_cache_pages_read: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReplSetStatusResult {
    pub is_replica_set: bool,
    pub my_state: Option<String>,
    pub lag_ms: Option<i64>,
}

// Get server status metrics (opcounters, connections, mem, network, wt cache)
pub async fn server_status(state: &AppState) -> Result<ServerStatusResult, String> {
    let client = get_client(&state).await?;
    
    let admin_db = client.database("admin");
    let result = admin_db
        .run_command(doc! { "serverStatus": 1 })
        .await
        .map_err(|e| format!("Failed to run serverStatus command: {}", e))?;
        
    // Parse opcounters
    let opcounters_doc = result.get_document("opcounters")
        .map_err(|_| "Failed to parse serverStatus: missing 'opcounters'".to_string())?;
    
    let get_counter = |d: &Document, k: &str| -> i64 {
        d.get_i64(k).or_else(|_| d.get_i32(k).map(|v| v as i64)).unwrap_or(0)
    };
    
    let opcounters = Opcounters {
        insert: get_counter(opcounters_doc, "insert"),
        query: get_counter(opcounters_doc, "query"),
        update: get_counter(opcounters_doc, "update"),
        delete: get_counter(opcounters_doc, "delete"),
        getmore: get_counter(opcounters_doc, "getmore"),
        command: get_counter(opcounters_doc, "command"),
    };
    
    // Parse connections
    let connections_doc = result.get_document("connections")
        .map_err(|_| "Failed to parse serverStatus: missing 'connections'".to_string())?;
    let connections = ConnectionsMetrics {
        current: get_counter(connections_doc, "current"),
        available: get_counter(connections_doc, "available"),
    };
    
    // Parse mem
    let mem_doc = result.get_document("mem")
        .map_err(|_| "Failed to parse serverStatus: missing 'mem'".to_string())?;
    let mem_resident_mb = mem_doc.get_f64("resident")
        .or_else(|_| mem_doc.get_i32("resident").map(|v| v as f64))
        .or_else(|_| mem_doc.get_i64("resident").map(|v| v as f64))
        .unwrap_or(0.0);
        
    // Parse network
    let network_doc = result.get_document("network")
        .map_err(|_| "Failed to parse serverStatus: missing 'network'".to_string())?;
    let network_bytes_in = get_counter(network_doc, "bytesIn");
    let network_bytes_out = get_counter(network_doc, "bytesOut");
    
    // Parse wiredTiger cache if present
    let mut wt_cache_used_bytes = None;
    let mut wt_cache_max_bytes = None;
    let mut wt_cache_pages_requested = None;
    let mut wt_cache_pages_read = None;
    
    if let Ok(wt_doc) = result.get_document("wiredTiger") {
        if let Ok(cache_doc) = wt_doc.get_document("cache") {
            wt_cache_used_bytes = Some(get_counter(cache_doc, "bytes currently in the cache"));
            wt_cache_max_bytes = Some(get_counter(cache_doc, "maximum bytes configured"));
            wt_cache_pages_requested = Some(get_counter(cache_doc, "pages requested from the cache"));
            wt_cache_pages_read = Some(get_counter(cache_doc, "pages read into cache"));
        }
    }
    
    Ok(ServerStatusResult {
        opcounters,
        connections,
        mem_resident_mb,
        network_bytes_in,
        network_bytes_out,
        wt_cache_used_bytes,
        wt_cache_max_bytes,
        wt_cache_pages_requested,
        wt_cache_pages_read,
    })
}

// Get replication set status and calculate lag relative to PRIMARY
pub async fn repl_set_status(state: &AppState) -> Result<ReplSetStatusResult, String> {
    let client = get_client(&state).await?;
    
    let admin_db = client.database("admin");
    let result = match admin_db.run_command(doc! { "replSetGetStatus": 1 }).await {
        Ok(r) => r,
        Err(_) => {
            // Standalone or non-replica-set deployment
            return Ok(ReplSetStatusResult {
                is_replica_set: false,
                my_state: None,
                lag_ms: None,
            });
        }
    };
    
    // It's a replica set!
    let members = result.get_array("members")
        .map_err(|_| "Failed to parse replSetGetStatus: missing 'members'".to_string())?;
        
    let mut my_state = None;
    let mut self_optime = None;
    let mut primary_optime = None;
    
    for member_val in members {
        if let Some(member_doc) = member_val.as_document() {
            let is_self = member_doc.get_bool("self").unwrap_or(false);
            let state_str = member_doc.get_str("stateStr").ok().map(|s| s.to_string());
            
            if is_self {
                my_state = state_str.clone();
                self_optime = member_doc.get_datetime("optimeDate").ok().copied();
            }
            if state_str.as_deref() == Some("PRIMARY") {
                primary_optime = member_doc.get_datetime("optimeDate").ok().copied();
            }
        }
    }
    
    let lag_ms = match (self_optime, primary_optime) {
        (Some(self_t), Some(primary_t)) => {
            let self_ms = self_t.timestamp_millis();
            let primary_ms = primary_t.timestamp_millis();
            let diff = primary_ms - self_ms;
            Some(if diff < 0 { 0 } else { diff })
        }
        _ => None,
    };
    
    Ok(ReplSetStatusResult {
        is_replica_set: true,
        my_state,
        lag_ms,
    })
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LogPayload {
    pub text: String,
}

// Find path to executable (mongodump/mongorestore)
fn find_executable(name: &str) -> Result<PathBuf, String> {
    // 1. Check common absolute paths on macOS / Unix first
    let common_paths = [
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/usr/bin/{}", name),
        format!("/bin/{}", name),
    ];
    for path_str in &common_paths {
        let path = PathBuf::from(path_str);
        if path.exists() && path.is_file() {
            return Ok(path);
        }
    }

    // 2. Check PATH environment variable
    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let path = dir.join(name);
            if path.exists() && path.is_file() {
                return Ok(path);
            }
        }
    }

    Err(format!(
        "Could not find '{}' executable. Please make sure MongoDB Database Tools are installed (e.g., 'brew install mongodb-database-tools') and available in your PATH.",
        name
    ))
}

pub async fn run_mongodump(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    db: Option<String>,
    collection: Option<String>,
    out_path: String,
    gzip: bool,
    oplog: bool,
    num_parallel_collections: Option<i32>,
    dry_run: Option<bool>,
) -> Result<(), String> {
    let uri = get_uri(&state).await?;

    // Find mongodump path (skipped for dry run since we don't need to execute)
    let exec_path = if dry_run.unwrap_or(false) {
        PathBuf::from("mongodump")
    } else {
        find_executable("mongodump")?
    };

    // Build arguments
    let mut args = vec![format!("--uri={}", uri)];
    if let Some(db_name) = db {
        if !db_name.trim().is_empty() {
            args.push(format!("--db={}", db_name));
            if let Some(coll_name) = collection {
                if !coll_name.trim().is_empty() {
                    args.push(format!("--collection={}", coll_name));
                }
            }
        }
    }

    args.push(format!("--out={}", out_path));

    if gzip {
        args.push("--gzip".to_string());
    }
    if oplog {
        args.push("--oplog".to_string());
    }
    if let Some(j) = num_parallel_collections {
        if j > 0 {
            args.push(format!("--numParallelCollections={}", j));
        }
    }

    if dry_run.unwrap_or(false) {
        let cmd_str = format!("mongodump {}", args.join(" "));
        let _ = app_handle.emit("dump-log", LogPayload { text: format!("[Compass+] [DRY RUN] Would execute: {}", cmd_str) });
        return Ok(());
    }

    stream_subprocess(app_handle, "dump-log", exec_path, args).await
}

pub async fn run_mongorestore(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    in_path: String,
    db: Option<String>,
    collection: Option<String>,
    drop: bool,
    no_index_restore: bool,
    maintain_insertion_order: bool,
    stop_on_error: bool,
    dry_run: Option<bool>,
) -> Result<(), String> {
    let uri = get_uri(&state).await?;

    // Find mongorestore path (skipped for dry run since we don't need to execute)
    let exec_path = if dry_run.unwrap_or(false) {
        PathBuf::from("mongorestore")
    } else {
        find_executable("mongorestore")?
    };

    // Build arguments
    let mut args = vec![format!("--uri={}", uri)];
    if let Some(db_name) = db {
        if !db_name.trim().is_empty() {
            args.push(format!("--db={}", db_name));
            if let Some(coll_name) = collection {
                if !coll_name.trim().is_empty() {
                    args.push(format!("--collection={}", coll_name));
                }
            }
        }
    }

    if drop {
        args.push("--drop".to_string());
    }
    if no_index_restore {
        args.push("--noIndexRestore".to_string());
    }
    if maintain_insertion_order {
        args.push("--maintainInsertionOrder".to_string());
    }
    if stop_on_error {
        args.push("--stopOnError".to_string());
    }

    args.push(in_path);

    if dry_run.unwrap_or(false) {
        let cmd_str = format!("mongorestore {}", args.join(" "));
        let _ = app_handle.emit("restore-log", LogPayload { text: format!("[Compass+] [DRY RUN] Would execute: {}", cmd_str) });
        return Ok(());
    }

    stream_subprocess(app_handle, "restore-log", exec_path, args).await
}

// Fetch MongoDB collection validator options (usually $jsonSchema)
pub async fn get_collection_validator(
    state: &AppState,
    db_name: String,
    coll_name: String,
) -> Result<Option<serde_json::Value>, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    
    let cmd = doc! {
        "listCollections": 1,
        "filter": doc! { "name": &coll_name }
    };
    
    let res = db.run_command(cmd).await
        .map_err(|e| format!("Failed to fetch collection validator: {}", e))?;
        
    if let Ok(cursor) = res.get_document("cursor") {
        if let Ok(first_batch) = cursor.get_array("firstBatch") {
            if let Some(coll_info_bson) = first_batch.first() {
                if let Some(coll_info) = coll_info_bson.as_document() {
                    if let Ok(options) = coll_info.get_document("options") {
                        if let Ok(validator) = options.get_document("validator") {
                            let json_val = serde_json::to_value(validator)
                                .map_err(|e| format!("Failed to serialize validator: {}", e))?;
                            return Ok(Some(json_val));
                        }
                    }
                }
            }
        }
    }
    
    Ok(None)
}

// Bulk insert documents
pub async fn insert_many(
    state: &AppState,
    db_name: String,
    coll_name: String,
    docs: Vec<serde_json::Value>,
) -> Result<Vec<String>, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    
    let mut documents = Vec::new();
    for val in docs {
        let bson_val = bson::to_bson(&val)
            .map_err(|e| format!("BSON conversion error: {}", e))?;
        if let bson::Bson::Document(doc) = bson_val {
            documents.push(doc);
        } else {
            return Err("Expected objects in document list".to_string());
        }
    }
    
    if documents.is_empty() {
        return Ok(Vec::new());
    }
    
    let result = collection
        .insert_many(documents)
        .await
        .map_err(|e| format!("Insertion failed: {}", e))?;
        
    let ids = result.inserted_ids
        .into_iter()
        .map(|(_, id)| format!("{:?}", id))
        .collect();
        
    Ok(ids)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionDiagnostics {
    pub uri_parse_ok: bool,
    pub uri_parse_error: Option<String>,
    pub dns_resolve_ok: bool,
    pub dns_resolve_error: Option<String>,
    pub tcp_connect_ok: bool,
    pub tcp_connect_error: Option<String>,
    pub auth_ok: bool,
    pub auth_error: Option<String>,
}

pub async fn diagnose_uri(uri: String) -> Result<ConnectionDiagnostics, String> {
    let mut diag = ConnectionDiagnostics {
        uri_parse_ok: false,
        uri_parse_error: None,
        dns_resolve_ok: false,
        dns_resolve_error: None,
        tcp_connect_ok: false,
        tcp_connect_error: None,
        auth_ok: false,
        auth_error: None,
    };

    // 1. URI Parsing
    let mut client_options = match ClientOptions::parse(&uri).await {
        Ok(opts) => {
            diag.uri_parse_ok = true;
            opts
        }
        Err(e) => {
            diag.uri_parse_error = Some(e.to_string());
            return Ok(diag);
        }
    };

    // 2. DNS Resolve & TCP Connection Probes
    let mut dns_ok = true;
    let mut dns_err = None;
    let mut tcp_ok = true;
    let mut tcp_err = None;

    if client_options.hosts.is_empty() {
        dns_ok = false;
        dns_err = Some("No database hosts specified in the connection URI".to_string());
        tcp_ok = false;
        tcp_err = Some("TCP check skipped".to_string());
    } else {
        for host in &client_options.hosts {
            let (host_str, port) = match host {
                mongodb::options::ServerAddress::Tcp { host, port } => {
                    (host.as_str(), port.unwrap_or(27017))
                }
                _ => ("", 27017),
            };
            match tokio::net::lookup_host((host_str, port)).await {
                Ok(mut addrs) => {
                    if let Some(addr) = addrs.next() {
                        // DNS query was successful for this host.
                        // Now probe TCP socket connection:
                        match tokio::time::timeout(
                            std::time::Duration::from_secs(3),
                            tokio::net::TcpStream::connect(addr),
                        )
                        .await
                        {
                            Ok(Ok(_)) => {
                                // TCP connection succeeded!
                            }
                            Ok(Err(e)) => {
                                tcp_ok = false;
                                tcp_err = Some(format!(
                                    "Failed to connect to host '{}' at {}: {}",
                                    host_str, addr, e
                                ));
                            }
                            Err(_) => {
                                tcp_ok = false;
                                tcp_err = Some(format!(
                                    "TCP connection to host '{}' at {} timed out after 3s",
                                    host_str, addr
                                ));
                            }
                        }
                    } else {
                        dns_ok = false;
                        dns_err = Some(format!("No IP addresses found for hostname '{}'", host_str));
                    }
                }
                Err(e) => {
                    dns_ok = false;
                    dns_err = Some(format!(
                        "DNS resolution failed for hostname '{}': {}",
                        host_str, e
                    ));
                    tcp_ok = false;
                    tcp_err = Some("TCP check skipped due to DNS resolution failure".to_string());
                }
            }
        }
    }

    diag.dns_resolve_ok = dns_ok;
    diag.dns_resolve_error = dns_err;
    diag.tcp_connect_ok = tcp_ok;
    diag.tcp_connect_error = tcp_err;

    if !diag.dns_resolve_ok || !diag.tcp_connect_ok {
        diag.auth_ok = false;
        diag.auth_error = Some("Authentication check skipped due to network probes failure".to_string());
        return Ok(diag);
    }

    // 3. Database Authenticated Ping
    client_options.connect_timeout = Some(std::time::Duration::from_secs(3));
    client_options.server_selection_timeout = Some(std::time::Duration::from_secs(3));
    
    match Client::with_options(client_options) {
        Ok(client) => {
            let admin_db = client.database("admin");
            match admin_db.run_command(doc! { "ping": 1 }).await {
                Ok(_) => {
                    diag.auth_ok = true;
                }
                Err(e) => {
                    diag.auth_ok = false;
                    diag.auth_error = Some(format!("Authentication / Ping failed: {}", e));
                }
            }
        }
        Err(e) => {
            diag.auth_ok = false;
            diag.auth_error = Some(format!("Failed to initialize client options: {}", e));
        }
    }

    Ok(diag)
}

pub async fn get_collection_size(
    state: &AppState,
    db_name: String,
    coll_name: String,
) -> Result<u64, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    
    let res = db.run_command(doc! { "collStats": &coll_name }).await
        .map_err(|e| format!("Failed to fetch stats: {}", e))?;
        
    let size = res.get_i64("size")
        .or_else(|_| res.get_i32("size").map(|v| v as i64))
        .unwrap_or(0);
        
    Ok(size as u64)
}

pub async fn start_shell(
    app_handle: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let uri = get_uri(state).await?;
    let exec_path = find_executable("mongosh")?;

    // Terminate existing shell if any
    let mut stdin_guard = state.shell_stdin.lock().await;
    *stdin_guard = None;

    let mut child = Command::new(exec_path)
        .arg(&uri)
        .arg("--norc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn mongosh: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    *stdin_guard = Some(stdin);

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle_clone.emit("shell-log", LogPayload { text: line });
        }
    });

    let app_handle_clone2 = app_handle.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle_clone2.emit("shell-log", LogPayload { text: format!("[ERROR] {}", line) });
        }
    });

    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(())
}

pub async fn write_shell_command(
    state: &AppState,
    command: String,
) -> Result<(), String> {
    let mut stdin_guard = state.shell_stdin.lock().await;
    if let Some(stdin) = stdin_guard.as_mut() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(command.as_bytes()).await
            .map_err(|e| format!("Failed to write to shell: {}", e))?;
        stdin.write_all(b"\n").await
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        stdin.flush().await
            .map_err(|e| format!("Failed to flush shell stdin: {}", e))?;
        Ok(())
    } else {
        Err("Shell is not running".to_string())
    }
}

// ── Schema Validation ────────────────────────────────────────────────────────

// Set or update a collection's validator via collMod. Pass an empty object to clear.
pub async fn set_collection_validator(
    state: &AppState,
    db_name: String,
    coll_name: String,
    validator_json: String,
    validation_level: Option<String>,
    validation_action: Option<String>,
) -> Result<(), String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);

    let validator = json_to_document(&validator_json)?;

    let mut cmd = doc! {
        "collMod": &coll_name,
        "validator": validator,
    };
    if let Some(level) = validation_level.filter(|s| !s.trim().is_empty()) {
        cmd.insert("validationLevel", level);
    }
    if let Some(action) = validation_action.filter(|s| !s.trim().is_empty()) {
        cmd.insert("validationAction", action);
    }

    db.run_command(cmd)
        .await
        .map_err(|e| format!("Failed to set collection validator: {}", e))?;
    Ok(())
}

// ── Bulk write operations ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BulkWriteResult {
    pub matched_count: u64,
    pub modified_count: u64,
}

// Update many documents matching a filter (update must contain update operators)
pub async fn update_many(
    state: &AppState,
    db_name: String,
    coll_name: String,
    filter_json: String,
    update_json: String,
) -> Result<BulkWriteResult, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);

    let filter = json_to_document(&filter_json)?;
    let update = json_to_document(&update_json)?;

    let res = collection
        .update_many(filter, update)
        .await
        .map_err(|e| format!("Bulk update failed: {}", e))?;

    Ok(BulkWriteResult {
        matched_count: res.matched_count,
        modified_count: res.modified_count,
    })
}

// Delete many documents matching a filter; returns the deleted count
pub async fn delete_many(
    state: &AppState,
    db_name: String,
    coll_name: String,
    filter_json: String,
) -> Result<u64, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);

    let filter = json_to_document(&filter_json)?;
    let res = collection
        .delete_many(filter)
        .await
        .map_err(|e| format!("Bulk delete failed: {}", e))?;
    Ok(res.deleted_count)
}

// Count documents matching a filter (used for bulk-op previews)
pub async fn count_documents(
    state: &AppState,
    db_name: String,
    coll_name: String,
    filter_json: String,
) -> Result<u64, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(&coll_name);
    let filter = json_to_document(&filter_json)?;
    collection
        .count_documents(filter)
        .await
        .map_err(|e| format!("Count failed: {}", e))
}

// ── Explain find ──────────────────────────────────────────────────────────────

// Explain a find query and return the execution plan
pub async fn explain_find(
    state: &AppState,
    db_name: String,
    coll_name: String,
    filter_str: String,
    sort_str: String,
    projection_str: String,
    limit: i64,
    skip: i64,
) -> Result<serde_json::Value, String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);

    let filter = json_to_document(&filter_str)?;
    let sort = json_to_document(&sort_str)?;
    let projection = json_to_document(&projection_str)?;

    let mut find_cmd = doc! {
        "find": &coll_name,
        "filter": filter,
    };
    if !sort.is_empty() {
        find_cmd.insert("sort", sort);
    }
    if !projection.is_empty() {
        find_cmd.insert("projection", projection);
    }
    if limit > 0 {
        find_cmd.insert("limit", limit);
    }
    if skip > 0 {
        find_cmd.insert("skip", skip);
    }

    let explain_cmd = doc! {
        "explain": find_cmd,
        "verbosity": "executionStats",
    };

    let result = db
        .run_command(explain_cmd)
        .await
        .map_err(|e| format!("Explain find failed: {}", e))?;
    serde_json::to_value(&result)
        .map_err(|e| format!("BSON to JSON conversion error: {}", e))
}

// ── Views & databases ─────────────────────────────────────────────────────────

// Create a read-only view from a source collection and an aggregation pipeline
pub async fn create_view(
    state: &AppState,
    db_name: String,
    view_name: String,
    source: String,
    pipeline_str: String,
) -> Result<(), String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    let pipeline = parse_pipeline(&pipeline_str)?;

    db.run_command(doc! {
        "create": &view_name,
        "viewOn": &source,
        "pipeline": pipeline,
    })
    .await
    .map_err(|e| format!("Failed to create view: {}", e))?;
    Ok(())
}

// Create a database by creating its first collection
pub async fn create_database(
    state: &AppState,
    db_name: String,
    coll_name: String,
) -> Result<(), String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    db.create_collection(&coll_name)
        .await
        .map_err(|e| format!("Failed to create database: {}", e))?;
    Ok(())
}

// Drop an entire database
pub async fn drop_database(state: &AppState, db_name: String) -> Result<(), String> {
    let client = get_client(state).await?;
    let db = client.database(&db_name);
    db.drop()
        .await
        .map_err(|e| format!("Failed to drop database: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_to_document_empty() {
        let doc = json_to_document("").unwrap();
        assert!(doc.is_empty());

        let doc = json_to_document("   ").unwrap();
        assert!(doc.is_empty());
    }

    #[test]
    fn test_json_to_document_valid() {
        let doc = json_to_document(r#"{"name": "John", "age": 30}"#).unwrap();
        assert_eq!(doc.get_str("name").unwrap(), "John");
        assert_eq!(doc.get_i64("age").unwrap(), 30);
    }

    #[test]
    fn test_json_to_document_invalid() {
        let res = json_to_document(r#"{"name": "John", "#);
        assert!(res.is_err());
    }

    #[test]
    fn test_json_to_document_extended_bson() {
        let doc = json_to_document(r#"{"_id": {"$oid": "507f1f77bcf86cd799439011"}}"#).unwrap();
        let id = doc.get_object_id("_id").unwrap();
        assert_eq!(id.to_hex(), "507f1f77bcf86cd799439011");
    }

    #[tokio::test]
    async fn test_connect_invalid_uri() {
        let state = AppState::new();
        let res = connect(&state, "http://localhost:27017".to_string()).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Failed to parse URI"));
    }

    #[test]
    fn test_parse_current_op_response() {
        let op_doc = doc! {
            "opid": 12345i64,
            "client": "127.0.0.1:12345",
            "op": "query",
            "ns": "test_db.test_coll",
            "secs_running": 5i32,
            "command": {
                "find": "test_coll",
                "filter": { "name": "Alice" }
            }
        };
        
        let opid = op_doc.get_i64("opid")
            .or_else(|_| op_doc.get_i32("opid").map(|v| v as i64))
            .unwrap_or(0);
        assert_eq!(opid, 12345);
        
        let client_str = op_doc.get_str("client").ok().map(|s| s.to_string());
        assert_eq!(client_str, Some("127.0.0.1:12345".to_string()));
        
        let op_type = op_doc.get_str("op").ok().map(|s| s.to_string());
        assert_eq!(op_type, Some("query".to_string()));
        
        let ns = op_doc.get_str("ns").ok().map(|s| s.to_string());
        assert_eq!(ns, Some("test_db.test_coll".to_string()));
        
        let secs_running = op_doc.get_i64("secs_running")
            .or_else(|_| op_doc.get_i32("secs_running").map(|v| v as i64))
            .ok();
        assert_eq!(secs_running, Some(5));
        
        let query = if let Ok(cmd_doc) = op_doc.get_document("command") {
            serde_json::to_string(cmd_doc).ok()
        } else if let Ok(q_doc) = op_doc.get_document("query") {
            serde_json::to_string(q_doc).ok()
        } else {
            None
        };
        assert!(query.is_some());
        let parsed_query: serde_json::Value = serde_json::from_str(&query.unwrap()).unwrap();
        assert_eq!(parsed_query["find"], "test_coll");
        assert_eq!(parsed_query["filter"]["name"], "Alice");
    }

    #[test]
    fn test_parse_server_status_doc() {
        let status_doc = doc! {
            "opcounters": {
                "insert": 10i32,
                "query": 20i32,
                "update": 30i32,
                "delete": 40i32,
                "getmore": 50i32,
                "command": 60i32
            },
            "connections": {
                "current": 5i32,
                "available": 100i32
            },
            "mem": {
                "resident": 256i32,
                "virtual": 1024i32
            },
            "network": {
                "bytesIn": 1000i64,
                "bytesOut": 2000i64
            },
            "wiredTiger": {
                "cache": {
                    "bytes currently in the cache": 500i64,
                    "maximum bytes configured": 1000i64,
                    "pages requested from the cache": 100i64,
                    "pages read into cache": 5i64
                }
            }
        };

        let opcounters_doc = status_doc.get_document("opcounters").unwrap();
        let get_counter = |d: &Document, k: &str| -> i64 {
            d.get_i64(k).or_else(|_| d.get_i32(k).map(|v| v as i64)).unwrap_or(0)
        };

        assert_eq!(get_counter(opcounters_doc, "insert"), 10);
        assert_eq!(get_counter(opcounters_doc, "query"), 20);

        let connections_doc = status_doc.get_document("connections").unwrap();
        assert_eq!(get_counter(connections_doc, "current"), 5);

        let mem_doc = status_doc.get_document("mem").unwrap();
        let mem_resident_mb = mem_doc.get_f64("resident")
            .or_else(|_| mem_doc.get_i32("resident").map(|v| v as f64))
            .or_else(|_| mem_doc.get_i64("resident").map(|v| v as f64))
            .unwrap_or(0.0);
        assert_eq!(mem_resident_mb, 256.0);

        let network_doc = status_doc.get_document("network").unwrap();
        assert_eq!(get_counter(network_doc, "bytesIn"), 1000);

        let wt_doc = status_doc.get_document("wiredTiger").unwrap();
        let cache_doc = wt_doc.get_document("cache").unwrap();
        assert_eq!(get_counter(cache_doc, "bytes currently in the cache"), 500);
        assert_eq!(get_counter(cache_doc, "maximum bytes configured"), 1000);
    }

    #[test]
    fn test_parse_repl_set_status_doc() {
        let repl_doc = doc! {
            "members": [
                {
                    "self": true,
                    "stateStr": "SECONDARY",
                    "optimeDate": bson::DateTime::from_millis(1000)
                },
                {
                    "self": false,
                    "stateStr": "PRIMARY",
                    "optimeDate": bson::DateTime::from_millis(1500)
                }
            ]
        };

        let members = repl_doc.get_array("members").unwrap();
        let mut my_state = None;
        let mut self_optime = None;
        let mut primary_optime = None;

        for member_val in members {
            if let Some(member_doc) = member_val.as_document() {
                let is_self = member_doc.get_bool("self").unwrap_or(false);
                let state_str = member_doc.get_str("stateStr").ok().map(|s| s.to_string());

                if is_self {
                    my_state = state_str.clone();
                    self_optime = member_doc.get_datetime("optimeDate").ok().copied();
                }
                if state_str.as_deref() == Some("PRIMARY") {
                    primary_optime = member_doc.get_datetime("optimeDate").ok().copied();
                }
            }
        }

        assert_eq!(my_state, Some("SECONDARY".to_string()));
        let lag_ms = match (self_optime, primary_optime) {
            (Some(self_t), Some(primary_t)) => {
                let self_ms = self_t.timestamp_millis();
                let primary_ms = primary_t.timestamp_millis();
                let diff = primary_ms - self_ms;
                Some(if diff < 0 { 0 } else { diff })
            }
            _ => None,
        };
        assert_eq!(lag_ms, Some(500));
    }

    #[tokio::test]
    async fn test_explain_aggregation_not_connected() {
        let state = AppState::new();
        let res = explain_aggregation(
            &state,
            "test_db".to_string(),
            "test_coll".to_string(),
            "[]".to_string(),
        )
        .await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Not connected to MongoDB"));
    }

    #[test]
    fn test_json_parsing_for_explain() {
        let pipeline_str = r#"[{"$match": {"age": {"$gt": 20}}}]"#;
        let pipeline_json: serde_json::Value = serde_json::from_str(pipeline_str).unwrap();
        let pipeline_array = pipeline_json.as_array().unwrap();
        assert_eq!(pipeline_array.len(), 1);
        let stage_bson = bson::to_bson(&pipeline_array[0]).unwrap();
        let stage_doc = stage_bson.as_document().unwrap();
        assert!(stage_doc.contains_key("$match"));
    }

    #[tokio::test]
    async fn test_bulk_ops_not_connected() {
        let state = AppState::new();
        let upd = update_many(
            &state,
            "db".into(),
            "c".into(),
            "{}".into(),
            r#"{"$set":{"a":1}}"#.into(),
        )
        .await;
        assert!(upd.is_err());
        assert!(upd.unwrap_err().contains("Not connected to MongoDB"));

        let del = delete_many(&state, "db".into(), "c".into(), "{}".into()).await;
        assert!(del.is_err());

        let cnt = count_documents(&state, "db".into(), "c".into(), "{}".into()).await;
        assert!(cnt.is_err());
    }

    #[tokio::test]
    async fn test_validator_and_view_not_connected() {
        let state = AppState::new();
        let v = set_collection_validator(
            &state,
            "db".into(),
            "c".into(),
            "{}".into(),
            Some("strict".into()),
            Some("error".into()),
        )
        .await;
        assert!(v.is_err());

        let view = create_view(
            &state,
            "db".into(),
            "v".into(),
            "c".into(),
            "[]".into(),
        )
        .await;
        assert!(view.is_err());

        let drop = drop_database(&state, "db".into()).await;
        assert!(drop.is_err());
    }

    #[test]
    fn test_explain_find_command_build() {
        // Mirror the command-building logic of explain_find for an empty query
        let filter = json_to_document("{}").unwrap();
        let mut find_cmd = doc! { "find": "users", "filter": filter };
        let sort = json_to_document(r#"{"age": -1}"#).unwrap();
        if !sort.is_empty() {
            find_cmd.insert("sort", sort);
        }
        find_cmd.insert("limit", 20i64);
        assert_eq!(find_cmd.get_str("find").unwrap(), "users");
        assert!(find_cmd.contains_key("sort"));
        assert_eq!(find_cmd.get_i64("limit").unwrap(), 20);
    }

    #[test]
    fn test_find_executable() {
        let res = find_executable("non_existent_executable_12345");
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Could not find"));

        // Since the machine running tests has mongodump, find_executable should find it
        let res_dump = find_executable("mongodump");
        if res_dump.is_ok() {
            let path = res_dump.unwrap();
            assert!(path.exists());
            assert!(path.is_file());
        }
    }
}
