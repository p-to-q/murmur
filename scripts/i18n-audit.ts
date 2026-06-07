import { auditI18nUsage } from "@/lib/i18n/audit";

const audit = auditI18nUsage();

if (audit.missingCount === 0) {
  console.log("i18n audit: no missing translation keys");
  process.exit(0);
}

console.log(`i18n audit: ${audit.missingCount} missing translation keys`);
for (const item of audit.missing) {
  console.log(`- ${item.key}`);
  for (const location of item.locations) {
    console.log(`  ${location}`);
  }
}

process.exitCode = 1;
