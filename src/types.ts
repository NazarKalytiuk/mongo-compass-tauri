export interface ConnectionInfo {
  version: string;
  databases: string[];
  /** Connection string with the password masked; the full URI stays in the backend. */
  display_uri: string;
}

export interface DocumentListResult {
  documents: any[];
  total_count: number;
}

export type NavSection =
  | 'explorer'
  | 'aggregations'
  | 'schema'
  | 'validation'
  | 'investigate'
  | 'metrics'
  | 'shell'
  | 'dump'
  | 'query-log';

export interface BulkWriteResult {
  matched_count: number;
  modified_count: number;
}

export interface TabState {
  id: string;
  name: string;
  selectedDb: string;
  selectedColl: string;
  filter: string;
  sort: string;
  projection: string;
  limit: number;
  skip: number;
  documents: any[];
  totalCount: number;
  viewMode: 'tree' | 'table' | 'json';
  loading: boolean;
  error: string | null;
  activeSection: NavSection;
  indexCount?: number;
  schemaFieldsCount?: number;
  pipeline?: string;
}

export interface ConnectionPreset {
  id: string;
  name: string;
  /** Never contains a password: that lives in the OS credential store under `id`. */
  uri: string;
  /** A password for this connection is in the OS credential store. */
  hasPassword?: boolean;
  color: string; // Environment color-code
  createdAt: string;
}

export interface IndexInfo {
  name: string;
  key: Record<string, any>;
  size: number;
  accesses?: number;
  unique: boolean;
  sparse: boolean;
}

export interface QueryLogEntry {
  id: string;
  op: 'FIND' | 'INSERT' | 'UPDATE' | 'DELETE' | 'AGGREGATE';
  ns: string;
  query: string;
  duration: number;
  docsAffected: number;
  timestamp: string;
  error?: string;
  isFavorite?: boolean;
}

export interface CurrentOp {
  opid: number;
  client?: string;
  op?: string;
  ns?: string;
  secs_running?: number;
  query?: string;
}

export interface ServerStatusResult {
  opcounters: {
    insert: number;
    query: number;
    update: number;
    delete: number;
    getmore: number;
    command: number;
  };
  connections: {
    current: number;
    available: number;
  };
  mem_resident_mb: number;
  network_bytes_in: number;
  network_bytes_out: number;
  wt_cache_used_bytes: number | null;
  wt_cache_max_bytes: number | null;
  wt_cache_pages_requested: number | null;
  wt_cache_pages_read: number | null;
}

export interface ReplSetStatusResult {
  is_replica_set: boolean;
  my_state: string | null;
  lag_ms: number | null;
}

