use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const RELEASE_CATALOG_URL: &str = "https://downloads.mongodb.org/tools/db/release.json";
const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 500 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 200 * 1024 * 1024;
const UPDATE_CHECK_TTL: Duration = Duration::from_secs(5 * 60);
const PROGRESS_EVENT: &str = "database-tools-progress";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseToolsInfo {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub bin_dir: String,
    pub downloaded: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseToolsProgress {
    phase: String,
    message: String,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct ReleaseCatalog {
    versions: Vec<ToolsRelease>,
}

#[derive(Clone, Debug, Deserialize)]
struct ToolsRelease {
    version: String,
    #[serde(default)]
    downloads: Vec<ToolsDownload>,
}

#[derive(Clone, Debug, Deserialize)]
struct ToolsDownload {
    name: String,
    arch: String,
    archive: Option<ToolsArchive>,
}

#[derive(Clone, Debug, Deserialize)]
struct ToolsArchive {
    url: String,
    sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledToolsMarker {
    version: String,
    platform: String,
    arch: String,
    install_dir: String,
}

#[derive(Clone, Debug)]
struct SelectedDownload {
    version: String,
    platform: String,
    arch: String,
    archive: ToolsArchive,
}

/// Ensure the latest MongoDB Database Tools release for this platform is
/// installed in the application's data directory.
///
/// The installation mutex prevents React StrictMode or simultaneous dump and
/// restore requests from downloading the same archive more than once.
pub async fn ensure_database_tools(
    app_handle: &AppHandle,
    install_mutex: &Mutex<()>,
    last_checked: &Mutex<Option<Instant>>,
) -> Result<DatabaseToolsInfo, String> {
    let _install_guard = install_mutex.lock().await;
    let tools_root = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the application data directory: {e}"))?
        .join("mongodb-database-tools");

    fs::create_dir_all(&tools_root)
        .await
        .map_err(|e| format!("Could not create {}: {e}", tools_root.display()))?;

    let cached = read_installed_tools(&tools_root).await;
    if let Some(info) = cached.as_ref() {
        if was_checked_recently(last_checked).await {
            emit_progress(
                app_handle,
                "ready",
                format!("MongoDB Database Tools {} are ready.", info.version),
                None,
                None,
            );
            return Ok(info.clone());
        }
    }

    emit_progress(
        app_handle,
        "checking",
        "Checking the latest MongoDB Database Tools release…",
        None,
        None,
    );

    let result = install_latest_release(app_handle, &tools_root, cached.as_ref()).await;
    *last_checked.lock().await = Some(Instant::now());

    match result {
        Ok(info) => {
            emit_progress(
                app_handle,
                "ready",
                format!("MongoDB Database Tools {} are ready.", info.version),
                None,
                None,
            );
            Ok(info)
        }
        Err(update_error) => {
            if let Some(info) = cached {
                emit_progress(
                    app_handle,
                    "ready",
                    format!(
                        "Using installed MongoDB Database Tools {} (update check failed).",
                        info.version
                    ),
                    None,
                    None,
                );
                Ok(info)
            } else {
                let message = format!(
                    "Could not install MongoDB Database Tools automatically: {update_error}"
                );
                emit_progress(app_handle, "error", message.clone(), None, None);
                Err(message)
            }
        }
    }
}

pub fn executable_path(info: &DatabaseToolsInfo, tool: &str) -> Result<PathBuf, String> {
    if !matches!(tool, "mongodump" | "mongorestore") {
        return Err(format!("Unsupported MongoDB Database Tool: {tool}"));
    }

    let path = PathBuf::from(&info.bin_dir).join(executable_file_name(tool));
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "Managed MongoDB Database Tool is missing: {}",
            path.display()
        ))
    }
}

async fn was_checked_recently(last_checked: &Mutex<Option<Instant>>) -> bool {
    last_checked
        .lock()
        .await
        .as_ref()
        .is_some_and(|checked| checked.elapsed() < UPDATE_CHECK_TTL)
}

async fn install_latest_release(
    app_handle: &AppHandle,
    tools_root: &Path,
    cached: Option<&DatabaseToolsInfo>,
) -> Result<DatabaseToolsInfo, String> {
    let client = Client::builder()
        .user_agent(format!("Compass+/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("Could not create the download client: {e}"))?;

    let catalog = fetch_release_catalog(&client).await?;
    let selected = select_latest_download(&catalog)?;

    if let Some(info) = cached {
        if info.version == selected.version
            && info.platform == selected.platform
            && info.arch == selected.arch
        {
            return Ok(info.clone());
        }
    }

    let install_dir_name = format!(
        "{}-{}-{}",
        safe_component(&selected.version),
        safe_component(&selected.platform),
        safe_component(&selected.arch)
    );
    let final_dir = tools_root.join(&install_dir_name);
    let final_bin_dir = final_dir.join("bin");

    if tools_exist(&final_bin_dir).await {
        write_current_marker(
            tools_root,
            &InstalledToolsMarker {
                version: selected.version.clone(),
                platform: selected.platform.clone(),
                arch: selected.arch.clone(),
                install_dir: install_dir_name,
            },
        )
        .await?;
        return Ok(DatabaseToolsInfo {
            version: selected.version,
            platform: selected.platform,
            arch: selected.arch,
            bin_dir: final_bin_dir.to_string_lossy().into_owned(),
            downloaded: false,
        });
    }

    install_download(app_handle, tools_root, &final_dir, &selected).await?;
    write_current_marker(
        tools_root,
        &InstalledToolsMarker {
            version: selected.version.clone(),
            platform: selected.platform.clone(),
            arch: selected.arch.clone(),
            install_dir: install_dir_name,
        },
    )
    .await?;

    Ok(DatabaseToolsInfo {
        version: selected.version,
        platform: selected.platform,
        arch: selected.arch,
        bin_dir: final_bin_dir.to_string_lossy().into_owned(),
        downloaded: true,
    })
}

async fn fetch_release_catalog(client: &Client) -> Result<ReleaseCatalog, String> {
    let response = client
        .get(RELEASE_CATALOG_URL)
        .send()
        .await
        .map_err(|e| format!("Could not fetch the MongoDB release catalog: {e}"))?
        .error_for_status()
        .map_err(|e| format!("MongoDB release catalog returned an error: {e}"))?;

    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_BYTES as u64)
    {
        return Err("MongoDB release catalog is unexpectedly large.".to_string());
    }

    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Could not read the release catalog: {e}"))?;
        if body.len() + chunk.len() > MAX_CATALOG_BYTES {
            return Err("MongoDB release catalog is unexpectedly large.".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    serde_json::from_slice(&body)
        .map_err(|e| format!("MongoDB release catalog contains invalid JSON: {e}"))
}

fn select_latest_download(catalog: &ReleaseCatalog) -> Result<SelectedDownload, String> {
    let candidates = platform_candidates()?;
    select_latest_download_for(catalog, &candidates)
}

fn select_latest_download_for(
    catalog: &ReleaseCatalog,
    candidates: &[(String, String)],
) -> Result<SelectedDownload, String> {
    let release = catalog
        .versions
        .iter()
        .filter_map(|release| version_key(&release.version).map(|key| (key, release)))
        .max_by(|(left, _), (right, _)| left.cmp(right))
        .map(|(_, release)| release)
        .ok_or_else(|| "MongoDB release catalog contains no valid versions.".to_string())?;

    for (platform, arch) in candidates {
        if let Some(download) = release
            .downloads
            .iter()
            .find(|download| download.name == *platform && download.arch == *arch)
        {
            if let Some(archive) = &download.archive {
                validate_archive_metadata(archive)?;
                return Ok(SelectedDownload {
                    version: release.version.clone(),
                    platform: platform.clone(),
                    arch: arch.clone(),
                    archive: archive.clone(),
                });
            }
        }
    }

    Err(format!(
        "MongoDB Database Tools {} do not provide an archive for {} {}.",
        release.version,
        std::env::consts::OS,
        std::env::consts::ARCH
    ))
}

fn validate_archive_metadata(archive: &ToolsArchive) -> Result<(), String> {
    if !archive
        .url
        .starts_with("https://fastdl.mongodb.org/tools/db/")
    {
        return Err("MongoDB release catalog returned an untrusted download URL.".to_string());
    }
    if archive.sha256.len() != 64 || !archive.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("MongoDB release catalog returned an invalid SHA-256 checksum.".to_string());
    }
    Ok(())
}

async fn install_download(
    app_handle: &AppHandle,
    tools_root: &Path,
    final_dir: &Path,
    selected: &SelectedDownload,
) -> Result<(), String> {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staging_dir = tools_root.join(format!(".install-{}-{unique}", std::process::id()));
    let archive_kind = if selected.archive.url.ends_with(".zip") {
        "zip"
    } else if selected.archive.url.ends_with(".tgz") {
        "tgz"
    } else {
        return Err("MongoDB release uses an unsupported archive format.".to_string());
    };
    let archive_path = staging_dir.join(format!("database-tools.{archive_kind}"));

    fs::create_dir_all(&staging_dir)
        .await
        .map_err(|e| format!("Could not create the temporary tools directory: {e}"))?;

    let result = async {
        download_archive(app_handle, &selected.archive, &archive_path).await?;
        emit_progress(
            app_handle,
            "verifying",
            "Verifying the MongoDB Database Tools download…",
            None,
            None,
        );

        verify_sha256(&archive_path, &selected.archive.sha256).await?;
        emit_progress(
            app_handle,
            "extracting",
            "Installing mongodump and mongorestore…",
            None,
            None,
        );

        let archive_path_for_extract = archive_path.clone();
        let bin_dir = staging_dir.join("bin");
        let bin_dir_for_extract = bin_dir.clone();
        let archive_kind = archive_kind.to_string();
        tokio::task::spawn_blocking(move || {
            extract_tools(
                &archive_path_for_extract,
                &archive_kind,
                &bin_dir_for_extract,
            )
        })
        .await
        .map_err(|e| format!("MongoDB Database Tools extraction task failed: {e}"))??;

        verify_executables(&bin_dir).await?;
        fs::remove_file(&archive_path)
            .await
            .map_err(|e| format!("Could not remove the downloaded archive: {e}"))?;

        if final_dir.exists() {
            fs::remove_dir_all(final_dir)
                .await
                .map_err(|e| format!("Could not replace the previous tools installation: {e}"))?;
        }
        fs::rename(&staging_dir, final_dir)
            .await
            .map_err(|e| format!("Could not activate the tools installation: {e}"))?;
        Ok(())
    }
    .await;

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir).await;
    }
    result
}

async fn download_archive(
    app_handle: &AppHandle,
    archive: &ToolsArchive,
    destination: &Path,
) -> Result<(), String> {
    let client = Client::builder()
        .user_agent(format!("Compass+/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("Could not create the download client: {e}"))?;
    let response = client
        .get(&archive.url)
        .send()
        .await
        .map_err(|e| format!("Could not download MongoDB Database Tools: {e}"))?
        .error_for_status()
        .map_err(|e| format!("MongoDB Database Tools download returned an error: {e}"))?;
    let total = response.content_length();

    if total.is_some_and(|length| length > MAX_ARCHIVE_BYTES) {
        return Err("MongoDB Database Tools archive is unexpectedly large.".to_string());
    }

    let mut file = fs::File::create(destination)
        .await
        .map_err(|e| format!("Could not create {}: {e}", destination.display()))?;
    let mut downloaded = 0_u64;
    let mut last_reported = 0_u64;
    let mut stream = response.bytes_stream();

    emit_progress(
        app_handle,
        "downloading",
        "Downloading MongoDB Database Tools…",
        Some(0),
        total,
    );

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("MongoDB Database Tools download failed: {e}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_ARCHIVE_BYTES {
            return Err("MongoDB Database Tools archive is unexpectedly large.".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not save MongoDB Database Tools: {e}"))?;

        if downloaded.saturating_sub(last_reported) >= 512 * 1024 {
            last_reported = downloaded;
            emit_progress(
                app_handle,
                "downloading",
                "Downloading MongoDB Database Tools…",
                Some(downloaded),
                total,
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Could not finish saving MongoDB Database Tools: {e}"))?;
    file.sync_all()
        .await
        .map_err(|e| format!("Could not sync the MongoDB Database Tools archive: {e}"))?;
    emit_progress(
        app_handle,
        "downloading",
        "MongoDB Database Tools download complete.",
        Some(downloaded),
        total.or(Some(downloaded)),
    );
    Ok(())
}

async fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let path = path.to_path_buf();
    let expected = expected.to_ascii_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut file =
            File::open(&path).map_err(|e| format!("Could not open downloaded archive: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = io::Read::read(&mut file, &mut buffer)
                .map_err(|e| format!("Could not verify downloaded archive: {e}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let actual = format!("{:x}", hasher.finalize());
        if actual == expected {
            Ok(())
        } else {
            Err(format!(
                "MongoDB Database Tools checksum mismatch (expected {expected}, got {actual})."
            ))
        }
    })
    .await
    .map_err(|e| format!("Checksum verification task failed: {e}"))?
}

fn extract_tools(archive_path: &Path, archive_kind: &str, bin_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(bin_dir)
        .map_err(|e| format!("Could not create {}: {e}", bin_dir.display()))?;

    match archive_kind {
        "zip" => extract_zip_tools(archive_path, bin_dir)?,
        "tgz" => extract_tgz_tools(archive_path, bin_dir)?,
        _ => return Err(format!("Unsupported archive format: {archive_kind}")),
    }

    for tool in ["mongodump", "mongorestore"] {
        let path = bin_dir.join(executable_file_name(tool));
        if !path.is_file() {
            return Err(format!(
                "MongoDB Database Tools archive does not contain {}.",
                executable_file_name(tool)
            ));
        }
        make_executable(&path)?;
    }
    Ok(())
}

/// Copies one archive entry into `bin_dir`, refusing more than `limit` bytes
/// regardless of the size the archive declares.
fn write_tool(entry: impl io::Read, bin_dir: &Path, file_name: &str, limit: u64) -> Result<(), String> {
    let output_path = bin_dir.join(file_name);
    let mut output = File::create(&output_path)
        .map_err(|e| format!("Could not create {}: {e}", output_path.display()))?;
    let copied = io::copy(&mut io::Read::take(entry, limit + 1), &mut output)
        .map_err(|e| format!("Could not extract {file_name}: {e}"))?;
    if copied > limit {
        drop(output);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("{file_name} is unexpectedly large."));
    }
    Ok(())
}

fn extract_zip_tools(archive_path: &Path, bin_dir: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|e| format!("Could not open tools ZIP archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid tools ZIP archive: {e}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Could not read tools ZIP entry: {e}"))?;
        let entry_name = entry
            .name()
            .map_err(|e| format!("Invalid name in tools ZIP archive: {e}"))?
            .into_owned();
        let Some(file_name) = Path::new(&entry_name)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if !is_required_executable(&file_name) {
            continue;
        }
        if !entry.is_file() || entry.size() > MAX_BINARY_BYTES {
            return Err(format!("{file_name} in the tools archive is not a regular file of a sane size."));
        }
        write_tool(&mut entry, bin_dir, &file_name, MAX_BINARY_BYTES)?;
    }
    Ok(())
}

fn extract_tgz_tools(archive_path: &Path, bin_dir: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|e| format!("Could not open tools TGZ archive: {e}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|e| format!("Invalid tools TGZ archive: {e}"))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Could not read tools TGZ entry: {e}"))?;
        let entry_path = entry
            .path()
            .map_err(|e| format!("Invalid path in tools TGZ archive: {e}"))?;
        let Some(file_name) = entry_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let file_name = file_name.to_string();
        if !is_required_executable(&file_name) {
            continue;
        }
        if !entry.header().entry_type().is_file() || entry.header().size().unwrap_or(u64::MAX) > MAX_BINARY_BYTES {
            return Err(format!("{file_name} in the tools archive is not a regular file of a sane size."));
        }
        write_tool(&mut entry, bin_dir, &file_name, MAX_BINARY_BYTES)?;
    }
    Ok(())
}

async fn verify_executables(bin_dir: &Path) -> Result<(), String> {
    for tool in ["mongodump", "mongorestore"] {
        let path = bin_dir.join(executable_file_name(tool));
        let output = tokio::process::Command::new(&path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| format!("Could not start {}: {e}", path.display()))?;
        if !output.status.success() {
            return Err(format!(
                "{} failed its installation check with status {}.",
                path.display(),
                output.status
            ));
        }
    }
    Ok(())
}

async fn read_installed_tools(tools_root: &Path) -> Option<DatabaseToolsInfo> {
    let marker_bytes = fs::read(tools_root.join("current.json")).await.ok()?;
    let marker: InstalledToolsMarker = serde_json::from_slice(&marker_bytes).ok()?;
    if !is_safe_relative_component(&marker.install_dir) {
        return None;
    }

    let bin_dir = tools_root.join(&marker.install_dir).join("bin");
    if !tools_exist(&bin_dir).await {
        return None;
    }

    Some(DatabaseToolsInfo {
        version: marker.version,
        platform: marker.platform,
        arch: marker.arch,
        bin_dir: bin_dir.to_string_lossy().into_owned(),
        downloaded: false,
    })
}

async fn tools_exist(bin_dir: &Path) -> bool {
    let dump = bin_dir.join(executable_file_name("mongodump"));
    let restore = bin_dir.join(executable_file_name("mongorestore"));
    fs::metadata(dump)
        .await
        .is_ok_and(|metadata| metadata.is_file())
        && fs::metadata(restore)
            .await
            .is_ok_and(|metadata| metadata.is_file())
}

async fn write_current_marker(
    tools_root: &Path,
    marker: &InstalledToolsMarker,
) -> Result<(), String> {
    let marker_bytes = serde_json::to_vec_pretty(marker)
        .map_err(|e| format!("Could not serialize the tools installation marker: {e}"))?;
    let temporary = tools_root.join(format!("current.json.tmp-{}", std::process::id()));
    let current = tools_root.join("current.json");

    fs::write(&temporary, marker_bytes)
        .await
        .map_err(|e| format!("Could not write the tools installation marker: {e}"))?;
    if current.exists() {
        fs::remove_file(&current)
            .await
            .map_err(|e| format!("Could not replace the tools installation marker: {e}"))?;
    }
    fs::rename(&temporary, &current)
        .await
        .map_err(|e| format!("Could not activate the tools installation marker: {e}"))
}

fn platform_candidates() -> Result<Vec<(String, String)>, String> {
    platform_candidates_for(
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::fs::read_to_string("/etc/os-release").ok().as_deref(),
    )
}

fn platform_candidates_for(
    os: &str,
    arch: &str,
    os_release: Option<&str>,
) -> Result<Vec<(String, String)>, String> {
    match (os, arch) {
        ("macos", "aarch64") => Ok(vec![("macos".into(), "arm64".into())]),
        ("macos", "x86_64") => Ok(vec![("macos".into(), "x86_64".into())]),
        ("windows", "x86_64") => Ok(vec![("windows".into(), "x86_64".into())]),
        ("linux", "x86_64" | "aarch64") => {
            let values = parse_os_release(os_release.unwrap_or_default());
            let id = values.get("ID").map(String::as_str).unwrap_or_default();
            let version = values
                .get("VERSION_ID")
                .map(String::as_str)
                .unwrap_or_default();
            let id_like = values
                .get("ID_LIKE")
                .map(String::as_str)
                .unwrap_or_default();
            let names = linux_platform_names(id, version, id_like);
            Ok(names
                .into_iter()
                .map(|name| {
                    let metadata_arch = if arch == "x86_64" {
                        "x86_64"
                    } else if name.starts_with("ubuntu") {
                        "arm64"
                    } else {
                        "aarch64"
                    };
                    (name, metadata_arch.to_string())
                })
                .collect())
        }
        _ => Err(format!(
            "MongoDB Database Tools are not available for {os} {arch}."
        )),
    }
}

fn parse_os_release(contents: &str) -> HashMap<String, String> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            Some((key.trim().to_string(), value))
        })
        .collect()
}

fn linux_platform_names(id: &str, version: &str, id_like: &str) -> Vec<String> {
    let family = format!("{id} {id_like}").to_ascii_lowercase();
    let major = version
        .split('.')
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or_default();

    if id.eq_ignore_ascii_case("ubuntu") || family.contains("ubuntu") {
        if major >= 24 {
            return strings(&["ubuntu2404", "ubuntu2204", "ubuntu2004"]);
        }
        if major >= 22 {
            return strings(&["ubuntu2204", "ubuntu2004"]);
        }
        if major >= 20 {
            return strings(&["ubuntu2004", "ubuntu1804"]);
        }
        return strings(&["ubuntu1804", "ubuntu1604"]);
    }
    if id.eq_ignore_ascii_case("debian") || family.contains("debian") {
        if major >= 12 {
            return strings(&["debian12", "debian11", "debian10", "ubuntu2204"]);
        }
        if major >= 11 {
            return strings(&["debian11", "debian10", "ubuntu2004"]);
        }
        return strings(&["debian10", "ubuntu2004"]);
    }
    if matches!(id, "amzn" | "amazon") || family.contains("amazon") {
        if version.starts_with("2023") {
            return strings(&["amazon2023", "amazon2", "amazon"]);
        }
        return strings(&["amazon2", "amazon"]);
    }
    if family.contains("suse") || family.contains("sles") {
        if major >= 15 {
            return strings(&["suse15", "suse12"]);
        }
        return strings(&["suse12"]);
    }
    if ["rhel", "centos", "rocky", "almalinux", "fedora"]
        .iter()
        .any(|family_name| family.contains(family_name))
    {
        if major >= 10 {
            return strings(&["rhel10", "rhel93", "rhel88"]);
        }
        if major >= 9 {
            return strings(&["rhel93", "rhel88"]);
        }
        if major >= 8 {
            return strings(&["rhel88", "rhel70"]);
        }
        return strings(&["rhel70"]);
    }

    strings(&["ubuntu2204", "debian12", "rhel88"])
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn version_key(version: &str) -> Option<Vec<u64>> {
    version
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

fn safe_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn is_safe_relative_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn executable_file_name(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

fn is_required_executable(file_name: &str) -> bool {
    file_name == executable_file_name("mongodump")
        || file_name == executable_file_name("mongorestore")
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path)
        .map_err(|e| format!("Could not read permissions for {}: {e}", path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions)
        .map_err(|e| format!("Could not make {} executable: {e}", path.display()))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn emit_progress(
    app_handle: &AppHandle,
    phase: &str,
    message: impl Into<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
) {
    let _ = app_handle.emit(
        PROGRESS_EVENT,
        DatabaseToolsProgress {
            phase: phase.to_string(),
            message: message.into(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn selects_highest_version_for_macos_arm() {
        let catalog: ReleaseCatalog = serde_json::from_str(
            r#"{
                "versions": [
                    {
                        "version": "100.9.0",
                        "downloads": []
                    },
                    {
                        "version": "100.17.0",
                        "downloads": [{
                            "name": "macos",
                            "arch": "arm64",
                            "archive": {
                                "url": "https://fastdl.mongodb.org/tools/db/tools.zip",
                                "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                            }
                        }]
                    }
                ]
            }"#,
        )
        .unwrap();

        let selected =
            select_latest_download_for(&catalog, &[("macos".to_string(), "arm64".to_string())])
                .unwrap();
        assert_eq!(selected.version, "100.17.0");
        assert_eq!(selected.platform, "macos");
    }

    #[test]
    fn maps_supported_desktop_platforms() {
        assert_eq!(
            platform_candidates_for("macos", "aarch64", None).unwrap(),
            vec![("macos".to_string(), "arm64".to_string())]
        );
        assert_eq!(
            platform_candidates_for("windows", "x86_64", None).unwrap(),
            vec![("windows".to_string(), "x86_64".to_string())]
        );
    }

    #[test]
    fn maps_ubuntu_and_debian_versions() {
        let ubuntu =
            platform_candidates_for("linux", "x86_64", Some("ID=ubuntu\nVERSION_ID=\"24.04\"\n"))
                .unwrap();
        assert_eq!(ubuntu[0], ("ubuntu2404".into(), "x86_64".into()));

        let debian =
            platform_candidates_for("linux", "x86_64", Some("ID=debian\nVERSION_ID=\"12\"\n"))
                .unwrap();
        assert_eq!(debian[0], ("debian12".into(), "x86_64".into()));
    }

    #[test]
    fn maps_linux_arm_arch_names_per_distribution() {
        let ubuntu = platform_candidates_for(
            "linux",
            "aarch64",
            Some("ID=ubuntu\nVERSION_ID=\"22.04\"\n"),
        )
        .unwrap();
        assert_eq!(ubuntu[0], ("ubuntu2204".into(), "arm64".into()));

        let rhel = platform_candidates_for(
            "linux",
            "aarch64",
            Some("ID=rocky\nID_LIKE=\"rhel centos fedora\"\nVERSION_ID=\"9.3\"\n"),
        )
        .unwrap();
        assert_eq!(rhel[0], ("rhel93".into(), "aarch64".into()));
    }

    #[test]
    fn rejects_unsupported_architecture() {
        let error = platform_candidates_for("windows", "aarch64", None).unwrap_err();
        assert!(error.contains("not available"));
    }

    #[test]
    fn validates_marker_directory_component() {
        assert!(is_safe_relative_component("100.17.0-macos-arm64"));
        assert!(!is_safe_relative_component("../other"));
        assert!(!is_safe_relative_component("nested/path"));
    }

    #[test]
    fn extraction_stops_at_the_size_limit_whatever_the_archive_declares() {
        let dir = std::env::temp_dir().join(format!("compass-write-tool-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_tool(&b"12345678"[..], &dir, "ok", 8).unwrap();
        assert_eq!(std::fs::read(dir.join("ok")).unwrap(), b"12345678");
        let err = write_tool(&b"123456789"[..], &dir, "big", 8).unwrap_err();
        assert!(err.contains("unexpectedly large"), "{err}");
        assert!(!dir.join("big").exists(), "a truncated binary must not be left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extracts_only_required_tools_from_zip_and_tgz() {
        let root = std::env::temp_dir().join(format!(
            "compass-plus-tools-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();

        let dump_name = executable_file_name("mongodump");
        let restore_name = executable_file_name("mongorestore");
        let zip_path = root.join("tools.zip");
        let zip_bin = root.join("zip-bin");
        let zip_file = File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file(format!("release/bin/{dump_name}"), options)
            .unwrap();
        zip.write_all(b"dump").unwrap();
        zip.start_file(format!("release/bin/{restore_name}"), options)
            .unwrap();
        zip.write_all(b"restore").unwrap();
        zip.start_file("release/bin/mongoexport", options).unwrap();
        zip.write_all(b"not-needed").unwrap();
        zip.finish().unwrap();

        extract_tools(&zip_path, "zip", &zip_bin).unwrap();
        assert_eq!(std::fs::read(zip_bin.join(&dump_name)).unwrap(), b"dump");
        assert_eq!(
            std::fs::read(zip_bin.join(&restore_name)).unwrap(),
            b"restore"
        );
        assert!(!zip_bin.join("mongoexport").exists());

        let tgz_path = root.join("tools.tgz");
        let tgz_bin = root.join("tgz-bin");
        let tgz_file = File::create(&tgz_path).unwrap();
        let encoder = flate2::write::GzEncoder::new(tgz_file, flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        for (name, contents) in [
            (&dump_name, b"dump".as_slice()),
            (&restore_name, b"restore"),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, format!("release/bin/{name}"), contents)
                .unwrap();
        }
        tar.finish().unwrap();
        tar.into_inner().unwrap().finish().unwrap();

        extract_tools(&tgz_path, "tgz", &tgz_bin).unwrap();
        assert_eq!(std::fs::read(tgz_bin.join(&dump_name)).unwrap(), b"dump");
        assert_eq!(
            std::fs::read(tgz_bin.join(&restore_name)).unwrap(),
            b"restore"
        );

        std::fs::remove_dir_all(root).unwrap();
    }
}
