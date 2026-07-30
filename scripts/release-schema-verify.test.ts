import { describe, expect, test } from "bun:test";

import {
  collectReleaseSchemaIssues,
  RELEASE_SCHEMA_EXPECTATIONS,
  type ReleaseSchemaSnapshot,
} from "./release-schema-verify";

const defaultExpressions = {
  none: null,
  accepted: "'accepted'::character varying",
  pending: "'pending'::character varying",
  zero: "0",
  now: "now()",
  deadline: "(now() + '00:15:00'::interval)",
} as const;

function passingSnapshot(): ReleaseSchemaSnapshot {
  return {
    tables: [...RELEASE_SCHEMA_EXPECTATIONS.tables],
    columns: RELEASE_SCHEMA_EXPECTATIONS.columns.map((entry) => ({
      tableName: entry.tableName,
      columnName: entry.columnName,
      udtName: entry.udtName,
      nullable: entry.nullable,
      defaultExpression: defaultExpressions[entry.defaultKind],
    })),
    indexes: RELEASE_SCHEMA_EXPECTATIONS.indexes.map((entry) => ({
      tableName: entry.tableName,
      name: entry.name,
      unique: entry.unique,
      valid: true,
      ready: true,
      definition: `CREATE INDEX ${entry.name} ON public.${entry.tableName} ${entry.definitionFragments.join(" ")}`,
    })),
    triggers: RELEASE_SCHEMA_EXPECTATIONS.triggers.map((entry) => ({
      tableName: entry.tableName,
      name: entry.name,
      functionName: entry.functionName,
      enabled: "O",
      definition: `CREATE TRIGGER ${entry.name} ${entry.definitionFragments.join(" ")} EXECUTE FUNCTION ${entry.functionName}()`,
    })),
    functions: RELEASE_SCHEMA_EXPECTATIONS.functions.map((entry) => ({
      name: entry.name,
      resultType: "trigger",
      language: "plpgsql",
      definition: `CREATE FUNCTION ${entry.name}() RETURNS trigger ${entry.definitionFragments.join(" ")}`,
    })),
    constraints: RELEASE_SCHEMA_EXPECTATIONS.constraints.map((entry) => ({
      tableName: entry.tableName,
      name: entry.name,
      type: entry.type,
      validated: true,
      columns: entry.columns ? [...entry.columns] : ["disabled_at", "session_id"],
      referencedSchema: entry.referencedSchema ?? null,
      referencedTable: entry.referencedTable ?? null,
      referencedColumns: entry.referencedColumns
        ? [...entry.referencedColumns]
        : [],
      deleteAction: entry.deleteAction ?? null,
      definition:
        entry.type === "foreign_key"
          ? "FOREIGN KEY (session_id, user_id) REFERENCES public.sessions(id, user_id) ON DELETE CASCADE"
          : "CHECK (((disabled_at IS NOT NULL) OR (session_id IS NOT NULL)))",
    })),
    invariants: {
      musicJobsWithoutDeadline: "0",
      activeMusicJobsWithoutNextRun: 0,
      deletedUsersWithoutDeletionJob: 0n,
      songsWithoutCommittedAudioReceipt: "0",
      activePushWithoutValidSession: 0,
    },
  };
}

describe("release schema verifier", () => {
  test("accepts the expected 0027-0032 schema and zero-count invariants", () => {
    expect(collectReleaseSchemaIssues(passingSnapshot())).toEqual([]);
  });

  test("fails closed on missing tables and drifted column constraints", () => {
    const snapshot = passingSnapshot();
    snapshot.tables = snapshot.tables.filter((name) => name !== "song_audio_objects");
    snapshot.columns = snapshot.columns.filter(
      (entry) => !(entry.tableName === "music_jobs" && entry.columnName === "next_run_at"),
    );
    const deadline = snapshot.columns.find(
      (entry) => entry.tableName === "music_jobs" && entry.columnName === "deadline_at",
    );
    if (!deadline) throw new Error("test fixture is missing deadline_at");
    deadline.nullable = true;
    deadline.defaultExpression = null;

    const issues = collectReleaseSchemaIssues(snapshot);
    expect(issues).toContain("missing table public.song_audio_objects");
    expect(issues).toContain("missing column public.music_jobs.next_run_at");
    expect(issues).toContain("music_jobs.deadline_at nullable=true; expected false");
    expect(issues).toContain(
      "music_jobs.deadline_at has default null; expected deadline",
    );
  });

  test("rejects invalid indexes, disabled or misbound triggers, and function drift", () => {
    const snapshot = passingSnapshot();
    const activeSessionIndex = snapshot.indexes.find(
      (entry) => entry.name === "push_subscriptions_active_session_idx",
    );
    if (!activeSessionIndex) throw new Error("test fixture is missing active-session index");
    activeSessionIndex.ready = false;
    activeSessionIndex.definition = activeSessionIndex.definition.replace(
      "disabled_at is null",
      "disabled_at is not null",
    );
    snapshot.indexes.push({
      tableName: "music_jobs",
      name: "music_jobs_runnable_idx",
      unique: false,
      valid: true,
      ready: true,
      definition: "CREATE INDEX music_jobs_runnable_idx ON public.music_jobs (status)",
    });

    const songTrigger = snapshot.triggers.find(
      (entry) => entry.name === "songs_audio_lifecycle_trg",
    );
    if (!songTrigger) throw new Error("test fixture is missing song trigger");
    songTrigger.enabled = "D";
    songTrigger.functionName = "wrong_function";

    const deletionFunction = snapshot.functions.find(
      (entry) => entry.name === "murmur_ensure_account_deletion_job",
    );
    if (!deletionFunction) throw new Error("test fixture is missing deletion function");
    deletionFunction.language = "sql";
    deletionFunction.definition = deletionFunction.definition.replace("30 days", "7 days");

    const issues = collectReleaseSchemaIssues(snapshot);
    expect(issues).toContain(
      "push_subscriptions_active_session_idx is not valid and ready",
    );
    expect(issues).toContain(
      "push_subscriptions_active_session_idx definition is missing: disabled_at is null",
    );
    expect(issues).toContain("obsolete index public.music_jobs_runnable_idx still exists");
    expect(issues).toContain(
      "songs_audio_lifecycle_trg is not enabled for ordinary writes (D)",
    );
    expect(issues).toContain(
      "songs_audio_lifecycle_trg calls wrong_function; expected murmur_track_legacy_song_audio",
    );
    expect(issues).toContain(
      "murmur_ensure_account_deletion_job uses sql; expected plpgsql",
    );
    expect(issues).toContain(
      "murmur_ensure_account_deletion_job definition is missing: 30 days",
    );
  });

  test("rejects drift in the 0032 session index and Push constraints", () => {
    const snapshot = passingSnapshot();
    const sessionIndex = snapshot.indexes.find(
      (entry) => entry.name === "sessions_id_user_idx",
    );
    if (!sessionIndex) throw new Error("test fixture is missing session owner index");
    sessionIndex.unique = false;
    sessionIndex.definition = sessionIndex.definition.replace(
      "(id, user_id)",
      "(user_id, id)",
    );

    const ownerFk = snapshot.constraints.find(
      (entry) => entry.name === "push_subscriptions_session_owner_fk",
    );
    if (!ownerFk) throw new Error("test fixture is missing session owner FK");
    ownerFk.validated = false;
    ownerFk.columns = ["user_id", "session_id"];
    ownerFk.referencedSchema = "shadow";
    ownerFk.referencedTable = "other_sessions";
    ownerFk.referencedColumns = ["user_id", "id"];
    ownerFk.deleteAction = "no action";

    const activeSessionCheck = snapshot.constraints.find(
      (entry) =>
        entry.name === "push_subscriptions_active_session_required_check",
    );
    if (!activeSessionCheck) {
      throw new Error("test fixture is missing active-session check");
    }
    activeSessionCheck.validated = false;
    activeSessionCheck.definition =
      "CHECK ((disabled_at IS NOT NULL AND session_id IS NOT NULL))";

    const issues = collectReleaseSchemaIssues(snapshot);
    expect(issues).toEqual(
      expect.arrayContaining([
        "sessions_id_user_idx unique=false; expected true",
        "sessions_id_user_idx definition is missing: using btree (id, user_id)",
        "push_subscriptions.push_subscriptions_session_owner_fk is not validated",
        "push_subscriptions.push_subscriptions_session_owner_fk covers (user_id, session_id); expected (session_id, user_id)",
        "push_subscriptions.push_subscriptions_session_owner_fk references schema shadow; expected public",
        "push_subscriptions.push_subscriptions_session_owner_fk references table other_sessions; expected sessions",
        "push_subscriptions.push_subscriptions_session_owner_fk references (user_id, id); expected (id, user_id)",
        "push_subscriptions.push_subscriptions_session_owner_fk uses ON DELETE no action; expected cascade",
        "push_subscriptions.push_subscriptions_active_session_required_check is not validated",
        "push_subscriptions.push_subscriptions_active_session_required_check has unexpected definition: check disabled_at is not null and session_id is not null",
      ]),
    );
  });

  test("reports every violated data invariant and rejects malformed counts", () => {
    const snapshot = passingSnapshot();
    snapshot.invariants = {
      musicJobsWithoutDeadline: "2",
      activeMusicJobsWithoutNextRun: 3,
      deletedUsersWithoutDeletionJob: 1n,
      songsWithoutCommittedAudioReceipt: undefined,
      activePushWithoutValidSession: 4,
    };

    expect(collectReleaseSchemaIssues(snapshot)).toEqual(
      expect.arrayContaining([
        "music_jobs rows with NULL deadline_at: 2",
        "active music_jobs rows with NULL next_run_at: 3",
        "deleted users without account_deletion_jobs: 1",
        "songs with mp3_storage_key without matching committed song_audio_objects receipt returned an invalid count: undefined",
        "active Push rows without a valid owned session or with an expired endpoint: 4",
      ]),
    );
  });
});
