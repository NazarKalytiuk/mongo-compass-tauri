# Compass+ vs MongoDB Compass (офіційний) — Gap-аналіз фіч

> **Що це.** Повний перелік усіх фіч **офіційного** MongoDB Compass
> (`github.com/mongodb-js/compass` + docs.mongodb.com/compass), зіставлений із поточною
> реалізацією **Compass+** (`mongo-compass-tauri`: Tauri 2 + React 19 + Rust `mongodb` 3.1).
>
> ⚠️ Не плутати з `MONGO_COMPASS_FEATURES.md` — той файл порівнює зі Swift-портом, а **цей** —
> з оригінальним Electron-додатком MongoDB.
>
> **Легенда статусу**
> - ✅ — реалізовано в Compass+
> - 🟡 — частково / спрощено (потребує доопрацювання)
> - ❌ — не реалізовано
> - ➕ — фіча Compass+, якої **немає** в офіційному Compass (бонус)
>
> **Джерело по Compass+:** 28 Tauri-команд у `src-tauri/src/lib.rs`, 14 React-компонентів,
> 8 секцій навігації (`explorer · aggregations · schema · investigate · metrics · shell · dump · query-log`).

---

## 0. Зведення по областях

| # | Область | Фіч в офіц. Compass (≈) | ✅ Done | 🟡 Partial | ❌ Missing |
|---|---------|------------------------:|--------:|-----------:|-----------:|
| 1 | Connections & Auth | 45 | 5 | 2 | 38 |
| 2 | Databases & Collections | 21 | 11 | 1 | 9 |
| 3 | Documents / CRUD | 30 | 15 | 4 | 11 |
| 4 | Query Bar | 18 | 6 | 1 | 11 |
| 5 | Aggregation Pipeline | 32 | 16 | 2 | 14 |
| 6 | Saved Queries & Aggregations | 8 | 3 | 2 | 3 |
| 7 | Schema Analysis | 20 | 11 | 1 | 8 |
| 8 | Indexes | 22 | 6 | 2 | 14 |
| 9 | Schema Validation | 11 | 10 | 1 | 0 |
| 10 | Explain Plan | 12 | 10 | 1 | 1 |
| 11 | Performance / Server Stats | 18 | 12 | 1 | 5 |
| 12 | Embedded Shell (mongosh) | 12 | 9 | 1 | 2 |
| 13 | Import / Export Data | 18 | 6 | 3 | 9 |
| 14 | Export-to-Language | 8 | 5 | 2 | 1 |
| 15 | AI / Generative | 8 | 0 | 0 | 8 |
| 16 | Compass Assistant | 10 | 0 | 0 | 10 |
| 17 | Data Modeling (ER) | 12 | 0 | 0 | 12 |
| 18 | Global Writes (Atlas) | 7 | 0 | 0 | 7 |
| 19 | Settings / Preferences | 30 | 0 | 0 | 30 |
| 20 | Misc / Global UI | 16 | 4 | 1 | 11 |
| — | **Разом** | **≈330** | **129** | **25** | **176** |

> Покриття ≈ **39% реалізовано**, ще **8% частково** (після виконання P1).
> Основні прогалини, що лишилися — корпоративна автентифікація, Atlas/хмарні фічі, AI,
> Compass Assistant, Data Modeling, Settings, опції створення колекцій (time-series/clustered).
> Власні фічі Compass+ (Dump/Restore, Query Log), яких немає в оригіналі — див. §21.
>
> **Виконано в P1:** Schema Validation tab (§9), Explain-дерево + find-explain (§10),
> Bulk Update/Delete + field-by-field editor (§3), Aggregation Text/Focus/disable-stage (§5),
> Views + create/drop database (§2).

---

## 1. Connections & Authentication

| Статус | Фіча | Примітки щодо Compass+ |
|--------|------|------------------------|
| ✅ | Підключення по `mongodb://` / `mongodb+srv://` URI | `connect_db` |
| ✅ | Збереження favourite/preset підключень | `ConnectionPreset[]` у localStorage |
| ✅ | Колірне кодування підключень (environment color) | вибір кольору в `ConnectView` |
| ✅ | DNS / TLS / Auth діагностика при невдалому конекті | `diagnose_uri` |
| ✅ | Список recents + "Save connection" toggle | — |
| 🟡 | Редагування/видалення збережених підключень | є видалення; немає edit/duplicate/clone |
| 🟡 | Recents vs Favorites розділення | спрощено (один список presets) |
| ❌ | **Advanced Connection form** (вкладки General/Auth/TLS/Proxy/Encryption) | лише сире URI-поле |
| ❌ | Перемикання string ↔ field-based form | — |
| ❌ | Кілька хостів (replica set / sharded) у формі | — |
| ❌ | Direct Connection toggle | — |
| ❌ | **Multi-connection** (кілька кластерів одночасно) | один `Client` в `AppState` |
| ❌ | Auth: Username/Password SCRAM (SHA-1/SHA-256, authSource) у формі | лише через URI вручну |
| ❌ | Auth: X.509 | — |
| ❌ | Auth: LDAP | — |
| ❌ | Auth: Kerberos / GSSAPI | — |
| ❌ | Auth: AWS IAM | — |
| ❌ | Auth: OIDC / OpenID Connect | — |
| ❌ | TLS/SSL: режим, CA file, client cert/key, insecure-прапорці | — |
| ❌ | SSH tunnel (password / identity file) | — |
| ❌ | SOCKS5 proxy | — |
| ❌ | Read preference (mode, maxStaleness, tag sets) | — |
| ❌ | Replica set name / authSource поля | — |
| ❌ | In-Use Encryption (CSFLE / Queryable Encryption) setup | — |
| ❌ | Import / Export збережених підключень (з passphrase) | — |
| ❌ | Protect Connection String Secrets / read-only mode | — |
| ❌ | Sign in with MongoDB Atlas + браузер деплойментів | — |
| ❌ | macOS Keychain для секретів | секрети лежать у localStorage |
| ❌ | CLI-запуск із connection string / `--username` `--password` | — |

---

## 2. Databases & Collections

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Список БД | `list_databases` |
| ✅ | Список колекцій зі статистикою | `get_collections_stats` |
| ✅ | Створення колекції (capped: size, max) | `create_collection` |
| ✅ | Drop колекції | `drop_collection` |
| ✅ | Статистика колекції (count, sizes, indexes) | `CollectionStats` |
| 🟡 | Перегляд stats БД (storage, coll/index count) | частково (агрегується з колекцій) |
| ✅ | Створення БД через UI (name + first collection) | `create_database` + модалка в `HomeView` |
| ✅ | Drop бази даних (type-to-confirm) | `drop_database` + модалка в `DatabaseCollectionsView` |
| ❌ | Створення колекції: custom collation | лише capped |
| ❌ | Створення колекції: clustered index (+TTL на `_id`) | — |
| ❌ | Створення колекції: **Time series** (timeField/metaField/granularity) | — |
| ❌ | Створення колекції: encrypted fields (Queryable Encryption) | — |
| ❌ | Time-series badge на колекції | — |
| ✅ | **Views**: створення з pipeline | `create_view` + модалка |
| ✅ | Views: open | відкриваються як колекції (read-only find) |
| ✅ | Views: drop | через `drop_collection` |
| ✅ | View badge у таблиці колекцій | `is_view` у `CollectionStats` |
| ❌ | Views: duplicate / rename / modify (редагувати pipeline) | — |
| ❌ | Індикація відсутніх привілеїв (empty-icon) | — |

---

## 3. Documents / CRUD

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | List/Tree view документів | `DocumentExplorer` |
| ✅ | JSON view | + line-number gutter |
| ✅ | Table view (авто-колонки) | — |
| ✅ | Пагінація (next/prev) | — |
| ✅ | Insert документа (JSON) | `insert_document` |
| ✅ | Edit документа | `update_document` |
| ✅ | Delete документа | `delete_document` |
| ✅ | Clone документа (Insert & clone) | — |
| ✅ | Рендер Extended JSON BSON-типів | `bsonUtils` |
| ✅ | doc-meta (кількість полів · розмір · indexed) | — |
| ✅ | Auto-detected content tags на картках | — |
| 🟡 | Конфігурований розмір сторінки | фіксований/спрощений |
| 🟡 | Розгортання/згортання документів і полів | базове |
| 🟡 | Schema-based lint у редакторі | через `get_collection_validator` |
| 🟡 | Insert: JSON-режим (один / масив) | є; немає field-by-field |
| ✅ | **Field-by-field editor** із вибором BSON-типу поля | `DocumentEditorModal` (JSON↔Fields toggle) |
| 🟡 | Inline edit із підсвічуванням змін | yellow (changed) / green (new) у field-режимі; без per-field revert |
| ✅ | Зміна типу поля під час редагування | селектор типу на поле |
| ❌ | Copy документа / copy окремого field+value | — |
| ✅ | **Bulk Update** (Modify Multiple, updateMany + preview) | `update_many` + модалка з прев'ю |
| ✅ | **Bulk Delete** (Delete Multiple + preview) | `delete_many` + модалка з прев'ю |
| ❌ | Conflict detection (Replace при зовнішній зміні) | — |
| ❌ | findOneAndUpdate vs findOneAndReplace залежно від view | спрощено |
| ❌ | Table view: reordering колонок, nested у новій вкладці, inline cell edit | базовий read-only table |
| ❌ | "Open URL in browser" по правому кліку | — |
| ❌ | Обфускація FLE-полів (asterisks) | — |
| ❌ | Add Data dropdown (Insert / Import) як в Compass | — |
| ❌ | Right-click "Add to query" з поля | — |

---

## 4. Query Bar

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Filter (MongoDB-оператори, dot-notation) | `find_documents` |
| ✅ | Sort | — |
| ✅ | Project (projection) | — |
| ✅ | Limit | — |
| ✅ | Skip | — |
| ✅ | Saved / favorite queries (per db+coll) | localStorage |
| 🟡 | Валідація фільтра | базова |
| ❌ | Collation | — |
| ❌ | Max Time MS | — |
| ❌ | Index Hint | — |
| ❌ | Query history (Recent Queries) | — |
| ❌ | Field autocomplete (ACE-редактор) | — |
| ❌ | BSON-конструктори в підказках (new Date(), NumberLong()…) | — |
| ❌ | Right-click value → "Add to query" | — |
| ❌ | Reset-кнопка з очищенням усіх полів | — |
| ❌ | Copy / delete favorited queries з UI історії | — |
| ❌ | **NL → query** (AI generate) | див. §15 |
| ❌ | Real-time підсвічування невалідного фільтра (червоний) | — |

---

## 5. Aggregation Pipeline Builder

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Multi-stage редактор | `AggregationBuilder` |
| ✅ | Autocomplete операторів | — |
| ✅ | Live preview | — |
| ✅ | Per-stage preview | — |
| ✅ | Per-stage timing + index used | через `explain_aggregation` |
| ✅ | Slow-stage hint з порадою індексу | — |
| ✅ | Drag-and-drop reorder стейджів | — |
| ✅ | Explain (sheet з повним планом) | `explain_aggregation` |
| ✅ | Saved pipelines (per db+coll) | localStorage |
| ✅ | Run pipeline | `aggregate_documents` |
| ✅ | Code generation для pipeline | `CodeGeneratorModal` |
| ✅ | Видалення стейджів | — |
| ✅ | Прев'ю sampled-документів | — |
| 🟡 | Кількість sampled-документів на стейдж | спрощено |
| 🟡 | Підсвічування/лінтинг синтаксису стейджа | базове |
| ✅ | **Text / Code mode** (увесь pipeline як текст) | toggle Stages↔Text + Apply to Stages |
| ✅ | **Focus mode** (редагування одного стейджа в модалці) | кнопка Maximize на стейджі |
| ❌ | **Stage Wizard** (форми-шаблони $group/$lookup/$match/$project/$sort) | є Insert Template, без форм-візарда |
| ✅ | Enable/disable стейджа toggle | Eye/EyeOff; виключається з усіх збирачів pipeline |
| ❌ | Insert stage before (+) | лише в кінець |
| ❌ | Atlas Search стейджі ($search / $searchMeta) | — |
| ❌ | Comment mode | — |
| ❌ | Create View from pipeline | — |
| ❌ | Confirmation перед $merge / $out | — |
| ❌ | Collation / Max Time MS опції | — |
| ❌ | Export результатів агрегації в JSON (Relaxed/Canonical) / CSV | — |
| ❌ | Export pipeline у 8 мов із import statements toggle | 5 мов, без toggle (див. §14) |
| ❌ | Налаштування sample size / auto-preview | — |
| ❌ | Resizable input/editor/output панелі | — |
| ❌ | Collapse/expand редактори стейджів | — |
| ❌ | Keyboard shortcuts для стейджів | — |
| ❌ | Create / import pipeline from text | — |

---

## 6. Saved Queries & Aggregations ("My Queries")

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Збереження queries (per db+coll) | localStorage |
| ✅ | Збереження pipelines (per db+coll) | localStorage |
| ✅ | Load / replay / delete | — |
| 🟡 | Favorite/star із назвою | базове |
| 🟡 | Reopen у відповідній вкладці | частково |
| ❌ | Єдина cluster-level вкладка **"My Queries"** | — |
| ❌ | Пошук / сортування / фільтр по db чи collection | — |
| ❌ | Застосування saved item до іншого namespace | — |

---

## 7. Schema Analysis

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Аналіз схеми семплінгом | `SchemaView` + `schemaAnalyzer` |
| ✅ | Детекція типів по полях | — |
| ✅ | Field presence / probability | — |
| ✅ | Mixed-type warnings | — |
| ✅ | Статистика значень (min/max/avg, distinct, top) | — |
| ✅ | Full-scan toggle | — |
| ✅ | Deepest path indicator | — |
| ✅ | Sparse-fields preview | — |
| ✅ | Sample diff ("+3 new since last sample") | snapshot у localStorage |
| ✅ | Re-sample + progress | — |
| ✅ | Аналіз вкладених документів/масивів | — |
| 🟡 | Конфігурований sample size | базове, без maxTimeMS |
| ❌ | **Geospatial Map View** (GeoJSON, draw circle → $geoWithin) | — |
| ❌ | Charts розподілу значень за типом | текст замість графіків |
| ❌ | Build query кліком по значеннях чарту (multi/compound) | — |
| ❌ | String/Date/ObjectId візуалізації (histogram, day-of-week) | — |
| ❌ | Query bar для фільтра в межах Schema | — |
| ❌ | **Export Schema** в JSON (Standard / Mongo / Expanded) | — |
| ❌ | Cardinality / частотні гістограми | спрощено |
| ❌ | Collection metadata панель у Schema | — |

---

## 8. Indexes

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Список індексів (name, key, size, usage) | `list_indexes` |
| ✅ | Create index | `create_index` (unique, sparse) |
| ✅ | Drop index | `drop_index` |
| ✅ | Index usage statistics (accesses) | — |
| ✅ | Index recommendations | евристика в `InvestigateView` |
| ✅ | Властивості unique / sparse | — |
| 🟡 | Вибір asc/desc для полів | базове |
| 🟡 | Compound index | через keys JSON |
| ❌ | UI-типи: text, 2dsphere/geo, hashed, wildcard, TTL | лише generic keys |
| ❌ | Опції: expireAfterSeconds (TTL), partialFilterExpression | — |
| ❌ | Опції: wildcardProjection, custom collation | — |
| ❌ | Hide / unhide index від планувальника | — |
| ❌ | Rolling index build | — |
| ❌ | Статус building / in-progress | — |
| ❌ | **Atlas Search Indexes** (створення, JSON-редактор, шаблони) | — |
| ❌ | Dynamic/explicit field mappings, synonyms | — |
| ❌ | **Atlas Vector Search Index** (path, numDimensions, similarity) | — |
| ❌ | Edit search index | — |
| ❌ | Перемикання Regular ↔ Search indexes view | — |
| ❌ | Status column (building / Ready) для search | — |
| ❌ | Create index із діалогу по полях зі схеми | — |

---

## 9. Schema Validation

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Читання `$jsonSchema` валідатора | `get_collection_validator` |
| ✅ | Lint документів за валідатором | у `DocumentEditorModal` |
| ✅ | **Окрема Validation tab** (create/edit rules) | `ValidationView` + нова секція навігації |
| ✅ | Авторинг `$jsonSchema` (required, bsonType, enum, min/max…) | редактор + `set_collection_validator` |
| ✅ | Авторинг MQL-виразів ($or, $type…) | через JSON-редактор валідатора |
| ✅ | Visual editor з валідацією JSON | `ValidationView` |
| ✅ | **Generate Rules** із семплу даних | `analyzeDocuments` → `generateJsonSchema` |
| ✅ | Validation action selector (error / warn) | `set_collection_validator` |
| ✅ | Validation level selector (strict / moderate / off) | `set_collection_validator` |
| ✅ | Preview passing/failing документів | «Test Against Sample» |
| 🟡 | Delete rules (очищення валідатора) | можна задати `{}`; окремої кнопки немає |

---

## 10. Explain Plan / Query Performance

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Explain для aggregation pipeline | `explain_aggregation` + `ExplainPlanView` |
| ✅ | Raw output (JSON) плану | Raw-режим у `ExplainPlanView` |
| ✅ | Per-stage timing/index у pipeline | є в §5 |
| ✅ | **Explain для find-запитів** (кнопка + sheet) | `explain_find` у Document Explorer |
| ✅ | **Visual Tree view** плану (кольорові вузли стейджів) | `ExplainPlanView` (IXSCAN/COLLSCAN/FETCH/SORT…) |
| ✅ | Query Performance Summary | summary-картки |
| ✅ | Метрики: executionTimeMillis, nReturned, totalDocsExamined, totalKeysExamined | summary-картки |
| ✅ | Winning plan / index usage display | дерево + статус-рядок індексу |
| ✅ | Health indication (examined vs returned) | warning при ratio > 10× |
| ✅ | Перемикання Tree ↔ Raw | toggle у `ExplainPlanView` |
| ❌ | AI-асистент по плану/індексах | див. §16 |
| 🟡 | Explain на будь-якому стейджі під час редагування | є per-stage timing/index, без повного дерева на стейдж |

---

## 11. Performance / Real-Time Server Stats

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Real-time лінійні чарти (rolling window) | `MetricsView`, polling 5s |
| ✅ | Opcounters (insert/query/update/delete/command/getmore) | `server_status` |
| ✅ | Connections лічильник | — |
| ✅ | Network In / Out | — |
| ✅ | Memory (resident) | — |
| ✅ | WiredTiger cache line | — |
| ✅ | Replication lag (replSetGetStatus) | `repl_set_status` |
| ✅ | Current operations | `current_ops` |
| ✅ | Slowest operations / slow queries | `InvestigateView` |
| ✅ | Kill Op | `kill_op` |
| ✅ | Toggle polling on/off | — |
| ✅ | Sidebar badge slow/ops > 1s | — |
| 🟡 | Active/Queued Reads & Writes лічильники | частково |
| ❌ | **Hottest Collections (mongotop)** таблиця | — |
| ❌ | Pause/Resume графіка + hover-зчитування значень у точці | — |
| ❌ | Virtual / mapped memory | лише resident |
| ❌ | **PNG export** графіків | — |
| ❌ | Clock / timeline синхронізація slow-ops | спрощено |

---

## 12. Embedded Shell (mongosh)

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Spawn mongosh + стрім виводу | `start_shell`, event channel |
| ✅ | Введення команд | `write_shell_command` |
| ✅ | Multi-line input (Enter/⌘↵) | `ShellView` |
| ✅ | Syntax-highlight виводу (ObjectId/ISODate/числа…) | regex-лексер |
| ✅ | Blinking caret | — |
| ✅ | Saved commands (recency drawer) | localStorage |
| ✅ | Стрім рядків через Tauri event | — |
| ✅ | Command history | — |
| ✅ | Один shell на підключення | — |
| 🟡 | Автокомпліт у shell | базовий/відсутній повноцінний |
| ❌ | Enable/disable shell у Settings; auto-disable в read-only | немає Settings |
| ❌ | `use <db>` контекст + кілька точок входу (sidebar `>_`) | — |

---

## 13. Import & Export Data

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Export у JSON Array | `ImportExportModal` |
| ✅ | Export у NDJSON | — |
| ✅ | Export у CSV | — |
| ✅ | Import з JSON Array | через `insert_many` |
| ✅ | Import з NDJSON | — |
| ✅ | Import з CSV | — |
| 🟡 | Вибір типу файлу JSON/CSV | базове |
| 🟡 | Auto ObjectId для відсутнього `_id` | на боці драйвера |
| 🟡 | Batch insert | `insert_many` |
| ❌ | CSV delimiter selection (comma/tab/semicolon/space) | — |
| ❌ | "Specify Fields and Types" (exclude, per-field BSON type) | — |
| ❌ | Ignore empty strings | — |
| ❌ | Stop on errors vs partial import | — |
| ❌ | Header row detection | — |
| ❌ | Progress bar + View Log | — |
| ❌ | Export лише filter/projection результатів | — |
| ❌ | Export результатів aggregation | — |
| ❌ | Вибір полів для експорту (All / select / Add Field) | — |
| ❌ | JSON формати Relaxed / Canonical Extended | — |

---

## 14. Export-to-Language / Code Generation

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Export find-запиту в код | `CodeGeneratorModal` |
| ✅ | Export aggregation в код | — |
| ✅ | Copy to clipboard | — |
| ✅ | Python (PyMongo) | — |
| ✅ | Node.js / JavaScript, Java, Go, C# | 5 мов |
| 🟡 | Include Import Statements toggle | відсутній/спрощений |
| 🟡 | Include Driver Syntax (sort/limit/maxTimeMS/collation) | спрощено |
| ❌ | Додаткові мови: PHP, Ruby, Rust (офіц. — 8 мов) | бракує 3 |

---

## 15. AI / Generative Features ❌ (повністю відсутні)

| Статус | Фіча |
|--------|------|
| ❌ | NL → filter query ("Generate query") |
| ❌ | NL → aggregation pipeline |
| ❌ | NL prompt input у query bar та aggregation builder |
| ❌ | Редагований AI-вивід + "how it works" |
| ❌ | Thumbs up/down feedback |
| ❌ | Opt-in "Enable AI Features" |
| ❌ | Toggle "send sample field values" |
| ❌ | Disclaimer про неточність |

---

## 16. Compass Assistant (Intelligent Assistant) ❌ (повністю відсутній)

| Статус | Фіча |
|--------|------|
| ❌ | In-app AI chat-панель |
| ❌ | NL-питання про Compass / дані / запити |
| ❌ | Поради з data modeling / best practices |
| ❌ | Авто-діагностика помилок підключення |
| ❌ | Поради з оптимізації запитів (аналіз explain, індекси) |
| ❌ | Пояснення результатів / планів / pipelines |
| ❌ | "Enable Read-Only Tools" toggle |
| ❌ | Read-only tool calling (list/find/aggregate/indexes/schema…) |
| ❌ | Human approval перед виконанням tool |
| ❌ | Контекстність по поточному namespace |

---

## 17. Data Modeling (ER Diagrams) ❌ (повністю відсутній)

| Статус | Фіча |
|--------|------|
| ❌ | Генерація ER-діаграми для БД |
| ❌ | Візуалізація колекцій/полів/типів |
| ❌ | Авто-інференс зв'язків (toggle) |
| ❌ | Ручне додавання зв'язків (drag-and-drop / side panel) |
| ❌ | Налаштування cardinality зв'язків |
| ❌ | Relationships tab (edit/delete) |
| ❌ | Анотації/нотатки на діаграмі |
| ❌ | Data Model Overview панель |
| ❌ | Export діаграми (.mdm / PNG / JSON) |
| ❌ | Import .mdm |
| ❌ | Модифікація колекцій/полів у діаграмі |
| ❌ | Інтероперабельність з Atlas data modeling |

---

## 18. Global Writes (Atlas Global Clusters) ❌ (повністю відсутній)

| Статус | Фіча |
|--------|------|
| ❌ | Global Writes tab для колекцій на Atlas Global Clusters |
| ❌ | Керування managed namespace (sharded collection) |
| ❌ | Required `location` + compound shard key |
| ❌ | Single/multi-region zones |
| ❌ | Zone Map (location→zone) |
| ❌ | Atlas-managed sharding |
| ❌ | Візуалізація shard/zone-to-location |

---

## 19. Settings / Preferences ❌ (екран налаштувань відсутній)

| Статус | Фіча |
|--------|------|
| ❌ | **General**: read-only mode, enable shell, protect secrets, default sort, maxTimeMS cap, DevTools, URL protocol handler, quit confirmation, show stats, infer namespaces |
| ❌ | **Theme**: Sync with OS / Light / Dark |
| ❌ | **Privacy**: auto-updates, geo-visualizations, telemetry, feedback, crash reports |
| ❌ | **Proxy**: no/system/manual (http/https/socks5/pac), exclusion list |
| ❌ | **OIDC**: browser command, device auth flow, stay logged in |
| ❌ | **AI**: enable features, send sample values, read-only assistant tools |
| ❌ | **Feature flags / feature preview** |
| ❌ | Конфігурація через GUI / CLI flags / config file |

---

## 20. Misc / Global UI

| Статус | Фіча | Примітки |
|--------|------|----------|
| ✅ | Workspaces & tabs (до 8 вкладок) | `HomeView`, `TabState[]` |
| ✅ | Sidebar nav-секції (9) | explorer/aggregations/schema/validation/investigate/metrics/shell/dump/query-log |
| ✅ | Count-badges на nav-рядках | — |
| ✅ | ⌘K фокус на пошук | — |
| 🟡 | Sidebar tree (db→collection) з пошуком | базовий пошук |
| ❌ | Home/Instance screen (cluster overview, статус-індикатор) | — |
| ❌ | Per-collection sub-tabs (Documents/Aggregations/Schema/Explain/Indexes/Validation) | секції глобальні, не per-collection sub-tabs |
| ❌ | "Open in New Tab" / right-click context menus у дереві | — |
| ❌ | **Find in Page** (Cmd/Ctrl+F) | — |
| ❌ | Welcome / onboarding screen | — |
| ❌ | Light/Dark theming з OS-sync | — |
| ❌ | Auto-update | — |
| ❌ | In-app feedback / Intercom | — |
| ❌ | URL protocol handler (mongodb:// links) | — |
| ❌ | Multiple windows | — |
| ❌ | Genuine MongoDB detection / non-genuine warning | — |

---

## 21. ➕ Фічі Compass+, яких немає в офіційному Compass

| Статус | Фіча | Примітки |
|--------|------|----------|
| ➕ | **Dump / Restore** (обгортка mongodump/mongorestore) | `run_mongodump`, `run_mongorestore`: gzip, oplog, parallel, dry-run, restore strategies, presets, est. size. Офіційний Compass **не** має GUI для dump/restore. |
| ➕ | **Query Log** як окрема секція | лог кожної операції (examined/plan/client/error), favorites+replay, time-range, advanced search syntax. В офіційному Compass є лише Recent Queries у query bar, а не повний журнал. |
| ➕ | Connect-діагностика по фазах (DNS/TLS/Auth) | `diagnose_uri` — деталізованіше, ніж у Compass. |
| ➕ | Index recommendations з евристики slow-queries | в офіційному — лише через AI/Performance Advisor (Atlas). |

---

## 22. Топ-пріоритети для надолуження (рекомендація)

Згруповано за співвідношенням «цінність / зусилля», лише з прогалин вище:

**P1 — ✅ ВИКОНАНО (висока цінність, без хмари)**
1. ✅ ~~**Schema Validation tab** (§9)~~ — `ValidationView`, Generate Rules, level/action, preview.
2. ✅ ~~**Explain Plan — Visual Tree + find-explain** (§10)~~ — `ExplainPlanView` + `explain_find`.
3. ✅ ~~**Bulk Update / Bulk Delete** із preview (§3)~~ — `update_many`/`delete_many`.
4. ✅ ~~**Aggregation: Text mode + Focus mode + enable/disable стейджа** (§5)~~.
5. ✅ ~~**Field-by-field document editor** з вибором BSON-типу та підсвічуванням змін (§3)~~.
6. ✅ ~~**Створення Views з pipeline + Create/Drop database UI** (§2)~~.

**P2 — середня цінність**
7. **Advanced Connection form** хоча б зі SCRAM/TLS/SSH-полями (§1) — навіть без корпоративних механізмів.
8. **Schema: charts розподілу + Export Schema JSON** (§7).
9. **Index types UI** (TTL/text/geo/wildcard/partial) (§8).
10. **Import/Export: CSV delimiter, fields&types, progress/log, export результатів** (§13).
11. **Settings/Preferences екран** + Light/Dark theme (§19).
12. **Query bar: collation, maxTimeMS, index hint, recent history** (§4).

**P3 — потребує зовнішніх сервісів / великих зусиль**
13. AI / Generative (§15) та Compass Assistant (§16) — потребують AI-бекенду.
14. Data Modeling ER-діаграми (§17).
15. Multi-connection (§1) — суттєва зміна `AppState`.
16. Atlas-залежні: Global Writes (§18), Atlas Search/Vector indexes (§8), Atlas sign-in (§1).
17. In-Use Encryption / CSFLE (§1, §3).

---

*Згенеровано на основі аналізу `github.com/mongodb-js/compass` (monorepo `packages/`) + docs.mongodb.com/compass проти поточного коду `mongo-compass-tauri`. Після P1 — 36 Tauri-команд. Оновлено після реалізації P1.*
