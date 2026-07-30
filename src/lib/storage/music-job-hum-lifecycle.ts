export function shouldDeleteDuplicateHum(input: {
  storedHumKey: string | null;
  duplicate: boolean;
  jobHumStorageKey: string | null;
}): boolean {
  return Boolean(
    input.storedHumKey
    && input.duplicate
    && input.storedHumKey !== input.jobHumStorageKey,
  );
}
