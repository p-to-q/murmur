export const CREATION_JOURNEY_EXPERIMENT_KEYS = [
  "studio_optional",
  "canonical_draft_first",
] as const;

export type CreationJourneyExperimentKey =
  (typeof CREATION_JOURNEY_EXPERIMENT_KEYS)[number];

export type CreationJourneyVariant = "control" | "treatment";
export type ExperimentAssignmentMode = "disabled" | "experiment" | "forced";

export type ExperimentAssignment = {
  experiment: CreationJourneyExperimentKey;
  variant: CreationJourneyVariant;
  mode: ExperimentAssignmentMode;
  enrolled: boolean;
  bucket: number | null;
};

export type CreationJourneyExperimentFlags = {
  studioOptional?: string | null;
  canonicalDraftFirst?: string | null;
};

export type CreationJourneyAssignments = {
  studioOptional: ExperimentAssignment;
  canonicalDraftFirst: ExperimentAssignment;
};

type ParsedFlag =
  | { mode: "disabled" }
  | { mode: "forced"; variant: CreationJourneyVariant }
  | { mode: "experiment"; enrollmentBasisPoints: number };

const TOTAL_BUCKETS = 10_000;

/**
 * Public flag format:
 * - off (default)
 * - experiment or experiment:<percentage>
 * - control / treatment (QA-only forced assignment)
 */
export function parseCreationJourneyExperimentFlag(
  value: string | null | undefined,
): ParsedFlag {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "off") return { mode: "disabled" };
  if (normalized === "control" || normalized === "treatment") {
    return { mode: "forced", variant: normalized };
  }
  if (normalized === "experiment") {
    return { mode: "experiment", enrollmentBasisPoints: TOTAL_BUCKETS };
  }

  const match = /^experiment:(\d{1,3}(?:\.\d{1,2})?)$/.exec(normalized);
  if (!match) return { mode: "disabled" };
  const percentage = Number(match[1]);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    return { mode: "disabled" };
  }
  return {
    mode: "experiment",
    enrollmentBasisPoints: Math.round(percentage * 100),
  };
}

// FNV-1a is deterministic across browser and server runtimes. This is an
// allocation hash, not a security or anonymization primitive.
export function stableExperimentBucket(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % TOTAL_BUCKETS;
}

export function assignCreationJourneyExperiment(args: {
  experiment: CreationJourneyExperimentKey;
  subjectId: string | null | undefined;
  flag: string | null | undefined;
}): ExperimentAssignment {
  const parsed = parseCreationJourneyExperimentFlag(args.flag);
  if (parsed.mode === "disabled") {
    return {
      experiment: args.experiment,
      variant: "control",
      mode: "disabled",
      enrolled: false,
      bucket: null,
    };
  }
  if (parsed.mode === "forced") {
    return {
      experiment: args.experiment,
      variant: parsed.variant,
      mode: "forced",
      enrolled: true,
      bucket: null,
    };
  }

  const subjectId = args.subjectId?.trim();
  if (!subjectId) {
    return {
      experiment: args.experiment,
      variant: "control",
      mode: "disabled",
      enrolled: false,
      bucket: null,
    };
  }

  const enrollmentBucket = stableExperimentBucket(
    `${args.experiment}:enrollment:${subjectId}`,
  );
  if (enrollmentBucket >= parsed.enrollmentBasisPoints) {
    return {
      experiment: args.experiment,
      variant: "control",
      mode: "experiment",
      enrolled: false,
      bucket: enrollmentBucket,
    };
  }

  const variantBucket = stableExperimentBucket(
    `${args.experiment}:variant:${subjectId}`,
  );
  return {
    experiment: args.experiment,
    variant: variantBucket < TOTAL_BUCKETS / 2 ? "control" : "treatment",
    mode: "experiment",
    enrolled: true,
    bucket: variantBucket,
  };
}

export function resolveCreationJourneyExperiments(args: {
  subjectId: string | null | undefined;
  flags?: CreationJourneyExperimentFlags;
}): CreationJourneyAssignments {
  const flags = args.flags ?? readCreationJourneyExperimentFlags();
  return {
    studioOptional: assignCreationJourneyExperiment({
      experiment: "studio_optional",
      subjectId: args.subjectId,
      flag: flags.studioOptional,
    }),
    canonicalDraftFirst: assignCreationJourneyExperiment({
      experiment: "canonical_draft_first",
      subjectId: args.subjectId,
      flag: flags.canonicalDraftFirst,
    }),
  };
}

export function readCreationJourneyExperimentFlags(): CreationJourneyExperimentFlags {
  return {
    studioOptional:
      process.env.NEXT_PUBLIC_MURMUR_EXPERIMENT_STUDIO_OPTIONAL,
    canonicalDraftFirst:
      process.env.NEXT_PUBLIC_MURMUR_EXPERIMENT_CANONICAL_DRAFT_FIRST,
  };
}

export function isExperimentTreatment(
  assignment: ExperimentAssignment,
): boolean {
  return assignment.enrolled && assignment.variant === "treatment";
}
