import { test, expect } from "@playwright/test";

test.describe("Connection Workflow (E2E)", () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock Tauri invoke internals before the application runs
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "connect_db") {
            if (args.uri.includes("invalid")) {
              throw new Error("DNS resolution failed for hostname");
            }
            return {
              version: "8.0.0",
              databases: ["admin", "local", "users_db"],
            };
          }
          if (cmd === "diagnose_uri") {
            return {
              uri_parse_ok: true,
              uri_parse_error: null,
              dns_resolve_ok: false,
              dns_resolve_error: "DNS resolution failed for hostname",
              tcp_connect_ok: false,
              tcp_connect_error: "TCP handshake skipped",
              auth_ok: false,
              auth_error: "Auth skipped",
            };
          }
          if (cmd === "get_collection_size") {
            return 45200;
          }
          if (cmd === "start_shell") {
            return null;
          }
          if (cmd === "write_shell_command") {
            return null;
          }
          if (cmd === "list_collections") {
            return ["users", "sessions"];
          }
          if (cmd === "find_documents") {
            if (args.filterStr && args.filterStr.includes("Laptop")) {
              return {
                documents: [
                  { _id: { $oid: "123" }, name: "Premium Laptop", price: 1200 }
                ],
                total_count: 1
              };
            }
            return {
              documents: [
                { _id: { $oid: "123" }, name: "Premium Laptop", price: 1200 },
                { _id: { $oid: "456" }, name: "Wireless Mouse", price: 25 }
              ],
              total_count: 2
            };
          }
          if (cmd === "insert_document") {
            return "ObjectId(\"789\")";
          }
          if (cmd === "update_document") {
            return null;
          }
          if (cmd === "delete_document") {
            return null;
          }
          if (cmd === "get_collections_stats") {
            return [
              { name: "users", document_count: 2, storage_size: 1024, index_count: 2, is_capped: false },
              { name: "sessions", document_count: 15, storage_size: 8192, index_count: 1, is_capped: false }
            ];
          }
          if (cmd === "create_collection") {
            return null;
          }
          if (cmd === "drop_collection") {
            return null;
          }
          if (cmd === "aggregate_documents") {
            return [
              { _id: { $oid: "123" }, name: "Premium Laptop", price: 1200, aggregated: true }
            ];
          }
          if (cmd === "list_indexes") {
            return [
              { name: "_id_", key: { _id: 1 }, size: 8192, unique: true, sparse: false }
            ];
          }
          if (cmd === "current_ops") {
            return [
              { opid: 7777, client: "127.0.0.1:9999", op: "query", ns: "users_db.users", secs_running: 15, query: '{"active": true}' }
            ];
          }
          if (cmd === "kill_op") {
            return null;
          }
          throw new Error(`Unhandled Tauri E2E command: ${cmd}`);
        },
      };
    });

    await page.goto("/");
  });

  test("should render the connection screen and verify fields", async ({ page }) => {
    await expect(page.locator("text=Connect to Database")).toBeVisible();
    await expect(page.locator("label:has-text('Connection URI String')")).toBeVisible();
    
    // Check default URI is populated
    const uriInput = page.locator("#connection-uri-input");
    await expect(uriInput).toHaveValue("mongodb://localhost:27017");
  });

  test("should show error alert when connection fails", async ({ page }) => {
    const uriInput = page.locator("#connection-uri-input");
    await uriInput.fill("mongodb://invalid-host:27017");
    
    await page.click("button:has-text('Connect')");
    
    // Check loader state appears and then error shows
    await expect(page.locator("text=Connection Error:")).toBeVisible();
    await expect(page.locator("text=DNS resolution failed for hostname").first()).toBeVisible();
  });

  test("should navigate to dashboard and list databases on successful connection", async ({ page }) => {
    await page.click("button:has-text('Connect')");
    
    // Check that we transitioned to home view
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();
    await expect(page.locator("text=MongoDB Server Build v8.0.0")).toBeVisible();
    
    // Verify databases from the mock are in the sidebar
    await expect(page.getByRole("button", { name: "admin", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "local", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "users_db", exact: true })).toBeVisible();
  });

  test("should save a new preset upon connection, allow selecting it, and allow deleting it", async ({ page }) => {
    // 1. Enter details for a new preset
    const nameInput = page.getByPlaceholder("e.g., Development Database");
    await nameInput.fill("Test E2E Preset");

    const uriInput = page.locator("#connection-uri-input");
    await uriInput.fill("mongodb://e2e-test-host:27017");

    // Click staging button to change color
    await page.click("button:has-text('Staging')");

    // 2. Connect (this mock-saves the preset)
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // 3. Disconnect to return to connection screen
    await page.click("button[title='Disconnect']");
    await expect(page.locator("text=Connect to Database")).toBeVisible();

    // 4. Verify new preset is in sidebar
    await expect(page.locator("text=Test E2E Preset")).toBeVisible();
    await expect(page.locator("text=mongodb://e2e-test-host:27017")).toBeVisible();

    // 5. Select preset and verify fields update
    await page.click("text=Test E2E Preset");
    await expect(uriInput).toHaveValue("mongodb://e2e-test-host:27017");

    // 6. Delete the preset
    const deleteBtn = page.getByRole("button", { name: "Delete preset Test E2E Preset" });
    // Playwright automatically hovers before clicking to reveal opacity-0 button
    await deleteBtn.click();

    // Verify it is removed
    await expect(page.locator("text=Test E2E Preset")).not.toBeVisible();
  });

  test("should expand database, show collections, and select collection to query documents", async ({ page }) => {
    // Connect first
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // Click on users_db to expand it
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();

    // Verify list_collections is invoked and collections are listed in the sidebar child nodes
    const sidebar = page.locator("div.w-80");
    await expect(sidebar.getByRole("button", { name: "users", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "sessions", exact: true })).toBeVisible();

    // Click on 'users' collection
    const collectionBtn = sidebar.getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // Verify active tab changes to 'users_db.users'
    await expect(page.locator("text=users_db.users")).toBeVisible();

    // Verify document explorer displays documents
    await expect(page.locator("text=Premium Laptop")).toBeVisible();
  });

  test("should manage multiple tabs (opening, switching, closing)", async ({ page }) => {
    // Connect first
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // Click '+' to open new tab
    const addTabBtn = page.locator("button[title='Open New Tab']");
    await addTabBtn.click();
    await expect(page.locator("text=New Tab")).toBeVisible();

    // Click on users_db to expand it
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();

    // Click on 'users' collection (loads inside active 'New Tab')
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // The second tab should be renamed to users_db.users and show the explorer
    await expect(page.locator("text=users_db.users")).toBeVisible();
    await expect(page.locator("text=Premium Laptop")).toBeVisible();

    // Switch back to 'Welcome' tab by clicking header
    await page.locator('.overflow-x-auto span:has-text("Welcome")').click();
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // Close the second tab (users_db.users)
    const closeBtn = page.locator('.overflow-x-auto .group:has-text("users_db.users") button');
    await closeBtn.click();

    // Verify 'users_db.users' tab is closed and no longer visible
    await expect(page.locator("text=users_db.users")).not.toBeVisible();
  });

  test("should execute find queries and reset them correctly", async ({ page }) => {
    // 1. Connect
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // 2. Select database and collection
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // 3. Verify both default documents are visible initially
    await expect(page.locator("text=Premium Laptop")).toBeVisible();
    await expect(page.locator("text=Wireless Mouse")).toBeVisible();

    // 4. Fill in search filter input
    const filterInput = page.getByPlaceholder("e.g. { \"status\": \"active\" }");
    await filterInput.fill('{"name": "Laptop"}');

    // 5. Run the query
    await page.click("button:has-text('Find')");

    // 6. Verify only the Laptop document is displayed
    await expect(page.locator("text=Premium Laptop")).toBeVisible();
    await expect(page.locator("text=Wireless Mouse")).not.toBeVisible();

    // 7. Click Reset and verify both documents return
    await page.click("button:has-text('Reset')");
    await expect(page.locator("text=Premium Laptop")).toBeVisible();
    await expect(page.locator("text=Wireless Mouse")).toBeVisible();
  });

  test("should insert, edit, and delete documents via UI modals", async ({ page }) => {
    // 1. Connect and go to collection
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();
    
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // 2. Open Insert Document Modal
    await page.click("button:has-text('Insert Document')");
    await expect(page.getByRole("heading", { name: "Insert Document" })).toBeVisible();

    // Fill in document JSON
    const textarea = page.locator("textarea");
    await textarea.fill('{\n  "name": "E2E Inserted Product",\n  "price": 99.99\n}');

    // Save insert
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Modal should close
    await expect(page.getByRole("heading", { name: "Insert Document" })).not.toBeVisible();

    // 3. Edit document
    // Hover over the first document row to reveal the action buttons
    const docRow = page.locator(".group:has-text('Premium Laptop')").first();
    await docRow.hover();

    const editBtn = page.getByRole("button", { name: "Edit document" }).first();
    await editBtn.click();

    await expect(page.getByRole("heading", { name: "Edit Document" })).toBeVisible();
    // Save edit
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit Document" })).not.toBeVisible();

    // 4. Delete document
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to delete this document?");
      await dialog.accept();
    });

    await docRow.hover();
    const deleteBtn = page.getByRole("button", { name: "Delete document" }).first();
    await deleteBtn.click();
  });

  test("should select database, view collections, create a collection, and drop a collection", async ({ page }) => {
    // 1. Connect
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // 2. Select database to view collections
    const dbBtn = page.getByRole("button", { name: "users_db" });
    await dbBtn.click();

    // 3. Verify DatabaseCollectionsView renders stats and elements
    await expect(page.locator("text=Explore collections, view storage statistics")).toBeVisible();
    await expect(page.locator("text=Total Storage Size")).toBeVisible();
    
    // Check Collections count card contains "2"
    const collectionsCard = page.locator("div").filter({ has: page.getByText("Collections", { exact: true }) }).locator("span.text-2xl").first();
    await expect(collectionsCard).toHaveText("2");

    // Check table rows are shown
    await expect(page.locator("tr:has-text('users')")).toBeVisible();
    await expect(page.locator("tr:has-text('sessions')")).toBeVisible();

    // 4. Create collection
    await page.click("button:has-text('Create Collection')");
    await expect(page.getByRole("heading", { name: "Create Collection" })).toBeVisible();

    const nameInput = page.getByPlaceholder("e.g. users_new");
    await nameInput.fill("logs");

    const submitCreateBtn = page.locator("form button[type='submit']");
    await submitCreateBtn.click();

    // Modal should close
    await expect(page.getByRole("heading", { name: "Create Collection" })).not.toBeVisible();

    // 5. Drop collection
    // Find sessions row and click the drop button (trash icon)
    const sessionsRow = page.locator("tr:has-text('sessions')");
    const trashBtn = sessionsRow.locator("button[title='Drop Collection']");
    await trashBtn.click();

    await expect(page.getByRole("heading", { name: "Drop Collection" })).toBeVisible();

    const confirmInput = page.getByPlaceholder("sessions");
    const dropSubmitBtn = page.locator("form button[type='submit']");

    // Initially disabled
    await expect(dropSubmitBtn).toBeDisabled();

    // Fill in correct confirmation name
    await confirmInput.fill("sessions");
    await expect(dropSubmitBtn).not.toBeDisabled();

    await dropSubmitBtn.click();

    // Modal should close
    await expect(page.getByRole("heading", { name: "Drop Collection" })).not.toBeVisible();
  });

  test("should open the aggregation builder, compose stages, and run the pipeline", async ({ page }) => {
    // 1. Connect
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // 2. Select database and collection in sidebar
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();

    const sidebar = page.locator("div.w-80");
    const collectionBtn = sidebar.getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // 3. Switch to Aggregations sub-tab
    const aggTabBtn = page.getByRole("button", { name: "Aggregations" });
    await expect(aggTabBtn).toBeVisible();
    await aggTabBtn.click();

    // 4. Verify builder renders
    await expect(page.locator("text=Aggregation Pipeline Builder")).toBeVisible();
    await expect(page.locator("text=Add Stage")).toBeVisible();
    await expect(page.locator("text=Stage 1")).toBeVisible();

    // Verify stage output preview shows mocked data
    await expect(page.locator("text=aggregated")).toBeVisible();
    await expect(page.locator("text=Premium Laptop")).toBeVisible();

    // 5. Change stage operator
    const selectOperator = page.locator("select").first();
    await selectOperator.selectOption("$group");

    // 6. Click Add Stage
    await page.click("button:has-text('Add Stage')");
    await expect(page.locator("text=Stage 2")).toBeVisible();

    // 7. Run Entire Pipeline
    await page.click("button:has-text('Run Pipeline')");

    // Verify final pipeline output renders
    await expect(page.locator("text=Pipeline Final Output (Preview)")).toBeVisible();
    await expect(page.locator("text=1 documents returned")).toBeVisible();
  });

  test("should focus filter input when Ctrl+K is pressed", async ({ page }) => {
    await page.click("button:has-text('Connect')");
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();
    
    const filterInput = page.getByPlaceholder("e.g. { \"status\": \"active\" }");
    await expect(filterInput).not.toBeFocused();
    
    await page.keyboard.press("Control+k");
    await expect(filterInput).toBeFocused();
  });

  test("should log queries and support replaying them", async ({ page }) => {
    await page.click("button:has-text('Connect')");
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();
    
    // Run search query
    const filterInput = page.getByPlaceholder("e.g. { \"status\": \"active\" }");
    await filterInput.fill('{"name": "Laptop"}');
    await page.click("button:has-text('Find')");
    
    // Switch to Query Log view
    const queryLogTabBtn = page.getByRole("button", { name: "Query Log" });
    await expect(queryLogTabBtn).toBeVisible();
    await queryLogTabBtn.click();
    
    // Check it displays the logged query details
    await expect(page.locator("strong:has-text('users_db.users')")).toBeVisible();
    await expect(page.locator("text=Laptop")).toBeVisible();
    
    // Click replay query
    await page.click("button:has-text('Replay Query')");
    
    // Check it switches back to explorer and filter is populated
    await expect(page.locator("text=users_db.users")).toBeVisible();
    await expect(filterInput).toHaveValue('{"name": "Laptop"}');
  });

  test("should list active operations and support killing them", async ({ page }) => {
    // 1. Connect
    await page.click("button:has-text('Connect')");
    await expect(page.locator("text=Welcome to Compass+")).toBeVisible();

    // 2. Select database and collection in sidebar
    const dbBtn = page.getByRole("button", { name: "users_db", exact: true });
    await dbBtn.click();
    const collectionBtn = page.locator("div.w-80").getByRole("button", { name: "users", exact: true });
    await collectionBtn.click();

    // 3. Switch to Investigate tab
    const investigateTabBtn = page.getByRole("button", { name: "Investigate" });
    await expect(investigateTabBtn).toBeVisible();
    await investigateTabBtn.click();

    // 4. Switch to active operations sub-tab
    const opsSubTabBtn = page.getByRole("button", { name: "Current Database Operations" });
    await expect(opsSubTabBtn).toBeVisible();
    await opsSubTabBtn.click();

    // 5. Verify the active operation details are displayed
    const opCard = page.locator(".bg-white", { hasText: "OPID: 7777" });
    await expect(opCard).toBeVisible();
    await expect(opCard.locator("text=users_db.users")).toBeVisible();
    await expect(opCard.locator("text=127.0.0.1:9999")).toBeVisible();
    await expect(opCard.locator("text=Running for 15s")).toBeVisible();

    // 6. Click "Kill Op" and verify it triggers a confirmation dialog
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to kill operation 7777?");
      await dialog.accept();
    });

    await page.click("button:has-text('Kill Op')");
  });
});
