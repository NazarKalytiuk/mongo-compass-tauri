import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CodeGeneratorModal from "../CodeGeneratorModal";

// Mock clipboard API
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn() },
  writable: true,
});

describe("CodeGeneratorModal", () => {
  const defaultQueryData = {
    filter: '{"status": "active"}',
    sort: '{"name": 1}',
    projection: '{"name": 1, "age": 1}',
    limit: 10,
    skip: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Visibility ───────────────────────────────────────────────────────────────

  it("does not render when isOpen is false", () => {
    render(
      <CodeGeneratorModal
        isOpen={false}
        onClose={() => {}}
        dbName="test_db"
        collName="users"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    expect(screen.queryByText("Generate Target Code")).not.toBeInTheDocument();
  });

  it("renders when isOpen is true", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="test_db"
        collName="users"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    expect(screen.getByText("Generate Target Code")).toBeInTheDocument();
  });

  // ── Close button ─────────────────────────────────────────────────────────────

  it("calls onClose when the X button is clicked", () => {
    const mockOnClose = vi.fn();
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={mockOnClose}
        dbName="test_db"
        collName="users"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    const closeButtons = screen.getAllByRole("button").filter((b) =>
      b.querySelector("svg")
    );
    // The first button with SVG in the header is the X close button
    fireEvent.click(closeButtons[0]);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the footer Close button is clicked", () => {
    const mockOnClose = vi.fn();
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={mockOnClose}
        dbName="test_db"
        collName="users"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    const footerClose = screen.getByRole("button", { name: "Close" });
    fireEvent.click(footerClose);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // ── Copy to clipboard ─────────────────────────────────────────────────────────

  it("copies code to clipboard and shows Copied! state, then resets after 2s", async () => {
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);

    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="test_db"
        collName="users"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    const copyBtn = screen.getByRole("button", { name: /Copy Code/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: /Copy Code/i })).toBeInTheDocument();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });

  // ── Python / Find (default) ───────────────────────────────────────────────────

  it("renders Python find snippet by default with dbName and collName", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="customers"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    expect(screen.getByText("Generate Target Code")).toBeInTheDocument();
    expect(screen.getByText("Copy Code")).toBeInTheDocument();

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain('client["my_db"]');
    expect(codeContainer?.textContent).toContain('collection = db["customers"]');
    expect(codeContainer?.textContent).toContain("cursor.skip(5)");
    expect(codeContainer?.textContent).toContain("cursor.limit(10)");
    expect(codeContainer?.textContent).toContain("from pymongo import MongoClient");
  });

  // ── getCleanJson: invalid JSON returns raw string ────────────────────────────

  it("renders with invalid filter/sort/projection strings without throwing", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="db"
        collName="coll"
        queryType="find"
        queryData={{
          filter: "not valid json",
          sort: "{bad}",
          projection: undefined,
        }}
      />
    );

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("not valid json");
    // undefined projection falls back to {}
    expect(codeContainer?.textContent).toContain("{}");
  });

  // ── getCleanJson: missing queryData fields default to 0 / {} ─────────────────

  it("uses 0 for missing limit/skip and {} for missing filter/sort/projection", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="db"
        collName="coll"
        queryType="find"
        queryData={{}}
      />
    );

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("{}");
  });

  // ── Node.js / Find ────────────────────────────────────────────────────────────

  it("switches to Node.js tab and renders find snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="customers"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "JavaScript (Node)" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("const { MongoClient } = require('mongodb')");
    expect(codeContainer?.textContent).toContain("client.db('my_db')");
    expect(codeContainer?.textContent).toContain("database.collection('customers')");
  });

  // ── Java / Find ───────────────────────────────────────────────────────────────

  it("switches to Java tab and renders find snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="customers"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Java" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("import com.mongodb.client.MongoClients");
    expect(codeContainer?.textContent).toContain('getDatabase("my_db")');
    expect(codeContainer?.textContent).toContain('getCollection("customers")');
    expect(codeContainer?.textContent).toContain("FindIterable<Document>");
  });

  // ── Go / Find ─────────────────────────────────────────────────────────────────

  it("switches to Go tab and renders find snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="customers"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain('package main');
    expect(codeContainer?.textContent).toContain('"my_db"');
    expect(codeContainer?.textContent).toContain('"customers"');
    expect(codeContainer?.textContent).toContain("go.mongodb.org/mongo-driver/mongo");
    expect(codeContainer?.textContent).toContain("findOptions");
  });

  // ── C# / Find ─────────────────────────────────────────────────────────────────

  it("switches to C# tab and renders find snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="customers"
        queryType="find"
        queryData={defaultQueryData}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "C#" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("using MongoDB.Bson");
    expect(codeContainer?.textContent).toContain('GetDatabase("my_db")');
    expect(codeContainer?.textContent).toContain('GetCollection<BsonDocument>("customers")');
    expect(codeContainer?.textContent).toContain("FindOptions<BsonDocument, BsonDocument>");
  });

  // ── Python / Aggregate ────────────────────────────────────────────────────────

  it("renders Python aggregate snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="orders"
        queryType="aggregate"
        queryData={{ pipelineStr: '[{"$match": {"status": "active"}}]' }}
      />
    );

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("from pymongo import MongoClient");
    expect(codeContainer?.textContent).toContain('client["my_db"]');
    expect(codeContainer?.textContent).toContain('collection.aggregate(pipeline)');
  });

  // ── Node.js / Aggregate ───────────────────────────────────────────────────────

  it("switches to Node.js tab and renders aggregate snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="orders"
        queryType="aggregate"
        queryData={{ pipelineStr: '[{"$match": {"status": "active"}}]' }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "JavaScript (Node)" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("const { MongoClient } = require('mongodb')");
    expect(codeContainer?.textContent).toContain("collection.aggregate(pipeline)");
  });

  // ── Java / Aggregate ──────────────────────────────────────────────────────────

  it("switches to Java tab and renders aggregate snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="orders"
        queryType="aggregate"
        queryData={{ pipelineStr: '[{"$match": {"status": "active"}}]' }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Java" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("AggregateIterable<Document>");
    expect(codeContainer?.textContent).toContain("collection.aggregate(pipeline)");
  });

  // ── Go / Aggregate ────────────────────────────────────────────────────────────

  it("switches to Go tab and renders aggregate snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="orders"
        queryType="aggregate"
        queryData={{ pipelineStr: '[{"$match": {"status": "active"}}]' }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("package main");
    expect(codeContainer?.textContent).toContain("collection.Aggregate(ctx, pipeline)");
  });

  // ── C# / Aggregate ────────────────────────────────────────────────────────────

  it("switches to C# tab and renders aggregate snippet", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="my_db"
        collName="orders"
        queryType="aggregate"
        queryData={{ pipelineStr: '[{"$match": {"status": "active"}}]' }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "C#" }));

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    expect(codeContainer?.textContent).toContain("using MongoDB.Bson");
    expect(codeContainer?.textContent).toContain("BsonSerializer");
    expect(codeContainer?.textContent).toContain("collection.AggregateAsync<BsonDocument>");
  });

  // ── Header shows db.collection ───────────────────────────────────────────────

  it("shows dbName.collName in header subtitle", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="analytics"
        collName="events"
        queryType="find"
        queryData={{}}
      />
    );

    expect(screen.getByText(/analytics\.events/)).toBeInTheDocument();
  });

  // ── Tab active state ─────────────────────────────────────────────────────────

  it("highlights the selected language tab", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="db"
        collName="coll"
        queryType="find"
        queryData={{}}
      />
    );

    const goTab = screen.getByRole("button", { name: "Go" });
    fireEvent.click(goTab);

    // After click, the Go tab has the active border colour class
    expect(goTab.className).toContain("border-b-[#F2673C]");
    expect(goTab.className).toContain("text-white");
  });

  // ── getCleanJson: valid JSON round-trips correctly ────────────────────────────

  it("formats valid JSON filter using getCleanJson (indents correctly)", () => {
    render(
      <CodeGeneratorModal
        isOpen={true}
        onClose={() => {}}
        dbName="db"
        collName="coll"
        queryType="find"
        queryData={{ filter: '{"x":1}', sort: "{}", projection: "{}" }}
      />
    );

    const codeContainer = screen.getByRole("button", { name: "Copy Code" }).parentElement;
    // JSON.stringify with 2-space indent: "x" key on its own line
    expect(codeContainer?.textContent).toContain('"x": 1');
  });
});
