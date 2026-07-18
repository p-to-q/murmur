import { describe, expect, test } from "bun:test";
import {
  createRecordingOperationId,
  parseRecordingOperationId,
} from "./recording-operation";

describe("recording operation ids", () => {
  test("mints distinct UUIDs for distinct takes", () => {
    const first = createRecordingOperationId();
    const second = createRecordingOperationId();

    expect(parseRecordingOperationId(first)).toBe(first);
    expect(parseRecordingOperationId(second)).toBe(second);
    expect(first).not.toBe(second);
  });

  test("normalizes valid ids and rejects unbounded billing references", () => {
    expect(
      parseRecordingOperationId(" 01958F45-7E24-7A38-9F71-8F2DF69D33B8 "),
    ).toBe("01958f45-7e24-7a38-9f71-8f2df69d33b8");
    expect(parseRecordingOperationId("same-recording-forever")).toBeNull();
  });
});
