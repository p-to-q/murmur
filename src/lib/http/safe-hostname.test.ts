import { describe, expect, it } from "bun:test";
import { safeHostnameFromUrl } from "@/lib/http/safe-hostname";

describe("safeHostnameFromUrl", () => {
  it("extracts the hostname from a well-formed URL", () => {
    expect(safeHostnameFromUrl("https://murmur.ptoq.io/api/transcribe")).toBe(
      "murmur.ptoq.io",
    );
    expect(safeHostnameFromUrl("http://localhost:3000/api/transcribe")).toBe(
      "localhost",
    );
    expect(safeHostnameFromUrl("http://127.0.0.1:3000/x")).toBe("127.0.0.1");
  });

  it("returns null for an unparseable URL instead of throwing", () => {
    expect(safeHostnameFromUrl("not a url")).toBeNull();
    expect(safeHostnameFromUrl("")).toBeNull();
    expect(safeHostnameFromUrl("/relative/path")).toBeNull();
  });
});
