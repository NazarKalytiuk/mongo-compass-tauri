export interface TypeStats {
  type: string;
  count: number;
  min?: number;
  max?: number;
  mean?: number;
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
  distinctCount: number;
  topValues: Array<{ value: string; count: number; percentage: number }>;
}

export interface FieldAnalysis {
  path: string;
  occurrences: number;
  percentage: number; // occurrences / totalDocs
  types: TypeStats[];
  warnings: string[];
  depth: number;
  comparison?: 'new' | 'removed' | 'type_changed' | 'unchanged';
  prevTypes?: string[];
}

export interface SchemaAnalysisResult {
  totalDocs: number;
  totalFields: number;
  averageDepth: number;
  maxDepth: number;
  mixedTypesCount: number;
  sparsityPercent: number;
  fields: FieldAnalysis[];
}

export function detectType(val: any): string {
  if (val === null || val === undefined) return "Null";
  if (typeof val === "boolean") return "Boolean";
  if (typeof val === "number") return "Number";
  if (Array.isArray(val)) return "Array";
  if (typeof val === "object") {
    if ("$oid" in val) return "ObjectID";
    if ("$date" in val) return "Date";
    if ("$numberLong" in val || "$numberInt" in val || "$numberDouble" in val || "$numberDecimal" in val) return "Number";
    return "Object";
  }
  if (typeof val === "string") return "String";
  return "Unknown";
}

export function getNumericValue(val: any): number {
  if (typeof val === "number") return val;
  if (val && typeof val === "object") {
    if ("$numberLong" in val) return Number(val.$numberLong);
    if ("$numberInt" in val) return Number(val.$numberInt);
    if ("$numberDouble" in val) return Number(val.$numberDouble);
    if ("$numberDecimal" in val) return Number(val.$numberDecimal);
  }
  return 0;
}

export function stringifyValue(val: any): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return `"${val}"`;
  if (val && typeof val === "object") {
    if ("$oid" in val) return `ObjectId("${val.$oid}")`;
    if ("$date" in val) {
      const dateVal = val.$date;
      let dateStr = "";
      if (typeof dateVal === "string") dateStr = dateVal;
      else if (typeof dateVal === "number") dateStr = new Date(dateVal).toISOString();
      else if (dateVal && typeof dateVal === "object" && "$numberLong" in dateVal) {
        dateStr = new Date(Number(dateVal.$numberLong)).toISOString();
      }
      return `ISODate("${dateStr}")`;
    }
    if ("$numberLong" in val) return String(val.$numberLong);
    if ("$numberInt" in val) return String(val.$numberInt);
    if ("$numberDouble" in val) return String(val.$numberDouble);
    if ("$numberDecimal" in val) return String(val.$numberDecimal);
    return JSON.stringify(val);
  }
  return String(val);
}

// Recursively traverse a document and update maps
function traverse(
  val: any,
  path: string,
  docTypes: Map<string, Set<string>>,
  docValues: Map<string, Map<string, any[]>>
) {
  const type = detectType(val);

  if (!docTypes.has(path)) {
    docTypes.set(path, new Set());
  }
  docTypes.get(path)!.add(type);

  if (!docValues.has(path)) {
    docValues.set(path, new Map());
  }
  if (!docValues.get(path)!.has(type)) {
    docValues.get(path)!.set(type, []);
  }
  
  // For arrays, we don't push the full array to element type stats, only for 'Array' type itself
  docValues.get(path)!.get(type)!.push(val);

  if (type === 'Object') {
    const keys = Object.keys(val);
    for (const k of keys) {
      const subPath = path ? `${path}.${k}` : k;
      traverse(val[k], subPath, docTypes, docValues);
    }
  } else if (type === 'Array') {
    for (const elem of val) {
      traverse(elem, path, docTypes, docValues);
    }
  }
}

export function analyzeDocuments(docs: any[]): SchemaAnalysisResult {
  const totalDocs = docs.length;
  if (totalDocs === 0) {
    return {
      totalDocs: 0,
      totalFields: 0,
      averageDepth: 0,
      maxDepth: 0,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [],
    };
  }

  // Global counts and values
  const pathOccurrences = new Map<string, number>(); // path -> occurrences across docs
  const pathTypeCounts = new Map<string, Map<string, number>>(); // path -> type -> count
  const pathTypeValues = new Map<string, Map<string, any[]>>(); // path -> type -> list of values

  for (const doc of docs) {
    const docTypes = new Map<string, Set<string>>();
    const docValues = new Map<string, Map<string, any[]>>();

    const rootType = detectType(doc);
    if (rootType === 'Object') {
      for (const k of Object.keys(doc)) {
        traverse(doc[k], k, docTypes, docValues);
      }
    } else {
      // Unusual case: document is not an object. Let's analyze it at root path
      traverse(doc, "_root", docTypes, docValues);
    }

    // Merge document stats into global maps
    for (const path of docTypes.keys()) {
      pathOccurrences.set(path, (pathOccurrences.get(path) || 0) + 1);

      if (!pathTypeCounts.has(path)) {
        pathTypeCounts.set(path, new Map());
      }
      const types = docTypes.get(path)!;
      for (const t of types) {
        const typeMap = pathTypeCounts.get(path)!;
        typeMap.set(t, (typeMap.get(t) || 0) + 1);
      }
    }

    for (const [path, typeValsMap] of docValues.entries()) {
      if (!pathTypeValues.has(path)) {
        pathTypeValues.set(path, new Map());
      }
      const globalTypeValsMap = pathTypeValues.get(path)!;
      for (const [type, vals] of typeValsMap.entries()) {
        if (!globalTypeValsMap.has(type)) {
          globalTypeValsMap.set(type, []);
        }
        globalTypeValsMap.get(type)!.push(...vals);
      }
    }
  }

  // Build FieldAnalysis array
  const fields: FieldAnalysis[] = [];
  let mixedTypesCount = 0;
  let sparseFieldsCount = 0;
  let totalDepthSum = 0;
  let maxDepth = 0;

  for (const [path, occurrences] of pathOccurrences.entries()) {
    const percentage = occurrences / totalDocs;
    const depth = path.split('.').length;
    totalDepthSum += depth;
    if (depth > maxDepth) maxDepth = depth;

    const warnings: string[] = [];
    if (percentage < 0.5) {
      warnings.push("Sparse Field: Present in less than 50% of documents.");
      sparseFieldsCount++;
    }

    const typeCountsMap = pathTypeCounts.get(path)!;
    const typeValuesMap = pathTypeValues.get(path)!;

    // Detect mixed types (excluding Null/Undefined)
    const activeTypes = Array.from(typeCountsMap.keys()).filter(t => t !== 'Null');
    if (activeTypes.length > 1) {
      warnings.push(`Mixed Types: Field contains ${activeTypes.join(', ')}.`);
      mixedTypesCount++;
    }

    if (path === "_id" && !typeCountsMap.has("ObjectID")) {
      warnings.push("Non-standard _id: Best practice is to use ObjectID.");
    }

    const typesList: TypeStats[] = [];

    for (const [type, count] of typeCountsMap.entries()) {
      const vals = typeValuesMap.get(type) || [];
      
      // Calculate min, max, mean for numeric types
      let min: number | undefined;
      let max: number | undefined;
      let mean: number | undefined;

      if (type === 'Number') {
        const numVals = vals.map(getNumericValue);
        if (numVals.length > 0) {
          min = Math.min(...numVals);
          max = Math.max(...numVals);
          const sum = numVals.reduce((acc, curr) => acc + curr, 0);
          mean = sum / numVals.length;
        }
      }

      // Calculate min, max, avg length for String and Array
      let minLength: number | undefined;
      let maxLength: number | undefined;
      let avgLength: number | undefined;

      if (type === 'String') {
        const stringLengths = vals.map(v => typeof v === 'string' ? v.length : 0);
        if (stringLengths.length > 0) {
          minLength = Math.min(...stringLengths);
          maxLength = Math.max(...stringLengths);
          const sum = stringLengths.reduce((acc, curr) => acc + curr, 0);
          avgLength = sum / stringLengths.length;
        }
      } else if (type === 'Array') {
        const arrayLengths = vals.map(v => Array.isArray(v) ? v.length : 0);
        if (arrayLengths.length > 0) {
          minLength = Math.min(...arrayLengths);
          maxLength = Math.max(...arrayLengths);
          const sum = arrayLengths.reduce((acc, curr) => acc + curr, 0);
          avgLength = sum / arrayLengths.length;
        }
      }

      // Distinct counts & Top values
      const stringifiedVals = vals.map(stringifyValue);
      const distinctSet = new Set(stringifiedVals);
      const distinctCount = distinctSet.size;

      // Compute Top 5 values
      const valCounts: Record<string, number> = {};
      for (const sVal of stringifiedVals) {
        valCounts[sVal] = (valCounts[sVal] || 0) + 1;
      }

      const topValues = Object.entries(valCounts)
        .map(([value, valCount]) => ({
          value,
          count: valCount,
          percentage: valCount / vals.length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      typesList.push({
        type,
        count,
        min,
        max,
        mean: mean !== undefined ? Number(mean.toFixed(2)) : undefined,
        minLength,
        maxLength,
        avgLength: avgLength !== undefined ? Number(avgLength.toFixed(2)) : undefined,
        distinctCount,
        topValues,
      });
    }

    // Sort types by count descending
    typesList.sort((a, b) => b.count - a.count);

    fields.push({
      path,
      occurrences,
      percentage: Number(percentage.toFixed(4)),
      types: typesList,
      warnings,
      depth,
    });
  }

  // Sort fields alphabetically by path
  fields.sort((a, b) => a.path.localeCompare(b.path));

  const totalFields = fields.length;
  const averageDepth = totalFields > 0 ? Number((totalDepthSum / totalFields).toFixed(2)) : 0;
  const sparsityPercent = totalFields > 0 ? Number((sparseFieldsCount / totalFields * 100).toFixed(1)) : 0;

  return {
    totalDocs,
    totalFields,
    averageDepth,
    maxDepth,
    mixedTypesCount,
    sparsityPercent,
    fields,
  };
}

export function compareSnapshots(
  current: SchemaAnalysisResult,
  previous: SchemaAnalysisResult | null
): SchemaAnalysisResult {
  if (!previous) {
    return {
      ...current,
      fields: current.fields.map(f => ({ ...f, comparison: 'new' as const })),
    };
  }

  const prevFieldMap = new Map<string, FieldAnalysis>();
  for (const f of previous.fields) {
    prevFieldMap.set(f.path, f);
  }

  const updatedFields: FieldAnalysis[] = [];

  // Analyze current fields
  for (const f of current.fields) {
    const prevField = prevFieldMap.get(f.path);
    if (!prevField) {
      updatedFields.push({
        ...f,
        comparison: 'new',
      });
    } else {
      // Check if types have changed
      const currTypes = f.types.map(t => t.type).sort();
      const prevTypes = prevField.types.map(t => t.type).sort();
      const typesChanged = JSON.stringify(currTypes) !== JSON.stringify(prevTypes);

      updatedFields.push({
        ...f,
        comparison: typesChanged ? 'type_changed' : 'unchanged',
        prevTypes: typesChanged ? prevTypes : undefined,
      });
      // Remove from map to track remaining (removed fields)
      prevFieldMap.delete(f.path);
    }
  }

  // Append removed fields
  for (const [path, prevField] of prevFieldMap.entries()) {
    if (prevField.comparison === 'removed') {
      // Keep it as removed
      updatedFields.push(prevField);
    } else {
      updatedFields.push({
        path,
        occurrences: 0,
        percentage: 0,
        types: prevField.types.map(t => ({ ...t, count: 0 })),
        warnings: ["Field no longer exists in current sample."],
        depth: prevField.depth,
        comparison: 'removed',
      });
    }
  }

  // Sort again by path
  updatedFields.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ...current,
    fields: updatedFields,
  };
}
