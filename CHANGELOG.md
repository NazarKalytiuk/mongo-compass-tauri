# Changelog

Notable changes to Compass+. Versions follow [Semantic Versioning](https://semver.org/).
Each release section becomes the GitHub Release notes and the "What’s new" text in the in-app updater.

## Unreleased

- **Editing no longer corrupts documents.** Saving used to:
  - turn Int32 into Int64;
  - round Int64 values above 2^53;
  - turn integral doubles into integers;
  - turn Binary into an array of numbers;
  - keep fields you had deleted.

  Documents now keep every BSON type, and saving replaces the whole document.
- The field editor has Int32, Int64, Double and Decimal128 types, keeps every digit, and blocks values that do not fit their type.
- Schema validation tells int, long, double and decimal apart. CSV export writes numbers as digits.
- Saved connection passwords move from app storage to the system keychain (Keychain / Credential Manager / Secret Service). Existing connections are migrated automatically.
- Passwords no longer appear:
  - in the connection header;
  - in mongodump/mongorestore/mongosh command lines;
  - in dry-run output.
- A strict Content Security Policy is now in place.
- Dependencies are updated, which closes 46 Rust and 11 npm security advisories.
- Extracting the database tools is safer.
- **In-app updates:** Compass+ checks for new versions on launch and every 6 hours, verifies each download with a signing key and installs it when you click Update. It restarts only when you choose.
- **One macOS download** runs natively on both Apple Silicon and Intel.
