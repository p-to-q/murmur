import { describe, expect, it } from "bun:test";
import {
  assignCreationJourneyExperiment,
  isExperimentTreatment,
  parseCreationJourneyExperimentFlag,
  resolveCreationJourneyExperiments,
  stableExperimentBucket,
} from "./creation-journey";

describe("creation journey experiment flags", () => {
  it("fails closed for absent and malformed flags", () => {
    expect(parseCreationJourneyExperimentFlag(undefined)).toEqual({
      mode: "disabled",
    });
    expect(parseCreationJourneyExperimentFlag("experiment:0")).toEqual({
      mode: "disabled",
    });
    expect(parseCreationJourneyExperimentFlag("experiment:101")).toEqual({
      mode: "disabled",
    });
    expect(parseCreationJourneyExperimentFlag("surprise-me")).toEqual({
      mode: "disabled",
    });
  });

  it("parses controlled rollout percentages into basis points", () => {
    expect(parseCreationJourneyExperimentFlag("experiment")).toEqual({
      mode: "experiment",
      enrollmentBasisPoints: 10_000,
    });
    expect(parseCreationJourneyExperimentFlag("experiment:12.5")).toEqual({
      mode: "experiment",
      enrollmentBasisPoints: 1_250,
    });
  });
});

describe("creation journey assignment", () => {
  it("keeps both changes disabled by default", () => {
    const assignments = resolveCreationJourneyExperiments({
      subjectId: "flow_123",
      flags: {},
    });

    expect(assignments.studioOptional).toMatchObject({
      variant: "control",
      mode: "disabled",
      enrolled: false,
    });
    expect(assignments.canonicalDraftFirst).toMatchObject({
      variant: "control",
      mode: "disabled",
      enrolled: false,
    });
    expect(isExperimentTreatment(assignments.studioOptional)).toBe(false);
    expect(isExperimentTreatment(assignments.canonicalDraftFirst)).toBe(false);
  });

  it("is stable for the same flow and isolated by experiment key", () => {
    const first = resolveCreationJourneyExperiments({
      subjectId: "flow_stable",
      flags: {
        studioOptional: "experiment",
        canonicalDraftFirst: "experiment",
      },
    });
    const second = resolveCreationJourneyExperiments({
      subjectId: "flow_stable",
      flags: {
        studioOptional: "experiment",
        canonicalDraftFirst: "experiment",
      },
    });

    expect(second).toEqual(first);
    expect(first.studioOptional.experiment).toBe("studio_optional");
    expect(first.canonicalDraftFirst.experiment).toBe(
      "canonical_draft_first",
    );
  });

  it("does not enroll a request without a stable subject", () => {
    const assignment = assignCreationJourneyExperiment({
      experiment: "studio_optional",
      subjectId: " ",
      flag: "experiment",
    });

    expect(assignment).toMatchObject({
      variant: "control",
      mode: "disabled",
      enrolled: false,
    });
  });

  it("supports explicit QA overrides without depending on a subject", () => {
    const treatment = assignCreationJourneyExperiment({
      experiment: "canonical_draft_first",
      subjectId: null,
      flag: "treatment",
    });
    const control = assignCreationJourneyExperiment({
      experiment: "canonical_draft_first",
      subjectId: null,
      flag: "control",
    });

    expect(isExperimentTreatment(treatment)).toBe(true);
    expect(isExperimentTreatment(control)).toBe(false);
    expect(treatment.mode).toBe("forced");
    expect(control.mode).toBe("forced");
  });

  it("enforces percentage enrollment and a balanced variant boundary", () => {
    const subjects = Array.from({ length: 5_000 }, (_, index) => `flow_${index}`);
    const enrolled = subjects
      .map((subjectId) =>
        assignCreationJourneyExperiment({
          experiment: "studio_optional",
          subjectId,
          flag: "experiment:20",
        }),
      )
      .filter((assignment) => assignment.enrolled);
    const treatments = enrolled.filter(
      (assignment) => assignment.variant === "treatment",
    );

    expect(enrolled.length / subjects.length).toBeGreaterThan(0.18);
    expect(enrolled.length / subjects.length).toBeLessThan(0.22);
    expect(treatments.length / enrolled.length).toBeGreaterThan(0.45);
    expect(treatments.length / enrolled.length).toBeLessThan(0.55);
  });

  it("keeps buckets inside the documented range", () => {
    expect(stableExperimentBucket("a")).toBeGreaterThanOrEqual(0);
    expect(stableExperimentBucket("a")).toBeLessThan(10_000);
    expect(stableExperimentBucket("a")).toBe(stableExperimentBucket("a"));
  });
});
