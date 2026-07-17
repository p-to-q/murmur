import { beforeEach, describe, expect, it, mock } from "bun:test";

type VerificationRow = {
  id: string;
  email: string;
  code: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

const rows: VerificationRow[] = [];
const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
let selectCalls = 0;
let transactionQueue: Promise<unknown> = Promise.resolve();

class MockResend {
  emails = {
    send: mock(async (payload: { to: string; subject: string; html: string }) => {
      if (shouldFailSend) {
        throw new Error("resend down");
      }
      sentEmails.push(payload);
      return { id: "email_mock" };
    }),
  };
}

let shouldFailSend = false;

function activeRows(): VerificationRow[] {
  const now = Date.now();
  return rows.filter((row) => !row.usedAt && row.expiresAt.getTime() > now);
}

function makeSelectBuilder(projection?: Record<string, unknown>) {
  let ordered = false;
  const resolve = () => {
    selectCalls += 1;
    const selected = activeRows();
    if (ordered) {
      selected.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    if (projection) {
      return selected.map((row) => ({ id: row.id }));
    }
    return selected.map((row) => ({ ...row }));
  };

  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => {
      ordered = true;
      return builder;
    },
    for: () => Promise.resolve(resolve()),
  };
  return builder;
}

const fakeTx = {
  execute: mock(async () => []),
  select: (projection?: Record<string, unknown>) => makeSelectBuilder(projection),
  insert: () => ({
    values: async (row: Omit<VerificationRow, "attempts" | "createdAt" | "usedAt">) => {
      rows.push({
        ...row,
        usedAt: null,
        attempts: 0,
        createdAt: new Date(Date.now() + rows.length),
      });
      return [];
    },
  }),
  update: () => ({
    set: (changes: Partial<VerificationRow>) => ({
      where: async () => {
        for (const row of activeRows()) {
          Object.assign(row, changes);
        }
        return [];
      },
    }),
  }),
};

mock.module("resend", () => ({
  Resend: MockResend,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    transaction: async <T>(callback: (tx: typeof fakeTx) => Promise<T>) => {
      const run = transactionQueue.then(() => callback(fakeTx));
      transactionQueue = run.catch(() => undefined);
      return run;
    },
    update: () => ({
      set: (changes: Partial<VerificationRow>) => ({
        where: async () => {
          for (const row of activeRows()) {
            Object.assign(row, changes);
          }
          return [];
        },
      }),
    }),
  },
}));

const { sendVerificationCode, verifyCode } = await import("./send-verification");

function addCode(input: Partial<VerificationRow> & { code: string }): VerificationRow {
  const row: VerificationRow = {
    id: input.id ?? `evc_${rows.length + 1}`,
    email: input.email ?? "person@test.local",
    code: input.code,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60_000),
    usedAt: input.usedAt ?? null,
    attempts: input.attempts ?? 0,
    createdAt: input.createdAt ?? new Date(Date.now() + rows.length),
  };
  rows.push(row);
  return row;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "resend_test";
  process.env.RESEND_FROM_EMAIL = "Murmur <test@murmur.local>";
  rows.length = 0;
  sentEmails.length = 0;
  selectCalls = 0;
  transactionQueue = Promise.resolve();
  shouldFailSend = false;
  fakeTx.execute.mockClear();
});

describe("sendVerificationCode", () => {
  it("checks and inserts active codes inside the email transaction lock", async () => {
    const result = await sendVerificationCode(" Person@Test.Local ");

    expect(result).toEqual({ ok: true });
    expect(fakeTx.execute).toHaveBeenCalledTimes(1);
    expect(selectCalls).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("person@test.local");
    expect(sentEmails).toHaveLength(1);
  });

  it("caps concurrent active codes without a count-then-insert gap", async () => {
    const results = await Promise.all([
      sendVerificationCode("person@test.local"),
      sendVerificationCode("person@test.local"),
      sendVerificationCode("person@test.local"),
      sendVerificationCode("person@test.local"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => result.error === "rate_limit")).toHaveLength(1);
    expect(activeRows()).toHaveLength(3);
    expect(sentEmails).toHaveLength(3);
  });

  it("deactivates a code when the email provider fails after insert", async () => {
    shouldFailSend = true;

    const result = await sendVerificationCode("person@test.local");

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(rows).toHaveLength(1);
    expect(activeRows()).toHaveLength(0);
  });
});

describe("verifyCode", () => {
  it("increments every active code attempt on an invalid guess", async () => {
    addCode({ code: "111111", attempts: 2 });
    addCode({ code: "222222", attempts: 0 });

    const result = await verifyCode("person@test.local", "999999");

    expect(result).toEqual({ ok: false, error: "invalid_code" });
    expect(rows.map((row) => row.attempts)).toEqual([3, 3]);
  });

  it("does not allow code cycling to bypass the shared attempt ceiling", async () => {
    addCode({ code: "111111", attempts: 4 });
    addCode({ code: "222222", attempts: 1 });

    expect(await verifyCode("person@test.local", "999999")).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(rows.map((row) => row.attempts)).toEqual([5, 5]);

    expect(await verifyCode("person@test.local", "222222")).toEqual({
      ok: false,
      error: "max_attempts",
    });
  });

  it("uses a matching active code once and closes sibling active codes", async () => {
    addCode({ code: "111111" });
    addCode({ code: "222222" });

    expect(await verifyCode("person@test.local", "111111")).toEqual({
      ok: true,
    });
    expect(activeRows()).toHaveLength(0);
    expect(await verifyCode("person@test.local", "222222")).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });
});
