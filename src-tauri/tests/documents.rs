//! Document editing against a real MongoDB server.
//!
//! Runs only when `COMPASS_IT_URI` is set, e.g.
//!   docker run -d --name compass-it-mongo -p 127.0.0.1:27099:27017 mongo:8.0
//!   COMPASS_IT_URI=mongodb://127.0.0.1:27099 cargo test --test documents
//! Each test works in its own `compass_it_*` database and drops it afterwards.

use mongo_compass_tauri_lib::{ejson, mongo};
use mongodb::bson::{
    doc, oid::ObjectId, spec::BinarySubtype, Binary, Bson, DateTime, Decimal128, Document,
};
use mongodb::Client;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

struct TestDb {
    state: mongo::AppState,
    client: Client,
    name: String,
}

impl TestDb {
    async fn new() -> Option<Self> {
        let uri = std::env::var("COMPASS_IT_URI").ok()?;
        let state = mongo::AppState::new();
        mongo::connect(&state, uri.clone()).await.expect("connect");
        let client = Client::with_uri_str(&uri).await.unwrap();
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        Some(Self { state, client, name: format!("compass_it_{nanos}") })
    }

    fn coll(&self) -> mongodb::Collection<Document> {
        self.client.database(&self.name).collection("docs")
    }

    async fn find(&self, filter: &str) -> Vec<Value> {
        mongo::find_documents(&self.state, self.name.clone(), "docs".into(), filter.into(), String::new(), String::new(), 0, 0)
            .await
            .expect("find")
            .documents
    }

    async fn drop(self) {
        self.client.database(&self.name).drop().await.unwrap();
    }
}

/// What the webview sends back: `JSON.parse` + `JSON.stringify`, which turns every
/// number into a double and prints integral ones without a fraction.
fn through_javascript(value: &Value) -> Value {
    match value {
        Value::Number(n) => {
            let f = n.as_f64().unwrap();
            if f.fract() == 0.0 && f.abs() < 1e21 { json!(f as i64) } else { json!(f) }
        }
        Value::Array(a) => Value::Array(a.iter().map(through_javascript).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), through_javascript(v))).collect()),
        other => other.clone(),
    }
}

fn typed_document(id: ObjectId) -> Document {
    doc! {
        "_id": id,
        "count": 5i32,
        "views": 9_007_199_254_740_993i64,
        "ratio": 3.0f64,
        "score": 2.5f64,
        "price": Decimal128::from_bytes([0x7b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x3c, 0x30]),
        "created": DateTime::from_millis(1_700_000_000_123),
        "blob": Binary { subtype: BinarySubtype::Generic, bytes: vec![1, 2, 3] },
        "nested": { "n": 7i32, "list": [1i32, 2i64, 1.0f64] },
        "obsolete": "remove me",
    }
}

#[tokio::test]
async fn editing_a_document_keeps_types_and_removes_deleted_fields() {
    let Some(db) = TestDb::new().await else { return };
    let id = ObjectId::new();
    let original = typed_document(id);
    db.coll().insert_one(original.clone()).await.unwrap();

    // Load it the way the explorer does, edit it the way the editor does, save.
    let loaded = db.find("{}").await.remove(0);
    let mut edited = through_javascript(&loaded);
    let fields = edited.as_object_mut().unwrap();
    fields.remove("obsolete");
    fields.insert("score".into(), json!(4.75));
    let id_json = through_javascript(&loaded["_id"]).to_string();
    mongo::replace_document(&db.state, db.name.clone(), "docs".into(), id_json, edited.to_string())
        .await
        .expect("replace");

    let stored = db.coll().find_one(doc! { "_id": id }).await.unwrap().unwrap();
    let mut expected = original.clone();
    expected.remove("obsolete");
    expected.insert("score", 4.75f64);
    assert_eq!(stored, expected);
    for key in ["count", "views", "ratio", "price", "created", "blob", "nested"] {
        assert_eq!(stored.get(key).unwrap().element_type(), original.get(key).unwrap().element_type(), "{key}");
    }
    db.drop().await;
}

#[tokio::test]
async fn replace_reports_missing_documents_and_refuses_id_changes() {
    let Some(db) = TestDb::new().await else { return };
    let id = ObjectId::new();
    db.coll().insert_one(doc! { "_id": id, "a": 1 }).await.unwrap();
    let id_json = ejson::to_wire(Bson::ObjectId(id)).to_string();

    let other = ejson::to_wire(Bson::ObjectId(ObjectId::new()));
    let err = mongo::replace_document(&db.state, db.name.clone(), "docs".into(), id_json.clone(), json!({ "_id": other, "a": 2 }).to_string())
        .await
        .unwrap_err();
    assert!(err.contains("_id cannot be changed"), "{err}");

    db.coll().delete_one(doc! { "_id": id }).await.unwrap();
    let err = mongo::replace_document(&db.state, db.name.clone(), "docs".into(), id_json.clone(), json!({ "a": 2 }).to_string())
        .await
        .unwrap_err();
    assert!(err.contains("no longer exists"), "{err}");
    let err = mongo::delete_document(&db.state, db.name.clone(), "docs".into(), id_json).await.unwrap_err();
    assert!(err.contains("no longer exists"), "{err}");
    db.drop().await;
}

#[tokio::test]
async fn inserts_and_filters_use_extended_json_types() {
    let Some(db) = TestDb::new().await else { return };
    let doc = json!({ "n": 1, "big": { "$numberLong": "9007199254740993" }, "d": { "$numberDouble": "2.0" }, "at": { "$date": "2024-01-02T03:04:05Z" } });
    mongo::insert_document(&db.state, db.name.clone(), "docs".into(), doc.to_string()).await.expect("insert");
    mongo::insert_many(&db.state, db.name.clone(), "docs".into(), vec![json!({ "n": 2, "big": { "$numberLong": "1" } })])
        .await
        .expect("insert_many");

    let stored = db.coll().find_one(doc! { "n": 1 }).await.unwrap().unwrap();
    assert_eq!(stored.get("n"), Some(&Bson::Int32(1)));
    assert_eq!(stored.get("big"), Some(&Bson::Int64(9_007_199_254_740_993)));
    assert_eq!(stored.get("d"), Some(&Bson::Double(2.0)));
    assert!(matches!(stored.get("at"), Some(Bson::DateTime(_))));

    // An exact 64-bit match only works when the filter keeps full precision.
    let hits = db.find(r#"{"big": {"$numberLong": "9007199254740993"}}"#).await;
    assert_eq!(hits.len(), 1);
    let hits = db.find(r#"{"at": {"$gte": {"$date": "2024-01-01T00:00:00Z"}}}"#).await;
    assert_eq!(hits.len(), 1);
    let hits = db.find(r#"{"big": {"$type": "long"}, "n": {"$in": [1, 2]}}"#).await;
    assert_eq!(hits.len(), 2);
    db.drop().await;
}

/// Saved-connection passwords go through the OS credential store. Touches the real
/// store, so it runs only with COMPASS_IT_KEYCHAIN=1 and COMPASS_IT_AUTH_URI set to a
/// server with authentication (mongodb://user:pass@host/?authSource=admin).
#[tokio::test]
async fn saved_connection_password_round_trips_through_the_credential_store() {
    if std::env::var("COMPASS_IT_KEYCHAIN").as_deref() != Ok("1") {
        return;
    }
    let Ok(uri) = std::env::var("COMPASS_IT_AUTH_URI") else { return };
    use mongo_compass_tauri_lib::secrets;
    /// Removes the test entry from the credential store however the test ends.
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = secrets::delete(&self.0);
        }
    }
    let id = format!("compass-it-{}", std::process::id());
    let _cleanup = Cleanup(id.clone());

    let (stripped, password) = secrets::split_password(&uri);
    let password = password.expect("COMPASS_IT_AUTH_URI must contain a password");
    secrets::store(&id, &password).unwrap();
    let state = mongo::AppState::new();
    // Without the stored password the server rejects the login...
    assert!(mongo::connect(&state, stripped.clone()).await.is_err());
    // ...with it filled in from the store, it connects, and the UI only sees a masked URI.
    let info = mongo::connect(&state, secrets::resolve(&stripped, Some(&id)).unwrap()).await.expect("connect");
    assert!(!info.display_uri.contains(&password), "{}", info.display_uri);
    assert!(info.display_uri.contains(":****@"), "{}", info.display_uri);

    secrets::delete(&id).unwrap();
    assert_eq!(secrets::load(&id).unwrap(), None);
    assert_eq!(secrets::resolve(&stripped, Some(&id)).unwrap(), stripped);
}
