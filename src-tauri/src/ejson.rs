//! Wire format for MongoDB documents between the backend and the webview.
//!
//! Documents travel as MongoDB Extended JSON v2. The webview parses them with
//! `JSON.parse` and sends them back after `JSON.stringify`, so every value must
//! survive a trip through JavaScript numbers (IEEE-754 doubles):
//!
//! - `Int32` → plain number. JavaScript holds it exactly, and the parser turns an
//!   integer in the int32 range back into `Int32`.
//! - `Int64` → `{"$numberLong": "…"}`. A plain number would lose precision above
//!   2^53 and would come back as `Int32` when small.
//! - `Double` → plain number when it has a fractional part. Integral or
//!   non-finite values use `{"$numberDouble": "…"}`, because `JSON.stringify(3.0)`
//!   is `"3"`, which would come back as `Int32`.
//! - Every other type uses relaxed Extended JSON (`$oid`, `$date`, `$binary`, …).
//!
//! Input is parsed with the Extended JSON parser of the `bson` crate. It accepts
//! both canonical and relaxed forms and leaves query operators (`$gt`, `$type`, …)
//! untouched.

use mongodb::bson::{Bson, Document};
use serde_json::{json, Map, Value};

/// Converts a BSON value to its wire JSON.
pub fn to_wire(value: Bson) -> Value {
    match value {
        Bson::Int64(n) => json!({ "$numberLong": n.to_string() }),
        Bson::Double(f) if !f.is_finite() || f.fract() == 0.0 => {
            // Canonical Extended JSON spelling of a double.
            let text = if f.is_nan() {
                "NaN".to_string()
            } else if f.is_infinite() {
                if f > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
            } else {
                // Shortest exact form with a fraction or exponent: "3.0", "-0.0", "1e300".
                format!("{f:?}")
            };
            json!({ "$numberDouble": text })
        }
        Bson::Document(doc) => document_to_wire(doc),
        Bson::Array(items) => Value::Array(items.into_iter().map(to_wire).collect()),
        other => other.into_relaxed_extjson(),
    }
}

/// Converts a document to its wire JSON object.
pub fn document_to_wire(doc: Document) -> Value {
    let mut map = Map::with_capacity(doc.len());
    for (key, value) in doc {
        map.insert(key, to_wire(value));
    }
    Value::Object(map)
}

/// Parses a wire JSON value (Extended JSON, canonical or relaxed) into BSON.
pub fn from_wire(value: Value) -> Result<Bson, String> {
    Bson::try_from(value).map_err(|e| format!("Invalid Extended JSON: {e}"))
}

/// Parses wire JSON text into a BSON value.
pub fn parse_value(text: &str) -> Result<Bson, String> {
    let value: Value = serde_json::from_str(text.trim()).map_err(|e| format!("Invalid JSON syntax: {e}"))?;
    from_wire(value)
}

/// Parses wire JSON text that must be an object. Empty text is an empty document,
/// as used for optional filters, sorts and projections.
pub fn parse_document(text: &str) -> Result<Document, String> {
    if text.trim().is_empty() {
        return Ok(Document::new());
    }
    match parse_value(text)? {
        Bson::Document(doc) => Ok(doc),
        _ => Err("Expected a JSON object".to_string()),
    }
}

/// Converts an already-parsed wire value that must be an object.
pub fn value_to_document(value: Value) -> Result<Document, String> {
    match from_wire(value)? {
        Bson::Document(doc) => Ok(doc),
        _ => Err("Expected a JSON object".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{
        doc, oid::ObjectId, spec::BinarySubtype, Binary, DateTime, Decimal128, Regex, Timestamp,
    };

    /// Simulates the webview: `JSON.parse` turns every number into an f64, and
    /// `JSON.stringify` prints integral values without a fraction.
    fn through_javascript(value: &Value) -> String {
        fn normalize(v: &Value) -> Value {
            match v {
                Value::Number(n) => {
                    let f = n.as_f64().unwrap();
                    if f.fract() == 0.0 && f.abs() < 1e21 {
                        json!(f as i64)
                    } else {
                        json!(f)
                    }
                }
                Value::Array(a) => Value::Array(a.iter().map(normalize).collect()),
                Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), normalize(v))).collect()),
                other => other.clone(),
            }
        }
        serde_json::to_string(&normalize(value)).unwrap()
    }

    fn every_type() -> Document {
        doc! {
            "_id": ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap(),
            "int32": 5i32,
            "int32_min": i32::MIN,
            "int64_small": 5i64,
            "int64_big": 9_007_199_254_740_993i64,
            "double_integral": 3.0f64,
            "double_fraction": 2.5f64,
            "double_negative_zero": -0.0f64,
            "double_nan": f64::NAN,
            "double_inf": f64::NEG_INFINITY,
            "double_huge": 1e300f64,
            "decimal": Decimal128::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x30]),
            "date": DateTime::from_millis(1_700_000_000_123),
            "date_before_epoch": DateTime::from_millis(-86_400_000),
            "binary": Binary { subtype: BinarySubtype::Generic, bytes: vec![1, 2, 3] },
            "uuid": Binary { subtype: BinarySubtype::Uuid, bytes: vec![7; 16] },
            "timestamp": Timestamp { time: 1, increment: 2 },
            "regex": Regex { pattern: "^a".into(), options: "i".into() },
            "string": "hello",
            "bool": true,
            "null": Bson::Null,
            "nested": { "n": 7i32, "list": [1i32, 2i64, 1.0f64, { "deep": 4i64 }] },
        }
    }

    #[test]
    fn every_type_survives_a_round_trip_through_javascript() {
        let original = every_type();
        let text = through_javascript(&document_to_wire(original.clone()));
        let back = parse_document(&text).unwrap();
        assert_eq!(back.len(), original.len());
        for (key, value) in &original {
            let got = back.get(key).unwrap();
            assert_eq!(got.element_type(), value.element_type(), "type of {key}");
            match (value, got) {
                (Bson::Double(a), Bson::Double(b)) if a.is_nan() => assert!(b.is_nan(), "{key}"),
                (Bson::Double(a), Bson::Double(b)) => assert_eq!(a.to_bits(), b.to_bits(), "{key}"),
                _ => assert_eq!(got, value, "value of {key}"),
            }
        }
    }

    #[test]
    fn wire_form_is_readable_where_it_is_safe() {
        let wire = document_to_wire(every_type());
        assert_eq!(wire["int32"], json!(5));
        assert_eq!(wire["int64_small"], json!({ "$numberLong": "5" }));
        assert_eq!(wire["double_integral"], json!({ "$numberDouble": "3.0" }));
        assert_eq!(wire["double_fraction"], json!(2.5));
        assert_eq!(wire["double_negative_zero"], json!({ "$numberDouble": "-0.0" }));
        assert_eq!(wire["double_huge"], json!({ "$numberDouble": "1e300" }));
        assert_eq!(wire["date"], json!({ "$date": "2023-11-14T22:13:20.123Z" }));
        assert_eq!(wire["_id"], json!({ "$oid": "65a1b2c3d4e5f60718293a4b" }));
        assert_eq!(wire["binary"], json!({ "$binary": { "base64": "AQID", "subType": "00" } }));
        assert_eq!(wire["nested"]["list"][1], json!({ "$numberLong": "2" }));
    }

    #[test]
    fn typed_input_keeps_its_type() {
        let doc = parse_document(
            r#"{"a": 5, "b": 3000000000, "c": 2.5, "d": {"$numberLong": "5"}, "e": {"$numberDouble": "3"},
                "f": {"$date": "2023-11-14T22:13:20.123Z"}, "g": {"$numberDecimal": "1.10"}}"#,
        )
        .unwrap();
        assert_eq!(doc.get("a"), Some(&Bson::Int32(5)));
        assert_eq!(doc.get("b"), Some(&Bson::Int64(3_000_000_000)));
        assert_eq!(doc.get("c"), Some(&Bson::Double(2.5)));
        assert_eq!(doc.get("d"), Some(&Bson::Int64(5)));
        assert_eq!(doc.get("e"), Some(&Bson::Double(3.0)));
        assert!(matches!(doc.get("f"), Some(Bson::DateTime(_))));
        assert_eq!(doc.get("g").unwrap().to_string(), "1.10");
    }

    #[test]
    fn query_operators_are_not_mistaken_for_extended_json() {
        let doc = parse_document(
            r#"{"age": {"$gt": 5, "$lte": {"$numberLong": "10"}}, "t": {"$type": "string"},
                "n": {"$regex": "^a", "$options": "i"}, "$or": [{"a": 1}], "$expr": {"$gt": ["$a", "$b"]}}"#,
        )
        .unwrap();
        assert_eq!(doc.get_document("age").unwrap(), &doc! { "$gt": 5, "$lte": 10i64 });
        assert_eq!(doc.get_document("t").unwrap(), &doc! { "$type": "string" });
        assert_eq!(doc.get_document("n").unwrap(), &doc! { "$regex": "^a", "$options": "i" });
    }

    #[test]
    fn malformed_input_is_reported() {
        assert!(parse_document(r#"{"a": {"$numberLong": 5}}"#).unwrap_err().contains("Extended JSON"));
        assert!(parse_document(r#"{"a": "#).unwrap_err().contains("JSON syntax"));
        assert!(parse_document("[1]").unwrap_err().contains("object"));
        assert_eq!(parse_document("  ").unwrap(), Document::new());
    }
}
