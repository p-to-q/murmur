import { runAccountDeletionCleanup } from "./cleanup";
import { createAccountDeletionCronHandler } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = createAccountDeletionCronHandler(runAccountDeletionCleanup);
