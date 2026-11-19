//! Connection passwords.
//!
//! Passwords never live in the webview's storage. A saved connection keeps its URI
//! without the password in localStorage, and the password itself is kept in the OS
//! credential store (macOS Keychain, Windows Credential Manager, Secret Service on
//! Linux), keyed by the connection's id. The full URI exists only in the backend.

/// Credential-store service under which connection passwords are filed.
const SERVICE: &str = "com.nazarkalituk.mongo-compass-tauri.connections";

/// The parts of a connection string around its password. The password is kept
/// percent-encoded, exactly as it appears in the URI.
struct Parts<'a> {
    /// Everything before the password, ending with `user:` (or `user` if none).
    head: &'a str,
    password: Option<&'a str>,
    /// `@hosts/...`
    tail: &'a str,
}

fn parts(uri: &str) -> Option<Parts<'_>> {
    let scheme_end = ["mongodb://", "mongodb+srv://"].iter().find_map(|s| uri.starts_with(s).then_some(s.len()))?;
    let rest = &uri[scheme_end..];
    // The spec requires '/', '?' and '@' in credentials to be percent-encoded, so the
    // authority ends at the first '/' or '?', and the credentials at its last '@'.
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let at = rest[..authority_end].rfind('@')?;
    let userinfo = &rest[..at];
    let (user_end, password) = match userinfo.find(':') {
        Some(colon) => (colon + 1, Some(&userinfo[colon + 1..])),
        None => (userinfo.len(), None),
    };
    Some(Parts {
        head: &uri[..scheme_end + user_end],
        password,
        tail: &uri[scheme_end + at..],
    })
}

/// Splits a connection string into the URI without its password and the password.
pub fn split_password(uri: &str) -> (String, Option<String>) {
    match parts(uri) {
        Some(Parts { head, password: Some(password), tail }) => {
            (format!("{}{}", head.trim_end_matches(':'), tail), Some(password.to_string()))
        }
        _ => (uri.to_string(), None),
    }
}

/// Puts a (percent-encoded) password into a URI that has a username but no password.
/// URIs without a username, or that already carry a password, are returned unchanged.
pub fn with_password(uri: &str, password: &str) -> String {
    match parts(uri) {
        Some(Parts { head, password: None, tail }) => format!("{head}:{password}{tail}"),
        _ => uri.to_string(),
    }
}

/// The URI with its password masked, for display.
pub fn redact(uri: &str) -> String {
    match parts(uri) {
        Some(Parts { head, password: Some(_), tail }) => format!("{head}****{tail}"),
        _ => uri.to_string(),
    }
}

fn entry(connection_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, connection_id).map_err(|e| format!("Credential store unavailable: {e}"))
}

pub fn store(connection_id: &str, password: &str) -> Result<(), String> {
    entry(connection_id)?
        .set_password(password)
        .map_err(|e| format!("Could not save the password to the credential store: {e}"))
}

pub fn load(connection_id: &str) -> Result<Option<String>, String> {
    match entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the password from the credential store: {e}")),
    }
}

pub fn delete(connection_id: &str) -> Result<(), String> {
    match entry(connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the password from the credential store: {e}")),
    }
}

/// The URI to connect with: when it comes from a saved connection and carries no
/// password, the stored password is filled in.
pub fn resolve(uri: &str, connection_id: Option<&str>) -> Result<String, String> {
    let Some(id) = connection_id else { return Ok(uri.to_string()) };
    if split_password(uri).1.is_some() {
        return Ok(uri.to_string());
    }
    Ok(match load(id)? {
        Some(password) => with_password(uri, &password),
        None => uri.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_and_restores_passwords() {
        let cases = [
            ("mongodb://alice:s3cret@db.example:27017/app?authSource=admin", "mongodb://alice@db.example:27017/app?authSource=admin", Some("s3cret")),
            ("mongodb+srv://bob:p%40ss%2Fw%3Ard@cluster0.mongodb.net/?retryWrites=true", "mongodb+srv://bob@cluster0.mongodb.net/?retryWrites=true", Some("p%40ss%2Fw%3Ard")),
            ("mongodb://a:b@h1:1,h2:2/?replicaSet=rs", "mongodb://a@h1:1,h2:2/?replicaSet=rs", Some("b")),
            ("mongodb://carol:@host", "mongodb://carol@host", Some("")),
            ("mongodb://dave@host/db", "mongodb://dave@host/db", None),
            ("mongodb://localhost:27017", "mongodb://localhost:27017", None),
            ("mongodb://host/db?authMechanism=MONGODB-X509&tlsCertificateKeyFile=/a@b.pem", "mongodb://host/db?authMechanism=MONGODB-X509&tlsCertificateKeyFile=/a@b.pem", None),
            ("not a uri", "not a uri", None),
        ];
        for (uri, stripped, password) in cases {
            let (got, got_password) = split_password(uri);
            assert_eq!(got, stripped, "{uri}");
            assert_eq!(got_password.as_deref(), password, "{uri}");
            if let Some(p) = password {
                assert_eq!(with_password(&got, p), uri, "{uri}");
            }
        }
    }

    #[test]
    fn with_password_never_overwrites_or_invents_credentials() {
        assert_eq!(with_password("mongodb://a:old@h", "new"), "mongodb://a:old@h");
        assert_eq!(with_password("mongodb://h/db", "new"), "mongodb://h/db");
    }

    #[test]
    fn redacts_only_the_password() {
        assert_eq!(redact("mongodb://alice:s3cret@db:27017/app"), "mongodb://alice:****@db:27017/app");
        assert_eq!(redact("mongodb+srv://bob@cluster0.net/"), "mongodb+srv://bob@cluster0.net/");
        assert_eq!(redact("mongodb://localhost"), "mongodb://localhost");
    }

    #[test]
    fn resolve_without_a_saved_connection_is_identity() {
        assert_eq!(resolve("mongodb://a@h", None).unwrap(), "mongodb://a@h");
        // A password typed into the URI wins over the stored one, without touching the store.
        assert_eq!(resolve("mongodb://a:typed@h", Some("any")).unwrap(), "mongodb://a:typed@h");
    }
}
