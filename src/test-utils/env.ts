export function setTestEnv(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;

  if (value === undefined) {
    delete env[key];
    return;
  }

  env[key] = value;
}

export function setTestNodeEnv(value: string | undefined): void {
  setTestEnv("NODE_ENV", value);
}
