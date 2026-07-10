import { isObject } from "@/lib/utils/is-object";

export function errorSummary(error: unknown): Record<string, unknown> {
  if (!isObject(error)) {
    return { message: String(error) };
  }

  const message = readableMessage(error) ?? String(error);
  const summary: Record<string, unknown> = { message };
  const name = stringField(error, "name");
  const code = stringField(error, "code");
  const cause = "cause" in error ? error.cause : null;
  const nestedErrors = "errors" in error ? error.errors : null;

  if (name) summary.name = name;
  if (code) summary.code = code;
  if (cause) summary.cause = errorSummary(cause);
  if (Array.isArray(nestedErrors)) {
    summary.errors = nestedErrors.slice(0, 3).map((nested) => errorSummary(nested));
  }

  return summary;
}

function readableMessage(error: Record<string, unknown>): string | null {
  const message = stringField(error, "message");
  if (message) return message;

  const cause = "cause" in error ? error.cause : null;
  if (cause && isObject(cause)) {
    return readableMessage(cause);
  }

  const nestedErrors = "errors" in error ? error.errors : null;
  if (Array.isArray(nestedErrors)) {
    for (const nested of nestedErrors) {
      if (!isObject(nested)) continue;
      const nestedMessage = readableMessage(nested);
      if (nestedMessage) return nestedMessage;
    }
  }

  return null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

