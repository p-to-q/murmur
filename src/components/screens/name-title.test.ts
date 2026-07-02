import { describe, expect, test } from "bun:test";

import {
  getInitialNameTitleState,
  resolveNameDisplayTitle,
} from "./name-title";

describe("name title state", () => {
  test("uses the Studio version title as the initial editable name", () => {
    expect(
      getInitialNameTitleState("Soft Evening", [
        "Window Song",
        "Little Signal",
      ]),
    ).toEqual({ title: "Soft Evening", titleMode: "custom" });
  });

  test("falls back to the first suggestion when a version has no title", () => {
    expect(
      getInitialNameTitleState("", ["Window Song", "Little Signal"]),
    ).toEqual({ title: "Window Song", titleMode: "suggested" });
  });

  test("does not let suggestions cover an existing Studio title", () => {
    expect(
      resolveNameDisplayTitle(
        { title: "Soft Evening", titleMode: "custom" },
        ["Window Song", "Little Signal"],
      ),
    ).toBe("Soft Evening");
  });

  test("keeps suggested titles synced with the current suggestion batch", () => {
    expect(
      resolveNameDisplayTitle(
        { title: "Old Suggestion", titleMode: "suggested" },
        ["Window Song", "Little Signal"],
      ),
    ).toBe("Window Song");
  });
});
