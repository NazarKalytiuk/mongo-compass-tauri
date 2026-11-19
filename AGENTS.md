# Repository Guidelines

Repository guidelines for AI coding assistants working on the `mongo-compass-tauri` codebase.

## Project Overview

`mongo-compass-tauri` (product name **"Compass+"**) is a cross-platform desktop GUI for MongoDB, built with Tauri v2. A React 19 + TypeScript frontend runs inside a native window; a Rust backend wraps the official `mongodb` 3.1 driver. It replaces the Electron-based MongoDB Compass with a smaller, native binary.

Feature surface: connect via URI, browse databases/collections, run find queries with filter/sort/projection/limit/skip, view documents in tree/table/JSON, CRUD documents, build multi-stage aggregation pipelines, manage connection presets.

## Architecture & Data Flow

```
React (src/)  ──invoke()──▶  Tauri IPC  ──▶  Rust command (src-tauri/src/lib.rs)
   ▲                                                       │
   │                                                       ▼
   └──────────── serde_json::Value ◀── BSON ──▶  mongodb::Client (mongo.rs)
```

- **Frontend → backend**: only via `invoke<T>("command_name", args)`. No event bus, no websockets, no custom IPC. All commands are async on the Rust side.
- **Backend state**: one `mongodb::Client` held in `Arc<tokio::sync::Mutex<Option<Client>>>` inside `AppState` (`src-tauri/src/mongo.rs`). Disconnect resets the `Option` to `None`.
- **BSON bridge** (`src-tauri/src/ejson.rs`): documents travel as MongoDB Extended JSON v2, shaped to survive `JSON.parse`/`JSON.stringify` in the webview.
  - Int32 and fractional doubles are plain numbers.
  - Int64 is `{"$numberLong"}` and integral or non-finite doubles are `{"$numberDouble"}`. As plain numbers they would lose precision or change type.
  - Everything else is relaxed EJSON (`$oid`, `$date`, `$binary`, …).
  - Input is parsed with `ejson::parse_document` / `parse_value`, the `bson` crate's EJSON parser. Never use `bson::to_bson(&serde_json::Value)` or `serde_json::to_value(&Document)` for user data: both silently change types.
  - Frontend helpers `numberKind` / `numberText` / `numberFromText` in `src/bsonUtils.ts` read and build numeric wire values.
- **Editing replaces the document** (`replace_document`, i.e. `replace_one` by `_id`), so fields removed in the editor are removed in the database. Changing `_id` is rejected. Saving or deleting a document that no longer exists is an error, not a silent no-op.
- **Errors**: Rust commands return `Result<T, String>`. Strings are surfaced to TS via the rejection side of the `invoke` promise and caught with `try/catch`. No `anyhow`, no `thiserror`, no custom error enums.
- **UI navigation**: no router. `App.tsx` toggles `<ConnectView />` ↔ `<HomeView />` based on a `connected: boolean` state. `HomeView` holds an in-memory `TabState[]` (max 8 tabs) and selects the active pane from it.

## Key Directories

| Path | Purpose |
|---|---|
| `src/` | React frontend (TypeScript, Tailwind v4) |
| `src/components/` | 6 components + colocated `__tests__/` |
| `src/types.ts` | Shared TS interfaces: `ConnectionInfo`, `DocumentListResult`, `TabState`, `ConnectionPreset` |
| `src-tauri/src/` | Rust backend: `lib.rs` (Tauri builder + commands), `mongo.rs` (driver + state) |
| `src-tauri/capabilities/` | Tauri v2 permission JSON |
| `tests/e2e/` | Playwright spec (mocks all Tauri IPC) |
| `playwright.config.ts` | E2E config (Chromium only, port 1420) |

## Important Files

- `src/main.tsx` — React root (`StrictMode`).
- `src/App.tsx` — Connection-flow state machine.
- `src/components/ConnectView.tsx` — URI form, preset sidebar (localStorage), env color picker, diagnostics phases.
- `src/components/HomeView.tsx` — Sidebar (db/coll tree), tab bar, active-pane routing.
- `src/components/DatabaseCollectionsView.tsx` — Collection stats table, create/drop modals.
- `src/components/DocumentExplorer.tsx` — Query bar, three view modes, pagination, BSON render.
- `src/components/DocumentEditorModal.tsx` — JSON textarea insert/edit modal.
- `src/components/AggregationBuilder.tsx` — Pipeline stages with autocomplete + live preview.
- `src-tauri/src/lib.rs` — 12 `#[tauri::command]` handlers; the `run()` builder.
- `src-tauri/src/mongo.rs` — `AppState`, `connect`/`disconnect`, CRUD, aggregation, `json_to_document` helper, inline `#[cfg(test)]` unit tests.
- `src-tauri/tauri.conf.json` — App id `com.nazarkalituk.mongo-compass-tauri`, window 1200×800 `"Compass+"`, CSP `null`, bundle `"all"`.
- `src-tauri/capabilities/default.json` — `core:default` + `opener:default` only.

## Tauri Commands (the public IPC surface)

Defined in `src-tauri/src/lib.rs`. All are `async fn ... -> Result<T, String>` and registered in `invoke_handler!`:

| Command | Args (TS) | Returns |
|---|---|---|
| `connect_db` | `uri: string` | `ConnectionInfo` |
| `disconnect_db` | — | `void` |
| `list_databases` | — | `string[]` |
| `list_collections` | `dbName: string` | `string[]` |
| `find_documents` | `dbName, collName, filter, sort, projection, limit, skip` | `DocumentListResult` |
| `insert_document` | `dbName, collName, docJson` | `string` (inserted `_id` as Extended JSON) |
| `replace_document` | `dbName, collName, idJson, docJson` (Extended JSON) | `void` |
| `delete_document` | `dbName, collName, idJson` | `void` |
| `get_collections_stats` | `dbName` | `CollectionStats[]` |
| `create_collection` | `dbName, name, capped?, size?, max?` | `void` |
| `drop_collection` | `dbName, collName` | `void` |
| `aggregate_documents` | `dbName, collName, pipelineStr` | `serde_json::Value[]` |

Argument names use `snake_case` on the Rust side; the Tauri runtime maps them from the camelCase keys the TS side sends.

## Runtime / Tooling Preferences

- **Package manager**: **npm** (lockfile `package-lock.json` is present; do not introduce pnpm/yarn/bun artifacts).
- **Node version**: no `.nvmrc` / `engines` field. Use whatever Node is on `PATH` (Vite 7 + TypeScript 5.8 need Node ≥ 18).
- **Rust toolchain**: Tauri 2 requires stable Rust ≥ 1.77 + system deps per Tauri's platform guide.
- **No lint/format config**: there is intentionally no ESLint, Prettier, rustfmt override, or clippy config. Do not add one without being asked. The only enforced checks are `tsc --strict` (with `noUnusedLocals` + `noUnusedParameters`) and the unit test suite.
- **No path aliases**: imports use relative paths (`./types`, `../mongo`). Do not add `tsconfig` paths or Vite aliases.
- **No CI**: no `.github/`. Tests run locally only.
- **No `.env` / secrets handling**: connection URIs are entered by the user; do not introduce env-var configuration without an explicit request.

## Development Commands

All commands run from the project root.

```bash
npm run dev                # Vite dev server on http://localhost:1420 (strict port)
npm run build              # tsc --noEmit && vite build → dist/
npm run preview            # Serve the built dist/ (no Tauri shell)
npm run tauri              # Pass-through to tauri CLI (use `npm run tauri dev`, `npm run tauri build`)
npm run tauri dev          # Full desktop app in dev mode
npm run tauri build        # Production native bundle

npm run test:unit          # Vitest (jsdom, headless, one-shot)
npm run test:unit:watch    # Vitest in watch mode
npm run test:e2e           # Playwright (spawns dev server, mocks Tauri IPC, Chromium)
npx playwright show-report # Open last E2E HTML report
cd src-tauri && cargo test # Rust unit tests in mongo.rs
cd src-tauri && cargo check # Type-check Rust without building
```

Tauri requires the Vite dev server on port **1420** (`strictPort: true`). If the port is busy, the dev command fails rather than picking another.

## Code Conventions & Common Patterns

### TypeScript / React

- **No state library.** All component state is `useState`; cross-component state flows through props. Do not introduce Zustand/Redux/Context.
- **No router.** `App.tsx` is the only navigation decision.
- **No custom hooks.** The codebase has zero `use*.ts` files. Keep logic inside the component that uses it.
- **Component shape**: `export default function ComponentName(props: ComponentNameProps) { ... }`. Props interface is declared in the same file, name suffixed `Props`.
- **Event handlers**: `handle*` prefix (`handleConnected`, `handleConnect`, `handleDisconnect`, `handleReset`, `handleDelete`).
- **Styling**: Tailwind utility classes only. No CSS modules, no `styled-components`, no inline `style` except for one-off dynamic values. Design tokens live as CSS custom properties under `@layer base` in `src/App.css` (e.g. `--color-primary: #F2673C`).
- **Icons**: `lucide-react`.
- **IPC call sites**: `const data = await invoke<T>("command_name", { camelCaseArgs })`; the arg object keys are camelCase even though Rust uses snake_case. Errors are caught as `e instanceof Error ? e.message : String(e)`.
- **localStorage**: connection presets live under a single key (see `ConnectView`); JSON-serialise `ConnectionPreset[]` on write, parse on read. Validate on load — do not trust stored shape blindly.
- **Strict TS**: `noUnusedLocals` and `noUnusedParameters` are on. Prefix intentionally-unused params with `_`.

### Rust

- **Module layout**: `mongo.rs` owns `AppState`, the `mongodb::Client` lifecycle, and all CRUD/aggregation functions. `lib.rs` is a thin Tauri-command layer that calls into `mongo::*` and is the only place `#[tauri::command]` is used.
- **Error type**: every command returns `Result<T, String>`. Format the error with `format!("{e:#}")` (or `e.to_string()`) at the call boundary; do not propagate `mongodb::Error` directly.
- **Async runtime**: `tokio` (`features = ["full"]` in `Cargo.toml`). Commands are `async fn` and use `State<'_, AppState>`. Mutex is `tokio::sync::Mutex`, not `std::sync::Mutex` — never hold the lock across an `.await` on something that does not need it.
- **Connection lifecycle**: `connect_db` sets `state.client` to `Some(client)`. `disconnect_db` resets it to `None`. Every other command must `state.client.as_ref().ok_or("not connected")?` before doing anything.
- **JSON ↔ BSON**: pass JSON-shaped strings (or `serde_json::Value`) into the mongo layer and convert with `json_to_document` / `bson::to_bson` / `bson::from_document` at the boundary. Do not leak `bson::Document` types out of the command surface.
- **Naming**: modules `snake_case` (`mongo.rs`), functions `snake_case`, structs `PascalCase` (`AppState`, `ConnectionInfo`, `CollectionStats`).
- **`main.rs`**: the Windows-subsystem attribute and its `DO NOT REMOVE!!` comment are load-bearing — do not touch them.

### Error handling checklist

- Rust: any new path that can fail returns `Result<_, String>`; do not `unwrap` / `expect` in command bodies.
- TS: any new `invoke` call site is wrapped in `try/catch`; display `err.message` in the UI error banner pattern used by `ConnectView` / `DocumentExplorer`.

## Testing & QA

Four independent test layers. Do not collapse them.

1. **Vitest unit tests** — `src/components/__tests__/ComponentName.test.tsx`. Run with `npm run test:unit`. jsdom + `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event`. Mock `@tauri-apps/api/core` per-suite with `vi.mock("@tauri-apps/api/core", ...)`; assert on the `mockInvoke.mock.calls` to verify the right command is sent with the right args.
2. **Playwright E2E** — `tests/e2e/connection.spec.ts`. Run with `npm run test:e2e`. One spec covering the full connection/CRUD/aggregation flow. The spec does **not** launch Tauri — it injects `window.__TAURI_INTERNALS__.invoke` mocks via `page.addInitScript` and runs against the bare Vite dev server. Selectors use `text=`, `role=`, `placeholder=`, and CSS — there are no `data-testid` attributes; do not add any.
3. **Rust unit tests**: `#[cfg(test)]` modules in `src-tauri/src/ejson.rs` (wire round trip through simulated JavaScript, query operators, malformed input) and `mongo.rs`. Run them with `cd src-tauri && cargo test`.
4. **Rust integration tests**: `src-tauri/tests/documents.rs`, run against a real MongoDB. They are skipped unless `COMPASS_IT_URI` is set:

   ```sh
   docker run -d --name compass-it-mongo -p 127.0.0.1:27099:27017 mongo:8.0
   cd src-tauri && COMPASS_IT_URI=mongodb://127.0.0.1:27099 cargo test --test documents
   ```

   Each test uses its own `compass_it_*` database.

### When adding a new component or command

- Add a Vitest suite in `src/components/__tests__/` that mocks `invoke` and asserts the new command name + arg shape.
- If the new feature is user-visible end-to-end, extend `tests/e2e/connection.spec.ts` and add the corresponding `invoke` mock to its `addInitScript` block.
- If the new command touches the BSON/JSON bridge, add a Rust unit test in `mongo.rs`.

### Coverage

No coverage threshold is configured. Aim for behavioral coverage: error paths, empty results, pagination boundaries, and the 8-tab limit. Do not write tests that just re-state the current implementation.

## Things to watch for

- **Port 1420 is sacred** — Tauri expects it, Playwright expects it, Vite's `strictPort` will fail otherwise.
- **CSP is `null`** — do not add inline scripts or remote origins without an explicit security review.
- **No `data-testid`** — the existing E2E spec relies on semantic selectors; adding `data-testid` is fine if you need it, but update the spec to match.
- **Capabilities file is minimal** — `core:default + opener:default`. Adding a new Tauri plugin requires both adding the plugin in `lib.rs` and extending `src-tauri/capabilities/default.json`.
- **README is a template stub** — do not assume it documents the project. Update it when you add user-visible features.
