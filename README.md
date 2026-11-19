# Compass+

A fast, native desktop GUI for MongoDB, built with Tauri 2, Rust and React. It is a smaller alternative to MongoDB Compass.

What you can do with it:

- browse databases and collections;
- query with filter, sort and projection;
- edit documents without losing BSON types;
- build aggregation pipelines with autocomplete;
- analyze schemas and author validation rules;
- inspect explain plans, live metrics and current operations;
- import and export data, and dump/restore;
- use a built-in mongosh.

## Install

Download the latest build from [Releases](https://github.com/NazarKalytiuk/mongo-compass-tauri/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple Silicon and Intel) | `…_universal.dmg` |
| Windows | `…_x64-setup.exe` (or `.msi`) |
| Linux | `…_amd64.AppImage` (or `.deb` / `.rpm`) |

macOS builds are not notarized yet, so macOS blocks the first launch. To allow it once, choose either way:

- Open **System Settings → Privacy & Security** and click **Open Anyway**.
- Or clear the quarantine flag: `xattr -dr com.apple.quarantine /Applications/mongo-compass-tauri.app`.

### Updates

Compass+ checks for new versions on launch and every 6 hours. You can also click **Check for updates** on the connection screen.

Each update is verified against a signing key built into the app before it is installed. The app never restarts on its own: you choose when.

In-app updates work for the macOS app, the Windows installer (`-setup.exe`) and the Linux AppImage. Install `.msi`, `.deb` and `.rpm` packages manually.

### Saved connections

Saved connections keep their passwords in the system credential store (macOS Keychain, Windows Credential Manager or Secret Service on Linux), never in app storage. After an update, macOS may ask once to let Compass+ read a saved password.

## Managed MongoDB Database Tools

Opening **Dump / Restore** makes Compass+ check MongoDB's official Database Tools release catalog. The app:

1. downloads the latest archive for the current operating system and CPU architecture;
2. verifies its SHA-256 checksum;
3. installs `mongodump` and `mongorestore` under the platform-specific application data directory.

A valid installed version stays available when an update check cannot reach MongoDB. Dump and restore need neither MongoDB Server, nor Homebrew, nor a system-wide install of the Database Tools.

## Development

Requirements:

- Node 24;
- stable Rust;
- the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm ci
npm run tauri dev        # run the app
npm run build            # type-check + production frontend build
npm run test:unit        # Vitest
npm run test:e2e         # Playwright against a mocked backend
cd src-tauri && cargo test
```

The Rust integration tests run against a real MongoDB. They are skipped unless `COMPASS_IT_URI` is set. See `AGENTS.md` for details and project conventions.

## Releasing

The version lives in `src-tauri/Cargo.toml` only, and release notes live in `CHANGELOG.md`.

1. While you work, add user-facing changes under `## Unreleased` in `CHANGELOG.md`.
2. Cut and publish the release:

   ```sh
   npm run release -- 0.3.0              # checks main is clean and in sync, bumps the version,
                                         # moves the notes under 0.3.0, commits and tags v0.3.0
   git push --atomic origin main v0.3.0
   ```

The tag triggers `.github/workflows/release.yml`:

1. It runs the full CI, including the MongoDB integration tests.
2. It builds macOS (universal), Linux and Windows installers into a draft release. The updater artifacts are signed with minisign.
3. It checks each updater artifact's signature against the public key in `tauri.conf.json`.
4. It writes `latest.json` with public download URLs, publishes the release, then re-checks the feed the way installed apps read it.

A tag like `v0.3.0-beta.1` is published as a pre-release. The updater never offers pre-releases.

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Sign updater artifacts. **Back them up.** If the key is lost, installed apps can never update again. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Optional. Developer ID signing and notarization. macOS builds are ad-hoc signed until all six are set. |
