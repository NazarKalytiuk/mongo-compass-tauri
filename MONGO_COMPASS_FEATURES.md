# Compass+ — Feature Inventory (ported from `MongoCompass` Swift app)

> Source: `../MongoCompass` — a native SwiftUI / MongoKitten app that has the full feature surface. This is the **backlog** for `mongo-compass-tauri` (Tauri 2 + React 19 + Rust `mongodb` 3.1).
>
> **Legend**
> - ✅ — already implemented in `mongo-compass-tauri`
> - 🟡 — partial / needs upgrade
> - ❌ — not yet implemented
> - `[P]` — parallelizable with other `[P]` work
> - Size: **S** (≤1h), **M** (~half day), **L** (1+ day)
> - Tier: **P1** high impact · **P2** medium · **P3** nice-to-have · **P4** backend prerequisite

---

## 0. Status snapshot

| Area | Swift features | Done in Tauri | Pending |
|------|---------------:|--------------:|--------:|
| Connect | 6 | 6 | 0 |
| Multi-tab navigation | 1 | 1 | 0 |
| Document Explorer | 7 | 7 | 0 |
| Document Editor | 5 | 5 | 0 |
| Aggregation builder | 8 | 8 | 0 |
| Schema analysis | 6 | 6 | 0 |
| Investigate (indexes / slow / ops) | 8 | 8 | 0 |
| Metrics / server status | 4 | 3 | 1 |
| Query Log | 4 | 4 | 0 |
| Dump / Restore (mongodump) | 6 | 6 | 0 |
| Embedded Shell (mongosh) | 4 | 4 | 0 |
| Import / Export | 2 | 2 | 0 |
| Code generation | 2 | 2 | 0 |
| Sidebar / global | 3 | 3 | 0 |
| Persistence (storage) | 7 | 7 | 0 |
| **Totals** | **73** | **72** | **1** |

---

## 1. Connect

| # | Status | Feature | Notes / porting hints | Size |
|---|--------|---------|------------------------|------|
| 1.1 | ✅ | Connect via `mongodb://` or `mongodb+srv://` URI | `src-tauri/src/lib.rs:connect_db` exists | — |
| 1.2 | ✅ | Save connection presets (localStorage) | `ConnectView` already persists `ConnectionPreset[]` | — |
| 1.3 | ✅ | Real **DNS / TLS / Auth** diagnostics on connect failure | Swift uses `Host.lookup` + `NWConnection` TLS probe (6s) + ping-after-connect. Rust: add `tokio::net::TcpStream::lookup_host` + `tokio-native-tls` handshake probe; auth via ping. New `ConnectionDiagnostics` struct returned alongside `ConnectionInfo`. Surface in `ConnectView` phase-by-phase. | **M** |
| 1.4 | ✅ | "Save connection" toggle actually gates `connect_db` | Currently the preset is always saved. Add `save: bool` arg to the Tauri command. | **S** |
| 1.5 | ✅ | Group recents by **favourite environment color** | Each preset has a `color` tag; if user picks one, recent rows with that color are sticky on top. | **S** |
| 1.6 | ✅ | "Read the URI guide ↗" link | Link → `https://www.mongodb.com/docs/manual/reference/connection-string/` from `ConnectView` help text. | **S** [P] |

**Tauri commands touched:** `connect_db` (extend), new `diagnose_uri(uri) → ConnectionDiagnostics`.

---

## 2. Navigation / Multi-tab

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 2.1 | ✅ | **Up to 8 tabs** with per-tab DB/collection/filter/sort/projection/limit/skip state | Move tab-scoped state into `TabState[]` in `HomeView.tsx` (already typed). | — |

**Plan:** rewrite `HomeView` to render a tab bar + sidebar; the active pane reads from `activeTab` and refreshes docs/pipeline/schema/etc. on tab switch (mirroring the Swift `AppViewModel` single-`@Observable` pattern).

---

## 3. Document Explorer

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 3.1 | ✅ | **Tree** view (collapsible KV) | done | — |
| 3.2 | ✅ | **Table** view (auto-detected columns, sticky header) | done | — |
| 3.3 | ✅ | **JSON** view (line-number gutter) | Monospace gutter with line numbers. | **S** |
| 3.4 | ✅ | **Auto-detected content tags** on doc-cards (`tier · pro`, `2FA pending`, `trialing`, `active`) | Pure function `detectTags(doc) → Badge[]`; render max 3 pills in doc header. | **M** [P] |
| 3.5 | ✅ | **doc-meta row** "14 fields · 1.2 KB · indexed" | field count + BSON/JSON byte size + `indexed` status. | **S** [P] |
| 3.6 | ✅ | **Streaming skeleton** cards between page transitions | Responsive skeletons for Tree/Table/JSON views showing during paginate transitions. | **M** [P] |
| 3.7 | ✅ | **Saved queries** (per DB+collection) | Saved queries persisted in localStorage with load/replay/delete CRUD capability. | **M** |

**Tauri commands touched:** `find_documents` (unchanged), add `list_indexes(dbName, collName) → Index[]` for 3.5.

---

## 4. Document Editor (insert / edit modal)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 4.1 | ✅ | JSON-textarea insert / edit modal | done | — |
| 4.2 | ✅ | **Insert & clone** footer button (insert then clear `_id`, keep modal open) | Trivial button + state. Disabled in edit mode. | **S** |
| 4.3 | ✅ | **Schema-based lint** reading `$jsonSchema` validators | New Rust command `get_collection_validator(db, coll)`. Replaces type-heuristic lint with schema-driven required/bsontype/enum checks. | **L** |
| 4.4 | ✅ | **Charset / line-ending pills** (UTF-8 / LF / CRLF) | Detect from current buffer content. | **S** [P] |
| 4.5 | ✅ | **Code generation** for find/aggregation queries (5 languages) | See §13. | **M** |

**Tauri commands touched:** new `get_collection_validator(db, coll)`.

---

## 5. Aggregation Pipeline Builder

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 5.1 | ✅ | Multi-stage pipeline with autocomplete | done | — |
| 5.2 | ✅ | Live preview | done | — |
| 5.3 | ✅ | **Drag-and-drop** reordering of stages | Use HTML5 drag-and-drop. Persist order on drop. | **M** |
| 5.4 | ✅ | **Per-stage previews** keyed by stage UUID | Currently shows one preview for the full pipeline. Add per-stage preview chip (first 3 docs at that prefix). | — |
| 5.5 | ✅ | **Per-stage timing + index** (`8.4 ms · index used`) | After `run_aggregation`, run `aggregate(...).explain({verbosity: "executionStats"})` for each prefix; parse `stages[].executionTimeMillisEstimate`, `nReturned`, and walk `queryPlanner.winningPlan` to find the index name. Render in `stageMeta` row. | **L** |
| 5.6 | ✅ | **Slow-stage hint** with index suggestion | If `ms > 100`, show warning card "Consider index hint on `{field: 1}`". Detect field from `$match` stage JSON. | **S** |
| 5.7 | ✅ | Toolbar **Explain** button (sheet) | Renders pretty-printed full explain output with copy button. | **S** [P] |
| 5.8 | ✅ | **Saved pipelines** (per DB+collection) | Saved aggregation pipelines persisted in localStorage with load/run/delete CRUD capability. | **M** |

**Tauri commands touched:** extend `aggregate_documents` to return `{ results, explain }`; new `explain_pipeline(db, coll, stages) → ExplainPlan`.

---

## 6. Schema Analysis

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 6.1 | ✅ | BSON-accurate type detection from sample docs | Pure function in TS — read sample, build `Map<path, TypeStats>`. | — |
| 6.2 | ✅ | **Value statistics** (min/max/avg for numbers, length stats for strings, distinct count, top values) | Computed during sample. | — |
| 6.3 | ✅ | **Mixed-type warnings** on a field | A field with >1 type across docs → warning badge. | — |
| 6.4 | ✅ | **Full-scan mode** toggle | When on, sample size = collection size; show progress. | — |
| 6.5 | ✅ | **Deepest path** indicator | Max depth in the type tree. | — |
| 6.6 | ✅ | **Sparse-fields** preview + **sample diff** ("+3 new since last sample") | Persist last snapshot per `db.collection` in `localStorage`. Compute set diff on re-sample. | — |
| 6.7 | ✅ | **Re-sample** toolbar button + progress pill | Trivial UI on top of 6.1. | — |

**Tauri commands touched:** new `analyze_schema(db, coll, sampleSize) → SchemaField[]` (or pure-TS — the Swift side does it client-side, prefer that to keep the Rust surface small).

---

## 7. Investigate (indexes / slow queries / current ops)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 7.1 | ✅ | **List indexes** for collection | New command `list_indexes(db, coll) → Index[]`. | — |
| 7.2 | ✅ | **Create / drop index** | New commands `create_index(db, coll, spec, options)` and `drop_index(db, coll, name)`. | — |
| 7.3 | ✅ | **Index recommendations** based on slow-query patterns | Pure-TS analyzer that groups slow queries by namespace and proposes compound indexes. | — |
| 7.4 | ✅ | **Aggregated slow queries** (mean / p99 / count / last seen) | Group by `op + ns + plan`; nearest-rank p99. Source: client-side query log + optional `system.profile` collection. | — |
| 7.5 | ✅ | **Current operations** with R/W **locks column** | New command `current_ops() → CurrentOp[]` using `db.adminCommand({currentOp: 1})`. | — |
| 7.6 | ✅ | **Filter…** popover (namespace / op-type / min-duration) | UI only. | — |
| 7.7 | ✅ | **Export report** (JSON) | Use Tauri's `dialog.save` + write file. | — |
| 7.8 | ✅ | **Sidebar badge** of slow + ops > 1s | Computed from queryLog + currentOps. | — |

**Tauri commands touched:** new `list_indexes`, `create_index`, `drop_index`, `current_ops`, `kill_op`, `set_profiling_level`.

---

## 8. Metrics / Server status

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 8.1 | ✅ | **6 KPI sparklines** (Ops · Connections · Resident mem · Net I/O · Cache hit · Replication lag) | `db.serverStatus()` polled at 5s; 60-point history in `AppState`. Replication lag via `replSetGetStatus` (`members[].optimeDate` diff from PRIMARY). | — |
| 8.2 | ✅ | Charts: ops / connections / network / memory (with **WT cache line**) | Memory chart = resident + `wiredTiger.cache."bytes currently in the cache"`. | — |
| 8.3 | ❌ | **PNG export** via `ImageRenderer` equivalent | In Tauri: use `dom-to-image-more` + Rust write to a file dialog. | **S** |
| 8.4 | ✅ | Toggle polling on/off + start/stop on connect/disconnect | Hook into `App.tsx` lifecycle. | — |

**Tauri commands touched:** new `server_status() → ServerStatus`, `repl_set_status() → ReplSetStatus`. Background polling lives in TS (a `useEffect` + `setInterval` is enough for now; port to a Rust `tokio` task if perf needs it).

---

## 9. Query Log

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 9.1 | ✅ | Log every op with `examined / plan / client / errorMessage` | Hook into each Tauri command wrapper in TS. Cap 500 entries. | — |
| 9.2 | ✅ | **Favorites** + replay | Toggle `isFavorite`; replay loads the entry's filter/sort/projection into the active tab. | — |
| 9.3 | ✅ | **Custom time-range** via `DatePicker` | Two `<input type="datetime-local">` controls. | **M** [P] |
| 9.4 | ✅ | **Advanced search syntax** (`$lookup OR slow >= 1000ms`, `coll:users`, `plan:IXSCAN`) | Mini parser; substring fallback. | **L** [P] |

**Storage:** localStorage under one key, validated on load (mirror Swift `StorageService`).

---

## 10. Dump / Restore (mongodump / mongorestore)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 10.1 | ✅ | Wrap `mongodump` with `--oplog`, `--excludeIndexes`, `--numParallelCollections`, `--gzip`, `--db`, `--collection`, `--out` | Shell out via `tokio::process::Command`; stream stdout to a log buffer. | **M** |
| 10.2 | ✅ | Wrap `mongorestore` with `--oplogReplay`, `--noIndexRestore`, `--maintainInsertionOrder`, `--noObjcheck`, `--stopOnError`, `--drop` | Same mechanism. | **M** |
| 10.3 | ✅ | **Restore strategies** (Drop + restore / Merge / Skip existing) | Enum instead of bool. | **S** |
| 10.4 | ✅ | **Dry run** prints the full command without executing | Build the argv, show in the log as info, skip `process.run()`. | **S** [P] |
| 10.5 | ✅ | **Save preset** + menu (load / delete) | Persist presets in `localStorage` under `dumpPresets`; toolbar Menu. | **M** [P] |
| 10.6 | ✅ | Real **estimated size** via `collStats` | `db.runCommand({collStats: <coll>}).size` (gzip × 0.25). | **M** [P] |

**Tauri commands touched:** new `dump(uri, opts, outPath)`, `restore(uri, opts, inPath)`, `coll_size(db, coll)`. Or — to avoid bundling mongodump with the app — run via `tokio::process::Command` with the same path-discovery logic as Swift (`which`, then Homebrew/MacPorts/Linux paths, then prompt the user to install if missing).

---

## 11. Embedded Shell (mongosh)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 11.1 | ✅ | Spawn `mongosh` and stream output | Tauri command spawns the process; frontend subscribes to streamed lines via a Tauri event channel. | **L** |
| 11.2 | ✅ | **Multi-line input** (Enter = newline, ⌘↵ = submit) | `<textarea>` with `onKeyDown` intercept of Enter. | **S** |
| 11.3 | ✅ | **Syntax-highlighted output** (`ObjectId(…)`, `ISODate(…)`, `$keys`, numbers, strings) | Regex lexer → render `Array<{text, color}>`. | **L** |
| 11.4 | ✅ | **Blinking caret** + **saved commands** (recency-ordered drawer) | Caret: `opacity` keyframe. Saved: `localStorage` + draw-out panel. | **M** |

**Tauri commands touched:** new `start_shell(uri) → ShellHandle`, `write_shell(handle, input)`, stream output via `app.emit("shell://line", ...)`.

---

## 12. Import / Export

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 12.1 | ✅ | **Export** current documents to **JSON Array / NDJSON / CSV** | `dom` click → Tauri `dialog.save` → Rust `fs::write` or pure-TS `Blob` + `<a download>`. | **M** |
| 12.2 | ✅ | **Import** from **JSON Array / NDJSON / CSV** into the active collection | File picker → parse → batch `insert_document` (or `insertMany` once a new command is added). | **M** |

**Tauri commands touched:** new `insert_many(db, coll, docs) → string[]` (inserted ids), used by import.

---

## 13. Code Generation (find + aggregation)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 13.1 | ✅ | Generate **find** code in 5 languages | Python (PyMongo), JavaScript (Node driver), Java, Go, C#. Pure-TS templating. | **M** |
| 13.2 | ✅ | Generate **aggregation** code in 5 languages | Same languages, includes pipeline. | **M** |

**Surface:** "Copy as" menu in the doc editor / aggregation toolbar.

---

## 14. Sidebar / Global

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 14.1 | ✅ | **Nav sections** (Explorer / Aggregations / Schema / Investigate / Metrics / Shell / Dump / Query Log) | Replaces the current single-pane layout; each section becomes a route. | — |
| 14.2 | ✅ | **Count-badges** on nav rows (Query Log / Investigate / Schema fields count) | Computed in `App.tsx`. | — |
| 14.3 | ✅ | **⌘K** focuses the search field | Register a global key handler in `App.tsx`; `useRef` on the search input. | — |

---

## 15. Persistence (storage layer)

| # | Status | Feature | Notes | Size |
|---|--------|---------|-------|------|
| 15.1 | ✅ | Saved connections (cap 10) | done | — |
| 15.2 | ✅ | Query log (cap 500) | Mirror Swift `StorageService`. | **S** |
| 15.3 | ✅ | Saved queries (per DB+collection) | Saved queries persisted in localStorage. | **S** |
| 15.4 | ✅ | Saved pipelines (per DB+collection) | Saved pipelines persisted in localStorage. | **S** |
| 15.5 | ✅ | Saved shell commands (recency-ordered) | New. | **S** |
| 15.6 | ✅ | Dump presets | New. | **S** |
| 15.7 | ✅ | Schema snapshots (per `db.coll`) | New — powers §6.6. | **S** |

**Convention:** one localStorage key per collection, JSON-serialised, validated on load (do not trust stored shape).

---

## Recommended implementation order

A linear path that builds on what's already in `mongo-compass-tauri`. Each step is independently shippable.

| # | Step | Tier | Depends on |
|---|------|------|------------|
| 1 | 2.1 — Multi-tab state model | P1 | — |
| 2 | 14.1 — Sidebar nav with 8 sections | P1 | 1 |
| 3 | 14.2 + 14.3 — Nav badges + ⌘K | P1 | 2 |
| 4 | 9.1 — Query log plumbing (wrap existing commands) | P1 | 2 |
| 5 | 9.2 — Favorites + replay | P2 | 4 |
| 6 | 7.1 + 7.2 — List/create/drop indexes | P1 | — |
| 7 | 7.5 — Current ops | P1 | — |
| 8 | 7.4 — Aggregated slow queries (in-memory) | P1 | 4, 7 |
| 9 | 7.3 — Index recommendations | P2 | 8 |
| 10 | 7.6 + 7.7 + 7.8 — Investigate UI polish | P2 | 7, 8, 9 |
| 11 | 8.1 + 8.2 + 8.4 — Metrics polling + charts | P1 | — |
| 12 | 8.3 — PNG export | P3 | 11 |
| 13 | 6.1 + 6.2 + 6.3 + 6.5 — Schema analysis (core) | P1 | — |
| 14 | 6.6 + 6.7 + 6.4 — Re-sample + diff + full-scan | P2 | 13 |
| 15 | 5.4 — Per-stage previews | P1 | — |
| 16 | 5.5 + 5.6 — Per-stage timing + slow hint | P2 | 15 |
| 17 | 5.3 + 5.7 — Drag-and-drop + Explain sheet | P2 | — |
| 18 | ~~5.8 — Saved pipelines~~ (Done) | P2 | — |
| 19 | ~~3.3 + 3.4 + 3.5 + 3.6 — Explorer polish~~ (Done) | P2 | — |
| 20 | ~~3.7 — Saved queries~~ (Done) | P2 | — |
| 21 | ~~4.3 — Schema-based lint~~ (Done) | P1 | 13 |
| 22 | ~~4.2 + 4.4 — Insert & clone + charset pills~~ (Done) | P3 | — |
| 23 | ~~13.1 + 13.2 — Code generation~~ (Done) | P2 | — |
| 24 | ~~12.1 + 12.2 — Import / Export~~ (Done) | P1 | — |
| 25 | ~~10.1 + 10.2 + 10.3 — Dump / Restore~~ (Done) | P1 | — |
| 26 | ~~10.4 + 10.5 + 10.6 — Dry run / presets / est. size~~ (Done) | P2 | 25 |
| 27 | ~~11.1 + 11.2 — Embedded shell core~~ (Done) | P2 | — |
| 28 | ~~11.3 + 11.4 — Shell syntax highlight + caret + saved commands~~ (Done) | P3 | 27 |
| 29 | ~~1.3 + 1.4 + 1.5 + 1.6 — Connect diagnostics + UI polish~~ (Done) | P2 | — |
| 30 | ~~9.3 + 9.4 — Query Log advanced search~~ (Done) | P3 | 4 |

---

## Cross-cutting concerns

- **Architecture:** keep a single `AppState`-equivalent. Currently state is in `App.tsx` + per-component `useState`; as features grow, centralize in a `useReducer` + `localStorage` middleware, or add a small `zustand` store if the user approves (the AGENTS.md forbids it without an explicit request, so prefer the React primitives).
- **Rust surface:** every new read needs a Tauri command. Every write does too. Commands return `Result<T, String>` — strings via `format!("{e:#}")`.
- **BSON bridge:** extended-JSON for `ObjectId`/`Date`/`NumberLong`/`NumberDecimal` is already in place (per AGENTS.md). New commands that touch the BSON layer need a unit test in `mongo.rs`.
- **Frontend tests:** each new component gets a Vitest suite mocking `invoke` and asserting on `mockInvoke.mock.calls`. E2E (`tests/e2e/connection.spec.ts`) extends with the new IPC mocks.
- **No lint/format config** — do not add ESLint/Prettier/rustfmt without being asked.
- **No path aliases** — keep relative imports.
- **Port 1420 is sacred** — Vite `strictPort: true`; don't change it.

---

## Quick reference: Swift → Tauri mapping

| Swift | Tauri equivalent |
|-------|------------------|
| `MongoService` (MongoKitten) | `src-tauri/src/mongo.rs` (mongodb 3.1 driver) + `AppState` |
| `AppViewModel` (`@Observable`) | `App.tsx` + per-component `useState` (current) or future single-store |
| `StorageService` (UserDefaults) | `localStorage` with one key per collection, validated on load |
| `MetricsService` (Tokio task) | TS `useEffect` + `setInterval` for now; promote to Rust task if needed |
| `SchemaService` (pure) | Pure-TS module (`src/services/schema.ts`) |
| `CodeGeneratorService` (pure) | Pure-TS module (`src/services/codeGen.ts`) |
| `ImportExportService` | TS + Tauri `dialog` + `fs` plugin |
| `DumpRestoreService` (`Process`) | Rust `tokio::process::Command` + Tauri `dialog` |
| `ShellView` (mongosh `Process`) | Rust `tokio::process::Command` + Tauri event channel |
| `Theme.swift` (tokens) | `src/App.css` `@layer base` (already in place) |
| `SidebarView` | `HomeView` sidebar (to be split out) |
| 12 Tauri commands | Will grow to ~30 by the end of this backlog |
