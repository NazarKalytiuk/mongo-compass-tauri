/**
 * Hand-authored MongoDB completion dictionary.
 *
 * This replaces the `@mongodb-js/mongodb-constants` package: it is our own,
 * curated list of pipeline stages, query operators, accumulators, expression
 * operators, BSON-type constructors and system variables, each with a short
 * description and (optionally) the minimum server version that introduced it.
 *
 * The data here is conceptually equivalent to what MongoDB Compass ships, but
 * is written from scratch so we carry no external MongoDB packages.
 */

export type MongoMeta =
  | "stage"
  | "query-operator"
  | "accumulator"
  | "expr-operator"
  | "conversion"
  | "bson-type"
  | "system-variable";

export interface MongoCompletion {
  /** The token as it appears in code, e.g. "$match", "$gte", "ObjectId". */
  name: string;
  meta: MongoMeta;
  /** Short human-readable description, shown as the completion detail. */
  description: string;
  /** Minimum server version that introduced this token (semver), optional. */
  version?: string;
}

/** Aggregation pipeline stages. */
const STAGES: MongoCompletion[] = [
  { name: "$match", meta: "stage", description: "Filters documents to pass only matching ones" },
  { name: "$group", meta: "stage", description: "Groups documents by an identifier expression" },
  { name: "$project", meta: "stage", description: "Reshapes documents (add, rename, remove fields)" },
  { name: "$sort", meta: "stage", description: "Reorders the document stream by a sort key" },
  { name: "$limit", meta: "stage", description: "Passes the first N documents to the next stage" },
  { name: "$skip", meta: "stage", description: "Skips the first N documents in the stream" },
  { name: "$unwind", meta: "stage", description: "Deconstructs an array field into documents" },
  { name: "$lookup", meta: "stage", description: "Performs a left outer join to another collection" },
  { name: "$addFields", meta: "stage", description: "Adds new fields to documents", version: "3.4.0" },
  { name: "$set", meta: "stage", description: "Adds or overwrites fields (alias of $addFields)", version: "4.2.0" },
  { name: "$unset", meta: "stage", description: "Removes fields from documents", version: "4.2.0" },
  { name: "$count", meta: "stage", description: "Returns a count of the input documents", version: "3.4.0" },
  { name: "$replaceRoot", meta: "stage", description: "Replaces the document with a sub-document", version: "3.4.0" },
  { name: "$replaceWith", meta: "stage", description: "Replaces the document (alias of $replaceRoot)", version: "4.2.0" },
  { name: "$facet", meta: "stage", description: "Runs multiple sub-pipelines in one stage", version: "3.4.0" },
  { name: "$bucket", meta: "stage", description: "Groups documents into buckets by boundaries", version: "3.4.0" },
  { name: "$bucketAuto", meta: "stage", description: "Auto-distributes documents into buckets", version: "3.4.0" },
  { name: "$sortByCount", meta: "stage", description: "Groups and counts by expression, sorted", version: "3.4.0" },
  { name: "$unionWith", meta: "stage", description: "Combines pipeline with another collection", version: "4.4.0" },
  { name: "$setWindowFields", meta: "stage", description: "Computes window-function output over partitions", version: "5.0.0" },
  { name: "$densify", meta: "stage", description: "Fills gaps in a sequence of documents", version: "5.1.0" },
  { name: "$fill", meta: "stage", description: "Populates null and missing field values", version: "5.3.0" },
  { name: "$graphLookup", meta: "stage", description: "Performs a recursive graph search", version: "3.4.0" },
  { name: "$geoNear", meta: "stage", description: "Returns documents ordered by proximity" },
  { name: "$sample", meta: "stage", description: "Randomly selects N documents", version: "3.2.0" },
  { name: "$out", meta: "stage", description: "Writes pipeline results to a collection" },
  { name: "$merge", meta: "stage", description: "Merges results into a collection", version: "4.2.0" },
  { name: "$redact", meta: "stage", description: "Restricts content based on document data" },
  { name: "$indexStats", meta: "stage", description: "Returns index usage statistics" },
  { name: "$collStats", meta: "stage", description: "Returns collection statistics", version: "3.4.0" },
];

/** Query / match operators (used in $match and find filters). */
const QUERY_OPERATORS: MongoCompletion[] = [
  { name: "$eq", meta: "query-operator", description: "Matches values equal to a value" },
  { name: "$ne", meta: "query-operator", description: "Matches values not equal to a value" },
  { name: "$gt", meta: "query-operator", description: "Matches values greater than a value" },
  { name: "$gte", meta: "query-operator", description: "Matches values greater than or equal" },
  { name: "$lt", meta: "query-operator", description: "Matches values less than a value" },
  { name: "$lte", meta: "query-operator", description: "Matches values less than or equal" },
  { name: "$in", meta: "query-operator", description: "Matches any value in an array" },
  { name: "$nin", meta: "query-operator", description: "Matches none of the values in an array" },
  { name: "$and", meta: "query-operator", description: "Joins clauses with a logical AND" },
  { name: "$or", meta: "query-operator", description: "Joins clauses with a logical OR" },
  { name: "$nor", meta: "query-operator", description: "Joins clauses with a logical NOR" },
  { name: "$not", meta: "query-operator", description: "Inverts the effect of a query expression" },
  { name: "$exists", meta: "query-operator", description: "Matches documents that have the field" },
  { name: "$type", meta: "query-operator", description: "Matches documents by BSON type" },
  { name: "$regex", meta: "query-operator", description: "Matches values by regular expression" },
  { name: "$expr", meta: "query-operator", description: "Allows aggregation expressions in a query", version: "3.6.0" },
  { name: "$mod", meta: "query-operator", description: "Matches values by modulo result" },
  { name: "$text", meta: "query-operator", description: "Performs a text search" },
  { name: "$where", meta: "query-operator", description: "Matches documents with a JS expression" },
  { name: "$all", meta: "query-operator", description: "Matches arrays containing all elements" },
  { name: "$elemMatch", meta: "query-operator", description: "Matches arrays with a matching element" },
  { name: "$size", meta: "query-operator", description: "Matches arrays of a given length" },
  { name: "$geoWithin", meta: "query-operator", description: "Matches geometries within a shape" },
  { name: "$geoIntersects", meta: "query-operator", description: "Matches geometries that intersect" },
  { name: "$near", meta: "query-operator", description: "Matches points near a point" },
  { name: "$nearSphere", meta: "query-operator", description: "Matches points near a point (spherical)" },
  { name: "$jsonSchema", meta: "query-operator", description: "Matches documents against a JSON schema", version: "3.6.0" },
];

/** Accumulator operators (used in $group, $project, $setWindowFields, ...). */
const ACCUMULATORS: MongoCompletion[] = [
  { name: "$sum", meta: "accumulator", description: "Sums numeric values" },
  { name: "$avg", meta: "accumulator", description: "Returns the average of numeric values" },
  { name: "$min", meta: "accumulator", description: "Returns the minimum value" },
  { name: "$max", meta: "accumulator", description: "Returns the maximum value" },
  { name: "$first", meta: "accumulator", description: "Returns the first value in a group" },
  { name: "$last", meta: "accumulator", description: "Returns the last value in a group" },
  { name: "$push", meta: "accumulator", description: "Appends values to an array" },
  { name: "$addToSet", meta: "accumulator", description: "Appends unique values to an array" },
  { name: "$count", meta: "accumulator", description: "Counts documents in a group", version: "5.0.0" },
  { name: "$stdDevPop", meta: "accumulator", description: "Population standard deviation", version: "3.2.0" },
  { name: "$stdDevSamp", meta: "accumulator", description: "Sample standard deviation", version: "3.2.0" },
  { name: "$mergeObjects", meta: "accumulator", description: "Merges documents into one", version: "3.6.0" },
  { name: "$accumulator", meta: "accumulator", description: "User-defined JS accumulator", version: "4.4.0" },
  { name: "$top", meta: "accumulator", description: "Top element by sort order", version: "5.2.0" },
  { name: "$topN", meta: "accumulator", description: "Top N elements by sort order", version: "5.2.0" },
  { name: "$bottom", meta: "accumulator", description: "Bottom element by sort order", version: "5.2.0" },
  { name: "$bottomN", meta: "accumulator", description: "Bottom N elements by sort order", version: "5.2.0" },
];

/** Expression operators (used inside $project, $addFields, $group values, ...). */
const EXPRESSION_OPERATORS: MongoCompletion[] = [
  // Arithmetic
  { name: "$add", meta: "expr-operator", description: "Adds numbers or dates" },
  { name: "$subtract", meta: "expr-operator", description: "Subtracts two values" },
  { name: "$multiply", meta: "expr-operator", description: "Multiplies numbers" },
  { name: "$divide", meta: "expr-operator", description: "Divides two numbers" },
  { name: "$mod", meta: "expr-operator", description: "Returns the remainder" },
  { name: "$abs", meta: "expr-operator", description: "Absolute value", version: "3.2.0" },
  { name: "$ceil", meta: "expr-operator", description: "Rounds up to the next integer", version: "3.2.0" },
  { name: "$floor", meta: "expr-operator", description: "Rounds down to the previous integer", version: "3.2.0" },
  { name: "$round", meta: "expr-operator", description: "Rounds to a given decimal place", version: "4.2.0" },
  { name: "$trunc", meta: "expr-operator", description: "Truncates to an integer" },
  { name: "$pow", meta: "expr-operator", description: "Raises to a power", version: "3.2.0" },
  { name: "$sqrt", meta: "expr-operator", description: "Square root", version: "3.2.0" },
  // String
  { name: "$concat", meta: "expr-operator", description: "Concatenates strings" },
  { name: "$substr", meta: "expr-operator", description: "Returns a substring" },
  { name: "$substrCP", meta: "expr-operator", description: "Substring by code points", version: "3.4.0" },
  { name: "$toLower", meta: "expr-operator", description: "Converts a string to lowercase" },
  { name: "$toUpper", meta: "expr-operator", description: "Converts a string to uppercase" },
  { name: "$trim", meta: "expr-operator", description: "Trims whitespace", version: "4.0.0" },
  { name: "$split", meta: "expr-operator", description: "Splits a string into an array", version: "3.4.0" },
  { name: "$strLenCP", meta: "expr-operator", description: "String length in code points", version: "3.4.0" },
  { name: "$regexMatch", meta: "expr-operator", description: "Tests a string against a regex", version: "4.2.0" },
  { name: "$regexFind", meta: "expr-operator", description: "Returns the first regex match", version: "4.2.0" },
  { name: "$replaceOne", meta: "expr-operator", description: "Replaces the first match", version: "4.4.0" },
  { name: "$replaceAll", meta: "expr-operator", description: "Replaces all matches", version: "4.4.0" },
  { name: "$concatArrays", meta: "expr-operator", description: "Concatenates arrays", version: "3.2.0" },
  // Conditional / logical
  { name: "$cond", meta: "expr-operator", description: "If/then/else conditional" },
  { name: "$ifNull", meta: "expr-operator", description: "Returns a replacement for null" },
  { name: "$switch", meta: "expr-operator", description: "Multi-branch conditional", version: "3.4.0" },
  { name: "$and", meta: "expr-operator", description: "Logical AND of expressions" },
  { name: "$or", meta: "expr-operator", description: "Logical OR of expressions" },
  { name: "$not", meta: "expr-operator", description: "Logical NOT of an expression" },
  { name: "$eq", meta: "expr-operator", description: "Compares for equality" },
  { name: "$ne", meta: "expr-operator", description: "Compares for inequality" },
  { name: "$gt", meta: "expr-operator", description: "Greater-than comparison" },
  { name: "$gte", meta: "expr-operator", description: "Greater-than-or-equal comparison" },
  { name: "$lt", meta: "expr-operator", description: "Less-than comparison" },
  { name: "$lte", meta: "expr-operator", description: "Less-than-or-equal comparison" },
  { name: "$cmp", meta: "expr-operator", description: "Compares two values (-1/0/1)" },
  // Array
  { name: "$map", meta: "expr-operator", description: "Applies an expression to each element" },
  { name: "$filter", meta: "expr-operator", description: "Filters array elements", version: "3.2.0" },
  { name: "$reduce", meta: "expr-operator", description: "Reduces an array to a value", version: "3.4.0" },
  { name: "$size", meta: "expr-operator", description: "Returns the array length" },
  { name: "$arrayElemAt", meta: "expr-operator", description: "Element at an array index", version: "3.2.0" },
  { name: "$slice", meta: "expr-operator", description: "Returns a subset of an array" },
  { name: "$in", meta: "expr-operator", description: "Checks array membership", version: "3.4.0" },
  { name: "$indexOfArray", meta: "expr-operator", description: "Index of an array element", version: "3.4.0" },
  { name: "$range", meta: "expr-operator", description: "Generates a numeric sequence", version: "3.4.0" },
  { name: "$zip", meta: "expr-operator", description: "Transposes arrays", version: "3.4.0" },
  { name: "$first", meta: "expr-operator", description: "First element of an array", version: "4.4.0" },
  { name: "$last", meta: "expr-operator", description: "Last element of an array", version: "4.4.0" },
  { name: "$sortArray", meta: "expr-operator", description: "Sorts array elements", version: "5.2.0" },
  // Object / variables
  { name: "$mergeObjects", meta: "expr-operator", description: "Merges documents into one", version: "3.6.0" },
  { name: "$objectToArray", meta: "expr-operator", description: "Converts a document to k/v array", version: "3.4.0" },
  { name: "$arrayToObject", meta: "expr-operator", description: "Converts a k/v array to a document", version: "3.4.0" },
  { name: "$let", meta: "expr-operator", description: "Binds variables for an expression" },
  { name: "$getField", meta: "expr-operator", description: "Reads a field value", version: "5.0.0" },
  { name: "$setField", meta: "expr-operator", description: "Sets a field value", version: "5.0.0" },
  // Date
  { name: "$dateToString", meta: "expr-operator", description: "Formats a date as a string" },
  { name: "$dateFromString", meta: "expr-operator", description: "Parses a date from a string", version: "3.6.0" },
  { name: "$dateFromParts", meta: "expr-operator", description: "Builds a date from parts", version: "3.6.0" },
  { name: "$dateAdd", meta: "expr-operator", description: "Adds a time unit to a date", version: "5.0.0" },
  { name: "$dateDiff", meta: "expr-operator", description: "Difference between two dates", version: "5.0.0" },
  { name: "$dateTrunc", meta: "expr-operator", description: "Truncates a date to a unit", version: "5.0.0" },
  { name: "$year", meta: "expr-operator", description: "Year of a date" },
  { name: "$month", meta: "expr-operator", description: "Month of a date" },
  { name: "$dayOfMonth", meta: "expr-operator", description: "Day of month of a date" },
  { name: "$hour", meta: "expr-operator", description: "Hour of a date" },
  { name: "$minute", meta: "expr-operator", description: "Minute of a date" },
  { name: "$second", meta: "expr-operator", description: "Second of a date" },
  { name: "$week", meta: "expr-operator", description: "Week of a date" },
  { name: "$dayOfWeek", meta: "expr-operator", description: "Day of week of a date" },
];

/** Type-conversion operators. */
const CONVERSIONS: MongoCompletion[] = [
  { name: "$convert", meta: "conversion", description: "Converts a value to a type", version: "4.0.0" },
  { name: "$toString", meta: "conversion", description: "Converts a value to a string", version: "4.0.0" },
  { name: "$toInt", meta: "conversion", description: "Converts a value to an integer", version: "4.0.0" },
  { name: "$toLong", meta: "conversion", description: "Converts a value to a long", version: "4.0.0" },
  { name: "$toDouble", meta: "conversion", description: "Converts a value to a double", version: "4.0.0" },
  { name: "$toDecimal", meta: "conversion", description: "Converts a value to a decimal", version: "4.0.0" },
  { name: "$toBool", meta: "conversion", description: "Converts a value to a boolean", version: "4.0.0" },
  { name: "$toDate", meta: "conversion", description: "Converts a value to a date", version: "4.0.0" },
  { name: "$toObjectId", meta: "conversion", description: "Converts a value to an ObjectId", version: "4.0.0" },
  { name: "$type", meta: "conversion", description: "Returns the BSON type of a value", version: "3.4.0" },
  { name: "$isNumber", meta: "conversion", description: "Checks if a value is numeric", version: "4.4.0" },
];

/** BSON type constructors (mostly useful in shell / mongo-style values). */
const BSON_TYPES: MongoCompletion[] = [
  { name: "ObjectId", meta: "bson-type", description: "Constructs an ObjectId" },
  { name: "ISODate", meta: "bson-type", description: "Constructs a Date from an ISO string" },
  { name: "Date", meta: "bson-type", description: "Constructs a Date" },
  { name: "NumberLong", meta: "bson-type", description: "Constructs a 64-bit integer" },
  { name: "NumberInt", meta: "bson-type", description: "Constructs a 32-bit integer" },
  { name: "NumberDecimal", meta: "bson-type", description: "Constructs a 128-bit decimal" },
  { name: "UUID", meta: "bson-type", description: "Constructs a UUID" },
  { name: "BinData", meta: "bson-type", description: "Constructs binary data" },
  { name: "Timestamp", meta: "bson-type", description: "Constructs a BSON timestamp" },
  { name: "RegExp", meta: "bson-type", description: "Constructs a regular expression" },
  { name: "MinKey", meta: "bson-type", description: "BSON MinKey value" },
  { name: "MaxKey", meta: "bson-type", description: "BSON MaxKey value" },
];

/** Aggregation system variables. */
const SYSTEM_VARIABLES: MongoCompletion[] = [
  { name: "$$NOW", meta: "system-variable", description: "Current datetime value", version: "4.2.0" },
  { name: "$$CLUSTER_TIME", meta: "system-variable", description: "Current cluster time", version: "4.2.0" },
  { name: "$$ROOT", meta: "system-variable", description: "The root document" },
  { name: "$$CURRENT", meta: "system-variable", description: "The current document path" },
  { name: "$$REMOVE", meta: "system-variable", description: "Conditionally excludes a field", version: "3.6.0" },
  { name: "$$DESCEND", meta: "system-variable", description: "$redact: descend into sub-docs" },
  { name: "$$PRUNE", meta: "system-variable", description: "$redact: exclude the sub-doc" },
  { name: "$$KEEP", meta: "system-variable", description: "$redact: keep the sub-doc" },
];

export const MONGODB_COMPLETIONS: MongoCompletion[] = [
  ...STAGES,
  ...QUERY_OPERATORS,
  ...ACCUMULATORS,
  ...EXPRESSION_OPERATORS,
  ...CONVERSIONS,
  ...BSON_TYPES,
  ...SYSTEM_VARIABLES,
];

/** All entries grouped by meta, for fast lookup by the completers. */
export const COMPLETIONS_BY_META: Record<MongoMeta, MongoCompletion[]> = {
  stage: STAGES,
  "query-operator": QUERY_OPERATORS,
  accumulator: ACCUMULATORS,
  "expr-operator": EXPRESSION_OPERATORS,
  conversion: CONVERSIONS,
  "bson-type": BSON_TYPES,
  "system-variable": SYSTEM_VARIABLES,
};
