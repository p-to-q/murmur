const REQUIRED_IN_PRODUCTION = [
  {
    keys: ["DATABASE_URL", "POSTGRES_URL"],
    label: "DATABASE_URL or POSTGRES_URL",
    anyOf: true,
  },
  {
    keys: ["MURMUR_STORAGE_DRIVER"],
    label: "MURMUR_STORAGE_DRIVER",
  },
] as const;

function hasAny(keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function main() {
  const onVercel = process.env.VERCEL === "1";
  const inCi = process.env.CI === "true";
  const production =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (!production || (!onVercel && !inCi)) {
    console.log("env audit skipped (not production CI/Vercel).");
    return;
  }

  const missing: string[] = [];

  for (const rule of REQUIRED_IN_PRODUCTION) {
    if ("anyOf" in rule && rule.anyOf) {
      if (!hasAny(rule.keys)) missing.push(rule.label);
    } else if (!hasAny(rule.keys)) {
      missing.push(rule.label);
    }
  }

  const googleConfigured =
    Boolean(process.env.GOOGLE_CLIENT_ID?.trim()) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());

  if (
    googleConfigured &&
    !process.env.AUTH_SECRET?.trim() &&
    !process.env.NEXTAUTH_SECRET?.trim()
  ) {
    missing.push("AUTH_SECRET (required when Google OAuth is configured)");
  }

  if (missing.length > 0) {
    console.error("Production env audit failed. Missing:");
    for (const item of missing) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log("Production env audit passed.");
}

main();
