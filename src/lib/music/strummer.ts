// Legacy strummer shim — delegates to src/modules/strummer/
// The canonical implementation is in src/modules/strummer/generate-versions.ts

export { generateVibeVersions } from "@/modules/strummer/generate-versions";
export { generateStrummerCode } from "@/modules/strummer/generate-code";
export { applyEdit as applyVibeToken } from "@/modules/strummer/apply-edit";
export { generateTitle } from "./strummer-title";
