import { useState } from "react";
import { X, Copy, Check } from "lucide-react";

interface CodeGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbName: string;
  collName: string;
  queryType: "find" | "aggregate";
  queryData: {
    filter?: string;
    sort?: string;
    projection?: string;
    limit?: number;
    skip?: number;
    pipelineStr?: string;
  };
}

type Language = "python" | "node" | "java" | "go" | "csharp";

export default function CodeGeneratorModal({
  isOpen,
  onClose,
  dbName,
  collName,
  queryType,
  queryData,
}: CodeGeneratorModalProps) {
  const [selectedLang, setSelectedLang] = useState<Language>("python");
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const getCleanJson = (str?: string) => {
    if (!str) return "{}";
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch (e) {
      return str;
    }
  };

  const getCodeSnippet = (): string => {
    const filter = getCleanJson(queryData.filter);
    const sort = getCleanJson(queryData.sort);
    const projection = getCleanJson(queryData.projection);
    const limit = queryData.limit || 0;
    const skip = queryData.skip || 0;
    const pipeline = getCleanJson(queryData.pipelineStr);

    if (queryType === "find") {
      switch (selectedLang) {
        case "python":
          return `from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient("mongodb://localhost:27017/")
db = client["${dbName}"]
collection = db["${collName}"]

# Query parameters
filter_query = ${filter.replace(/\n/g, "\n").replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")}
sort_query = ${sort.replace(/\n/g, "\n").replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")}
projection_query = ${projection.replace(/\n/g, "\n").replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")}

# Execute query
cursor = collection.find(filter_query, projection_query)
if sort_query:
    cursor = cursor.sort(list(sort_query.items()))
if ${skip} > 0:
    cursor = cursor.skip(${skip})
if ${limit} > 0:
    cursor = cursor.limit(${limit})

for doc in cursor:
    print(doc)`;

        case "node":
          return `const { MongoClient } = require('mongodb');

async function run() {
  const uri = "mongodb://localhost:27017/";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const database = client.db('${dbName}');
    const collection = database.collection('${collName}');

    const query = ${filter.split("\n").join("\n    ")};
    const options = {
      projection: ${projection.split("\n").join("\n      ")},
      sort: ${sort.split("\n").join("\n      ")},
      limit: ${limit},
      skip: ${skip}
    };

    const cursor = collection.find(query, options);
    await cursor.forEach(doc => console.dir(doc));
  } finally {
    await client.close();
  }
}
run().catch(console.dir);`;

        case "java":
          return `import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.FindIterable;
import org.bson.Document;
import org.bson.conversions.Bson;

public class App {
    public static void main(String[] args) {
        try (MongoClient mongoClient = MongoClients.create("mongodb://localhost:27017/")) {
            MongoDatabase database = mongoClient.getDatabase("${dbName}");
            MongoCollection<Document> collection = database.getCollection("${collName}");

            Bson filter = Document.parse("${filter.replace(/"/g, "\\\"").replace(/\n/g, "")}");
            Bson sort = Document.parse("${sort.replace(/"/g, "\\\"").replace(/\n/g, "")}");
            Bson projection = Document.parse("${projection.replace(/"/g, "\\\"").replace(/\n/g, "")}");

            FindIterable<Document> docs = collection.find(filter)
                .projection(projection)
                .sort(sort)
                .skip(${skip})
                .limit(${limit});

            for (Document doc : docs) {
                System.out.println(doc.toJson());
            }
        }
    }
}`;

        case "go":
          return `package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://localhost:27017/"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Disconnect(ctx)

	collection := client.Database("${dbName}").Collection("${collName}")

	var filter bson.M
	if err := bson.UnmarshalExtJSON([]byte(\`${filter}\`), true, &filter); err != nil {
		log.Fatal(err)
	}

	var sort bson.M
	if err := bson.UnmarshalExtJSON([]byte(\`${sort}\`), true, &sort); err != nil {
		log.Fatal(err)
	}

	var projection bson.M
	if err := bson.UnmarshalExtJSON([]byte(\`${projection}\`), true, &projection); err != nil {
		log.Fatal(err)
	}

	findOptions := options.Find()
	findOptions.SetSort(sort)
	findOptions.SetProjection(projection)
	findOptions.SetLimit(${limit})
	findOptions.SetSkip(${skip})

	cursor, err := collection.Find(ctx, filter, findOptions)
	if err != nil {
		log.Fatal(err)
	}
	defer cursor.Close(ctx)

	for cursor.Next(ctx) {
		var result bson.M
		if err := cursor.Decode(&result); err != nil {
			log.Fatal(err)
		}
		fmt.Println(result)
	}
}`;

        case "csharp":
          return `using MongoDB.Bson;
using MongoDB.Driver;
using System;
using System.Threading.Tasks;

class Program
{
    static async Task Main(string[] args)
    {
        var client = new MongoClient("mongodb://localhost:27017/");
        var database = client.GetDatabase("${dbName}");
        var collection = database.GetCollection<BsonDocument>("${collName}");

        var filter = BsonDocument.Parse(@"${filter}");
        var sort = BsonDocument.Parse(@"${sort}");
        var projection = BsonDocument.Parse(@"${projection}");

        var findOptions = new FindOptions<BsonDocument, BsonDocument>
        {
            Sort = sort,
            Projection = projection,
            Limit = ${limit},
            Skip = ${skip}
        };

        using (var cursor = await collection.FindAsync(filter, findOptions))
        {
            while (await cursor.MoveNextAsync())
            {
                foreach (var doc in cursor.Current)
                {
                    Console.WriteLine(doc.ToJson());
                }
            }
        }
    }
}`;
      }
    } else {
      // Aggregation Pipeline
      switch (selectedLang) {
        case "python":
          return `from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient("mongodb://localhost:27017/")
db = client["${dbName}"]
collection = db["${collName}"]

# Aggregation pipeline
pipeline = ${pipeline.replace(/\n/g, "\n").replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None")}

# Execute aggregation
cursor = collection.aggregate(pipeline)

for doc in cursor:
    print(doc)`;

        case "node":
          return `const { MongoClient } = require('mongodb');

async function run() {
  const uri = "mongodb://localhost:27017/";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const database = client.db('${dbName}');
    const collection = database.collection('${collName}');

    const pipeline = ${pipeline.split("\n").join("\n    ")};

    const cursor = collection.aggregate(pipeline);
    await cursor.forEach(doc => console.dir(doc));
  } finally {
    await client.close();
  }
}
run().catch(console.dir);`;

        case "java":
          return `import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.AggregateIterable;
import org.bson.Document;
import java.util.List;

public class App {
    public static void main(String[] args) {
        try (MongoClient mongoClient = MongoClients.create("mongodb://localhost:27017/")) {
            MongoDatabase database = mongoClient.getDatabase("${dbName}");
            MongoCollection<Document> collection = database.getCollection("${collName}");

            String pipelineJson = "{\\"pipeline\\": ${pipeline.replace(/"/g, "\\\"").replace(/\n/g, "")}}";
            @SuppressWarnings("unchecked")
            List<Document> pipeline = (List<Document>) Document.parse(pipelineJson).get("pipeline");

            AggregateIterable<Document> results = collection.aggregate(pipeline);

            for (Document doc : results) {
                System.out.println(doc.toJson());
            }
        }
    }
}`;

        case "go":
          return `package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://localhost:27017/"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Disconnect(ctx)

	collection := client.Database("${dbName}").Collection("${collName}")

	var pipeline []bson.D
	if err := bson.UnmarshalExtJSON([]byte(\`${pipeline}\`), true, &pipeline); err != nil {
		log.Fatal(err)
	}

	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		log.Fatal(err)
	}
	defer cursor.Close(ctx)

	for cursor.Next(ctx) {
		var result bson.M
		if err := cursor.Decode(&result); err != nil {
			log.Fatal(err)
		}
		fmt.Println(result)
	}
}`;

        case "csharp":
          return `using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using System;
using System.Linq;
using System.Threading.Tasks;

class Program
{
    static async Task Main(string[] args)
    {
        var client = new MongoClient("mongodb://localhost:27017/");
        var database = client.GetDatabase("${dbName}");
        var collection = database.GetCollection<BsonDocument>("${collName}");

        var pipelineJson = @"${pipeline}";
        var pipeline = BsonSerializer.Deserialize<BsonArray>(pipelineJson)
            .Select(p => p.AsBsonDocument)
            .ToList();

        using (var cursor = await collection.AggregateAsync<BsonDocument>(pipeline))
        {
            while (await cursor.MoveNextAsync())
            {
                foreach (var doc in cursor.Current)
                {
                    Console.WriteLine(doc.ToJson());
                }
            }
        }
    }
}`;
      }
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCodeSnippet());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-[#1B1F27] rounded-xl shadow-2xl border border-[#232833] overflow-hidden flex flex-col max-h-[80vh] text-[#E6E6E6]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#111827] border-b border-[#232833]">
          <div className="flex flex-col">
            <h3 className="font-bold text-sm text-white">
              Generate Target Code
            </h3>
            <p className="text-[10px] text-[#8A93A2]">
              Copy-pasteable driver code for query in {dbName}.{collName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#232833] rounded-md text-[#8A93A2] transition-colors"
          >
            <X className="w-4 h-4 text-[#8A93A2]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#232833] bg-[#111827] px-2">
          {([
            { id: "python", label: "Python (PyMongo)" },
            { id: "node", label: "JavaScript (Node)" },
            { id: "java", label: "Java" },
            { id: "go", label: "Go" },
            { id: "csharp", label: "C#" },
          ] as const).map((lang) => (
            <button
              key={lang.id}
              onClick={() => setSelectedLang(lang.id)}
              className={`px-4 py-2 text-xs font-bold transition-all border-b-2 ${
                selectedLang === lang.id
                  ? "border-b-[#F2673C] text-white"
                  : "border-b-transparent text-[#8A93A2] hover:text-white"
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Code Block Container */}
        <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4 bg-[#161a22]">
          <div className="flex-1 rounded-lg overflow-hidden border border-[#232833] bg-[#1B1F27] p-4 relative flex flex-col">
            <button
              onClick={handleCopy}
              className="absolute right-4 top-4 px-3 py-1.5 bg-[#232833] hover:bg-[#2c3340] border border-[#303746] rounded-md text-[10px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer text-[#E6E6E6]"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy Code
                </>
              )}
            </button>
            <pre className="text-xs font-mono overflow-auto select-text leading-relaxed whitespace-pre pr-24 pt-2">
              {getCodeSnippet()}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-[#111827] border-t border-[#232833]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#232833] hover:bg-[#2c3340] text-white font-bold text-xs rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
