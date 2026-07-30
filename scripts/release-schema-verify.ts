import { config } from "dotenv";
import postgres from "postgres";

import {
  isExplicitLocalDev,
  resolveServerDsn,
} from "../src/lib/db/config";

type DefaultKind = "none" | "accepted" | "pending" | "zero" | "now" | "deadline";

export interface SchemaColumnObservation {
  tableName: string;
  columnName: string;
  udtName: string;
  nullable: boolean;
  defaultExpression: string | null;
}

export interface SchemaIndexObservation {
  tableName: string;
  name: string;
  unique: boolean;
  valid: boolean;
  ready: boolean;
  definition: string;
}

export interface SchemaTriggerObservation {
  tableName: string;
  name: string;
  functionName: string;
  enabled: string;
  definition: string;
}

export interface SchemaFunctionObservation {
  name: string;
  resultType: string;
  language: string;
  definition: string;
}

export interface SchemaConstraintObservation {
  tableName: string;
  name: string;
  type: string;
  validated: boolean;
  columns: string[];
  referencedSchema: string | null;
  referencedTable: string | null;
  referencedColumns: string[];
  deleteAction: string | null;
  definition: string;
}

type ObservedCount = number | bigint | string | null | undefined;

export interface ReleaseSchemaSnapshot {
  tables: string[];
  columns: SchemaColumnObservation[];
  indexes: SchemaIndexObservation[];
  triggers: SchemaTriggerObservation[];
  functions: SchemaFunctionObservation[];
  constraints: SchemaConstraintObservation[];
  invariants: {
    musicJobsWithoutDeadline: ObservedCount;
    activeMusicJobsWithoutNextRun: ObservedCount;
    deletedUsersWithoutDeletionJob: ObservedCount;
    songsWithoutCommittedAudioReceipt: ObservedCount;
    activePushWithoutValidSession: ObservedCount;
  };
}

interface ColumnExpectation {
  tableName: string;
  columnName: string;
  udtName: string;
  nullable: boolean;
  defaultKind: DefaultKind;
}

interface IndexExpectation {
  tableName: string;
  name: string;
  unique: boolean;
  definitionFragments: string[];
}

interface TriggerExpectation {
  tableName: string;
  name: string;
  functionName: string;
  definitionFragments: string[];
}

interface FunctionExpectation {
  name: string;
  definitionFragments: string[];
}

interface ConstraintExpectation {
  tableName: string;
  name: string;
  type: "foreign_key" | "check";
  columns?: string[];
  referencedSchema?: string;
  referencedTable?: string;
  referencedColumns?: string[];
  deleteAction?: string;
  canonicalDefinition?: string;
}

const REQUIRED_TABLES = [
  "music_jobs",
  "account_deletion_jobs",
  "account_deletion_objects",
  "song_audio_objects",
  "sessions",
  "push_subscriptions",
] as const;

const REQUIRED_COLUMNS: ColumnExpectation[] = [
  column("music_jobs", "id", "text", false),
  column("music_jobs", "user_id", "varchar", false),
  column("music_jobs", "operation_id", "varchar", false),
  column("music_jobs", "request_hash", "varchar", false),
  column("music_jobs", "status", "varchar", false, "accepted"),
  column("music_jobs", "input", "jsonb", false),
  column("music_jobs", "output", "jsonb", true),
  column("music_jobs", "provider", "varchar", true),
  column("music_jobs", "provider_job_id", "text", true),
  column("music_jobs", "spend_ledger_id", "text", true),
  column("music_jobs", "attempt", "int4", false, "zero"),
  column("music_jobs", "lease_until", "timestamp", true),
  column("music_jobs", "provider_submitted_at", "timestamp", true),
  column("music_jobs", "deadline_at", "timestamp", false, "deadline"),
  column("music_jobs", "next_run_at", "timestamp", true),
  column("music_jobs", "cancel_requested_at", "timestamp", true),
  column("music_jobs", "error_code", "varchar", true),
  column("music_jobs", "error_message", "text", true),
  column("music_jobs", "created_at", "timestamp", false, "now"),
  column("music_jobs", "updated_at", "timestamp", false, "now"),
  column("music_jobs", "started_at", "timestamp", true),
  column("music_jobs", "finished_at", "timestamp", true),

  column("account_deletion_jobs", "user_id", "varchar", false),
  column("account_deletion_jobs", "status", "varchar", false, "pending"),
  column("account_deletion_jobs", "requested_at", "timestamp", false),
  column("account_deletion_jobs", "purge_after", "timestamp", false),
  column("account_deletion_jobs", "next_attempt_at", "timestamp", false),
  column("account_deletion_jobs", "lease_until", "timestamp", true),
  column("account_deletion_jobs", "attempts", "int4", false, "zero"),
  column("account_deletion_jobs", "objects_deleted", "int4", false, "zero"),
  column("account_deletion_jobs", "last_error", "text", true),
  column("account_deletion_jobs", "completed_at", "timestamp", true),
  column("account_deletion_jobs", "created_at", "timestamp", false, "now"),
  column("account_deletion_jobs", "updated_at", "timestamp", false, "now"),

  column("account_deletion_objects", "user_id", "varchar", false),
  column("account_deletion_objects", "storage_key", "text", false),
  column("account_deletion_objects", "attempts", "int4", false, "zero"),
  column("account_deletion_objects", "next_attempt_at", "timestamp", false, "now"),
  column("account_deletion_objects", "last_error", "text", true),
  column("account_deletion_objects", "deleted_at", "timestamp", true),
  column("account_deletion_objects", "created_at", "timestamp", false, "now"),
  column("account_deletion_objects", "updated_at", "timestamp", false, "now"),

  column("song_audio_objects", "storage_key", "text", false),
  column("song_audio_objects", "user_id", "text", false),
  column("song_audio_objects", "song_id", "text", false),
  column("song_audio_objects", "digest", "varchar", false),
  column("song_audio_objects", "state", "varchar", false, "pending"),
  column("song_audio_objects", "attempts", "int4", false, "zero"),
  column("song_audio_objects", "next_attempt_at", "timestamp", false, "now"),
  column("song_audio_objects", "lease_until", "timestamp", true),
  column("song_audio_objects", "last_error", "text", true),
  column("song_audio_objects", "committed_at", "timestamp", true),
  column("song_audio_objects", "deleted_at", "timestamp", true),
  column("song_audio_objects", "created_at", "timestamp", false, "now"),
  column("song_audio_objects", "updated_at", "timestamp", false, "now"),

  column("users", "deleted_at", "timestamp", true),
  column("songs", "mp3_storage_key", "text", true),
  column("sessions", "id", "text", false),
  column("sessions", "user_id", "varchar", false),
  column("sessions", "expires_at", "timestamp", false),
  column("sessions", "revoked_at", "timestamp", true),
  column("push_subscriptions", "user_id", "varchar", false),
  column("push_subscriptions", "session_id", "text", true),
  column("push_subscriptions", "expiration_time", "timestamp", true),
  column("push_subscriptions", "disabled_at", "timestamp", true),
];

const REQUIRED_INDEXES: IndexExpectation[] = [
  index("music_jobs", "music_jobs_pkey", true, ["using btree (id)"]),
  index("music_jobs", "music_jobs_user_operation_uidx", true, [
    "using btree (user_id, operation_id)",
  ]),
  index("music_jobs", "music_jobs_user_time_idx", false, [
    "using btree (user_id, created_at)",
  ]),
  index("music_jobs", "music_jobs_provider_job_uidx", true, [
    "using btree (provider, provider_job_id)",
    "provider_job_id is not null",
  ]),
  index("music_jobs", "music_jobs_runnable_v2_idx", false, [
    "using btree (status, next_run_at, lease_until)",
  ]),
  index("account_deletion_jobs", "account_deletion_jobs_pkey", true, [
    "using btree (user_id)",
  ]),
  index("account_deletion_jobs", "account_deletion_jobs_due_idx", false, [
    "using btree (status, next_attempt_at, lease_until)",
  ]),
  index(
    "account_deletion_objects",
    "account_deletion_objects_user_id_storage_key_pk",
    true,
    ["using btree (user_id, storage_key)"],
  ),
  index("account_deletion_objects", "account_deletion_objects_due_idx", false, [
    "using btree (user_id, deleted_at, next_attempt_at)",
  ]),
  index("song_audio_objects", "song_audio_objects_pkey", true, [
    "using btree (storage_key)",
  ]),
  index("song_audio_objects", "song_audio_objects_due_idx", false, [
    "using btree (state, next_attempt_at, lease_until)",
  ]),
  index("song_audio_objects", "song_audio_objects_song_idx", false, [
    "using btree (user_id, song_id)",
  ]),
  index("push_subscriptions", "push_subscriptions_active_session_idx", false, [
    "using btree (session_id)",
    "disabled_at is null",
  ]),
  index("sessions", "sessions_id_user_idx", true, [
    "using btree (id, user_id)",
  ]),
];

const FORBIDDEN_INDEXES = ["music_jobs_runnable_idx"] as const;

const REQUIRED_TRIGGERS: TriggerExpectation[] = [
  {
    tableName: "users",
    name: "users_account_deletion_job_trg",
    functionName: "murmur_ensure_account_deletion_job",
    definitionFragments: ["after update of deleted_at", "for each row"],
  },
  {
    tableName: "songs",
    name: "songs_audio_lifecycle_trg",
    functionName: "murmur_track_legacy_song_audio",
    definitionFragments: [
      "after",
      "insert",
      "update of mp3_storage_key",
      "delete",
      "for each row",
    ],
  },
];

const REQUIRED_FUNCTIONS: FunctionExpectation[] = [
  {
    name: "murmur_ensure_account_deletion_job",
    definitionFragments: [
      "account_deletion_jobs",
      "new.deleted_at",
      "30 days",
      "on conflict",
      "do nothing",
    ],
  },
  {
    name: "murmur_track_legacy_song_audio",
    definitionFragments: [
      "song_audio_objects",
      "old.mp3_storage_key",
      "new.mp3_storage_key",
      "delete_pending",
      "committed",
      "on conflict",
    ],
  },
];

const REQUIRED_CONSTRAINTS: ConstraintExpectation[] = [
  {
    tableName: "push_subscriptions",
    name: "push_subscriptions_session_owner_fk",
    type: "foreign_key",
    columns: ["session_id", "user_id"],
    referencedSchema: "public",
    referencedTable: "sessions",
    referencedColumns: ["id", "user_id"],
    deleteAction: "cascade",
  },
  {
    tableName: "push_subscriptions",
    name: "push_subscriptions_active_session_required_check",
    type: "check",
    canonicalDefinition:
      "check disabled_at is not null or session_id is not null",
  },
];

export const RELEASE_SCHEMA_EXPECTATIONS = {
  tables: REQUIRED_TABLES,
  columns: REQUIRED_COLUMNS,
  indexes: REQUIRED_INDEXES,
  triggers: REQUIRED_TRIGGERS,
  functions: REQUIRED_FUNCTIONS,
  constraints: REQUIRED_CONSTRAINTS,
} as const;

function column(
  tableName: string,
  columnName: string,
  udtName: string,
  nullable: boolean,
  defaultKind: DefaultKind = "none",
): ColumnExpectation {
  return { tableName, columnName, udtName, nullable, defaultKind };
}

function index(
  tableName: string,
  name: string,
  unique: boolean,
  definitionFragments: string[],
): IndexExpectation {
  return { tableName, name, unique, definitionFragments };
}

function normalizeSql(value: string): string {
  return value.toLowerCase().replaceAll('"', "").replace(/\s+/g, " ").trim();
}

function canonicalConstraintDefinition(value: string): string {
  return normalizeSql(value).replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

function equalStringArrays(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function defaultMatches(kind: DefaultKind, expression: string | null): boolean {
  if (kind === "none") return expression === null;
  if (!expression) return false;

  const normalized = normalizeSql(expression).replace(/[()]/g, "");
  if (kind === "accepted" || kind === "pending") {
    return normalized.includes(`'${kind}'`);
  }
  if (kind === "zero") return normalized === "0";
  if (kind === "now") return normalized === "now";

  return (
    normalized.includes("now") &&
    (normalized.includes("00:15:00") || normalized.includes("15 min"))
  );
}

function countIssue(label: string, value: ObservedCount): string | null {
  let parsed: bigint;
  try {
    if (typeof value === "bigint") parsed = value;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      parsed = BigInt(value);
    } else if (typeof value === "string" && /^\d+$/.test(value)) parsed = BigInt(value);
    else return `${label} returned an invalid count: ${String(value)}`;
  } catch {
    return `${label} returned an invalid count: ${String(value)}`;
  }

  return parsed === 0n ? null : `${label}: ${parsed.toString()}`;
}

export function collectReleaseSchemaIssues(snapshot: ReleaseSchemaSnapshot): string[] {
  const issues: string[] = [];
  const tables = new Set(snapshot.tables);
  const columns = new Map(
    snapshot.columns.map((entry) => [`${entry.tableName}.${entry.columnName}`, entry]),
  );
  const indexes = new Map(snapshot.indexes.map((entry) => [entry.name, entry]));
  const triggers = new Map(snapshot.triggers.map((entry) => [entry.name, entry]));
  const functions = new Map(snapshot.functions.map((entry) => [entry.name, entry]));
  const constraints = new Map(
    snapshot.constraints.map((entry) => [`${entry.tableName}.${entry.name}`, entry]),
  );

  for (const tableName of REQUIRED_TABLES) {
    if (!tables.has(tableName)) issues.push(`missing table public.${tableName}`);
  }

  for (const expected of REQUIRED_COLUMNS) {
    const key = `${expected.tableName}.${expected.columnName}`;
    const actual = columns.get(key);
    if (!actual) {
      issues.push(`missing column public.${key}`);
      continue;
    }
    if (actual.udtName !== expected.udtName) {
      issues.push(`${key} has type ${actual.udtName}; expected ${expected.udtName}`);
    }
    if (actual.nullable !== expected.nullable) {
      issues.push(`${key} nullable=${actual.nullable}; expected ${expected.nullable}`);
    }
    if (!defaultMatches(expected.defaultKind, actual.defaultExpression)) {
      issues.push(
        `${key} has default ${String(actual.defaultExpression)}; expected ${expected.defaultKind}`,
      );
    }
  }

  for (const expected of REQUIRED_INDEXES) {
    const actual = indexes.get(expected.name);
    if (!actual) {
      issues.push(`missing index public.${expected.name}`);
      continue;
    }
    if (actual.tableName !== expected.tableName) {
      issues.push(
        `${expected.name} belongs to ${actual.tableName}; expected ${expected.tableName}`,
      );
    }
    if (actual.unique !== expected.unique) {
      issues.push(`${expected.name} unique=${actual.unique}; expected ${expected.unique}`);
    }
    if (!actual.valid || !actual.ready) {
      issues.push(`${expected.name} is not valid and ready`);
    }
    const definition = normalizeSql(actual.definition);
    for (const fragment of expected.definitionFragments) {
      if (!definition.includes(fragment)) {
        issues.push(`${expected.name} definition is missing: ${fragment}`);
      }
    }
  }

  for (const name of FORBIDDEN_INDEXES) {
    if (indexes.has(name)) issues.push(`obsolete index public.${name} still exists`);
  }

  for (const expected of REQUIRED_TRIGGERS) {
    const actual = triggers.get(expected.name);
    if (!actual) {
      issues.push(`missing trigger public.${expected.name}`);
      continue;
    }
    if (actual.tableName !== expected.tableName) {
      issues.push(
        `${expected.name} belongs to ${actual.tableName}; expected ${expected.tableName}`,
      );
    }
    if (actual.functionName !== expected.functionName) {
      issues.push(
        `${expected.name} calls ${actual.functionName}; expected ${expected.functionName}`,
      );
    }
    if (actual.enabled !== "O" && actual.enabled !== "A") {
      issues.push(`${expected.name} is not enabled for ordinary writes (${actual.enabled})`);
    }
    const definition = normalizeSql(actual.definition);
    for (const fragment of expected.definitionFragments) {
      if (!definition.includes(fragment)) {
        issues.push(`${expected.name} definition is missing: ${fragment}`);
      }
    }
  }

  for (const expected of REQUIRED_FUNCTIONS) {
    const actual = functions.get(expected.name);
    if (!actual) {
      issues.push(`missing function public.${expected.name}()`);
      continue;
    }
    if (normalizeSql(actual.resultType) !== "trigger") {
      issues.push(`${expected.name} returns ${actual.resultType}; expected trigger`);
    }
    if (actual.language.toLowerCase() !== "plpgsql") {
      issues.push(`${expected.name} uses ${actual.language}; expected plpgsql`);
    }
    const definition = normalizeSql(actual.definition);
    for (const fragment of expected.definitionFragments) {
      if (!definition.includes(fragment)) {
        issues.push(`${expected.name} definition is missing: ${fragment}`);
      }
    }
  }

  for (const expected of REQUIRED_CONSTRAINTS) {
    const key = `${expected.tableName}.${expected.name}`;
    const actual = constraints.get(key);
    if (!actual) {
      issues.push(`missing constraint public.${key}`);
      continue;
    }
    if (actual.type !== expected.type) {
      issues.push(`${key} has type ${actual.type}; expected ${expected.type}`);
    }
    if (!actual.validated) issues.push(`${key} is not validated`);
    if (expected.columns && !equalStringArrays(actual.columns, expected.columns)) {
      issues.push(
        `${key} covers (${actual.columns.join(", ")}); expected (${expected.columns.join(", ")})`,
      );
    }
    if (
      expected.referencedSchema &&
      actual.referencedSchema !== expected.referencedSchema
    ) {
      issues.push(
        `${key} references schema ${String(actual.referencedSchema)}; expected ${expected.referencedSchema}`,
      );
    }
    if (expected.referencedTable && actual.referencedTable !== expected.referencedTable) {
      issues.push(
        `${key} references table ${String(actual.referencedTable)}; expected ${expected.referencedTable}`,
      );
    }
    if (
      expected.referencedColumns &&
      !equalStringArrays(actual.referencedColumns, expected.referencedColumns)
    ) {
      issues.push(
        `${key} references (${actual.referencedColumns.join(", ")}); expected (${expected.referencedColumns.join(", ")})`,
      );
    }
    if (expected.deleteAction && actual.deleteAction !== expected.deleteAction) {
      issues.push(
        `${key} uses ON DELETE ${String(actual.deleteAction)}; expected ${expected.deleteAction}`,
      );
    }
    if (
      expected.canonicalDefinition &&
      canonicalConstraintDefinition(actual.definition) !==
        expected.canonicalDefinition
    ) {
      issues.push(
        `${key} has unexpected definition: ${canonicalConstraintDefinition(actual.definition)}`,
      );
    }
  }

  const invariantChecks: Array<[string, ObservedCount]> = [
    ["music_jobs rows with NULL deadline_at", snapshot.invariants.musicJobsWithoutDeadline],
    [
      "active music_jobs rows with NULL next_run_at",
      snapshot.invariants.activeMusicJobsWithoutNextRun,
    ],
    [
      "deleted users without account_deletion_jobs",
      snapshot.invariants.deletedUsersWithoutDeletionJob,
    ],
    [
      "songs with mp3_storage_key without matching committed song_audio_objects receipt",
      snapshot.invariants.songsWithoutCommittedAudioReceipt,
    ],
    [
      "active Push rows without a valid owned session or with an expired endpoint",
      snapshot.invariants.activePushWithoutValidSession,
    ],
  ];
  for (const [label, value] of invariantChecks) {
    const issue = countIssue(label, value);
    if (issue) issues.push(issue);
  }

  return issues;
}

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  definition: string;
}

interface TriggerRow {
  table_name: string;
  trigger_name: string;
  function_name: string;
  enabled: string;
  definition: string;
}

interface FunctionRow {
  function_name: string;
  result_type: string;
  language: string;
  definition: string;
}

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  is_validated: boolean;
  columns: string[];
  referenced_schema: string | null;
  referenced_table: string | null;
  referenced_columns: string[];
  delete_action: string | null;
  definition: string;
}

interface InvariantRow {
  music_jobs_without_deadline: string;
  active_music_jobs_without_next_run: string;
  deleted_users_without_deletion_job: string;
  songs_without_committed_audio_receipt: string;
  active_push_without_valid_session: string;
}

export async function loadReleaseSchemaSnapshot(
  sql: ReturnType<typeof postgres>,
): Promise<ReleaseSchemaSnapshot> {
  const tables = await sql<TableRow[]>`
    SELECT c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  `;
  const columns = await sql<ColumnRow[]>`
    SELECT table_name, column_name, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const indexes = await sql<IndexRow[]>`
    SELECT
      table_class.relname AS table_name,
      index_class.relname AS index_name,
      index_state.indisunique AS is_unique,
      index_state.indisvalid AS is_valid,
      index_state.indisready AS is_ready,
      pg_catalog.pg_get_indexdef(index_state.indexrelid) AS definition
    FROM pg_catalog.pg_index index_state
    JOIN pg_catalog.pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_catalog.pg_class table_class ON table_class.oid = index_state.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
    WHERE n.nspname = 'public'
  `;
  const triggers = await sql<TriggerRow[]>`
    SELECT
      table_class.relname AS table_name,
      trigger_state.tgname AS trigger_name,
      function_state.proname AS function_name,
      trigger_state.tgenabled AS enabled,
      pg_catalog.pg_get_triggerdef(trigger_state.oid, true) AS definition
    FROM pg_catalog.pg_trigger trigger_state
    JOIN pg_catalog.pg_class table_class ON table_class.oid = trigger_state.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
    JOIN pg_catalog.pg_proc function_state ON function_state.oid = trigger_state.tgfoid
    WHERE n.nspname = 'public'
      AND NOT trigger_state.tgisinternal
  `;
  const functions = await sql<FunctionRow[]>`
    SELECT
      function_state.proname AS function_name,
      pg_catalog.pg_get_function_result(function_state.oid) AS result_type,
      language_state.lanname AS language,
      pg_catalog.pg_get_functiondef(function_state.oid) AS definition
    FROM pg_catalog.pg_proc function_state
    JOIN pg_catalog.pg_namespace n ON n.oid = function_state.pronamespace
    JOIN pg_catalog.pg_language language_state ON language_state.oid = function_state.prolang
    WHERE n.nspname = 'public'
      AND function_state.proname IN (
        'murmur_ensure_account_deletion_job',
        'murmur_track_legacy_song_audio'
      )
      AND pg_catalog.pg_get_function_identity_arguments(function_state.oid) = ''
  `;
  const constraints = await sql<ConstraintRow[]>`
    SELECT
      source_table.relname AS table_name,
      constraint_state.conname AS constraint_name,
      CASE constraint_state.contype
        WHEN 'f' THEN 'foreign_key'
        WHEN 'c' THEN 'check'
        ELSE constraint_state.contype::text
      END AS constraint_type,
      constraint_state.convalidated AS is_validated,
      ARRAY(
        SELECT source_attribute.attname
        FROM unnest(constraint_state.conkey) WITH ORDINALITY
          AS expanded_key(attnum, position)
        JOIN pg_catalog.pg_attribute source_attribute
          ON source_attribute.attrelid = constraint_state.conrelid
         AND source_attribute.attnum = expanded_key.attnum
        ORDER BY expanded_key.position
      )::text[] AS columns,
      target_namespace.nspname AS referenced_schema,
      target_table.relname AS referenced_table,
      ARRAY(
        SELECT target_attribute.attname
        FROM unnest(constraint_state.confkey) WITH ORDINALITY
          AS expanded_key(attnum, position)
        JOIN pg_catalog.pg_attribute target_attribute
          ON target_attribute.attrelid = constraint_state.confrelid
         AND target_attribute.attnum = expanded_key.attnum
        ORDER BY expanded_key.position
      )::text[] AS referenced_columns,
      CASE constraint_state.confdeltype
        WHEN 'a' THEN 'no action'
        WHEN 'r' THEN 'restrict'
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null'
        WHEN 'd' THEN 'set default'
        ELSE NULL
      END AS delete_action,
      pg_catalog.pg_get_constraintdef(constraint_state.oid, true) AS definition
    FROM pg_catalog.pg_constraint constraint_state
    JOIN pg_catalog.pg_class source_table
      ON source_table.oid = constraint_state.conrelid
    JOIN pg_catalog.pg_namespace source_namespace
      ON source_namespace.oid = source_table.relnamespace
    LEFT JOIN pg_catalog.pg_class target_table
      ON target_table.oid = constraint_state.confrelid
    LEFT JOIN pg_catalog.pg_namespace target_namespace
      ON target_namespace.oid = target_table.relnamespace
    WHERE source_namespace.nspname = 'public'
      AND constraint_state.conname IN (
        'push_subscriptions_session_owner_fk',
        'push_subscriptions_active_session_required_check'
      )
  `;
  const [invariants] = await sql<InvariantRow[]>`
    SELECT
      (SELECT count(*) FROM public.music_jobs WHERE deadline_at IS NULL)
        AS music_jobs_without_deadline,
      (
        SELECT count(*)
        FROM public.music_jobs
        WHERE status IN (
          'accepted', 'queued', 'running', 'cancel_requested', 'result_ready'
        )
          AND next_run_at IS NULL
      ) AS active_music_jobs_without_next_run,
      (
        SELECT count(*)
        FROM public.users u
        LEFT JOIN public.account_deletion_jobs j ON j.user_id = u.id
        WHERE u.deleted_at IS NOT NULL AND j.user_id IS NULL
      ) AS deleted_users_without_deletion_job,
      (
        SELECT count(*)
        FROM public.songs s
        LEFT JOIN public.song_audio_objects o
          ON o.storage_key = s.mp3_storage_key
         AND o.user_id = s.user_id
         AND o.song_id = s.id
         AND o.state = 'committed'
        WHERE s.mp3_storage_key IS NOT NULL
          AND s.mp3_storage_key <> ''
          AND o.storage_key IS NULL
      ) AS songs_without_committed_audio_receipt
      ,(
        SELECT count(*)
        FROM public.push_subscriptions p
        LEFT JOIN public.sessions session
          ON session.id = p.session_id
         AND session.user_id = p.user_id
        WHERE p.disabled_at IS NULL
          AND (
            p.session_id IS NULL
            OR session.id IS NULL
            OR session.revoked_at IS NOT NULL
            OR session.expires_at <= now()
            OR (p.expiration_time IS NOT NULL AND p.expiration_time <= now())
          )
      ) AS active_push_without_valid_session
  `;
  if (!invariants) throw new Error("Release schema invariant query returned no row");

  return {
    tables: tables.map((row) => row.table_name),
    columns: columns.map((row) => ({
      tableName: row.table_name,
      columnName: row.column_name,
      udtName: row.udt_name,
      nullable: row.is_nullable === "YES",
      defaultExpression: row.column_default,
    })),
    indexes: indexes.map((row) => ({
      tableName: row.table_name,
      name: row.index_name,
      unique: row.is_unique,
      valid: row.is_valid,
      ready: row.is_ready,
      definition: row.definition,
    })),
    triggers: triggers.map((row) => ({
      tableName: row.table_name,
      name: row.trigger_name,
      functionName: row.function_name,
      enabled: row.enabled,
      definition: row.definition,
    })),
    functions: functions.map((row) => ({
      name: row.function_name,
      resultType: row.result_type,
      language: row.language,
      definition: row.definition,
    })),
    constraints: constraints.map((row) => ({
      tableName: row.table_name,
      name: row.constraint_name,
      type: row.constraint_type,
      validated: row.is_validated,
      columns: row.columns,
      referencedSchema: row.referenced_schema,
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns,
      deleteAction: row.delete_action,
      definition: row.definition,
    })),
    invariants: {
      musicJobsWithoutDeadline: invariants.music_jobs_without_deadline,
      activeMusicJobsWithoutNextRun: invariants.active_music_jobs_without_next_run,
      deletedUsersWithoutDeletionJob: invariants.deleted_users_without_deletion_job,
      songsWithoutCommittedAudioReceipt:
        invariants.songs_without_committed_audio_receipt,
      activePushWithoutValidSession: invariants.active_push_without_valid_session,
    },
  };
}

async function main(): Promise<void> {
  config({ path: ".env" });
  const connectionString = resolveServerDsn(process.env, {
    isMigration: true,
    isExplicitLocalDev: isExplicitLocalDev(process.env),
  });
  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const snapshot = await loadReleaseSchemaSnapshot(sql);
    const issues = collectReleaseSchemaIssues(snapshot);
    if (issues.length > 0) {
      console.error(`Release schema verification failed (${issues.length} issue(s)):`);
      for (const issue of issues) console.error(`  - ${issue}`);
      process.exitCode = 1;
      return;
    }
    console.log("Release schema verification passed for migrations 0027-0032.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Release schema verification could not complete.");
    console.error(error);
    process.exitCode = 1;
  });
}
