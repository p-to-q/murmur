import { headers } from "next/headers";

import { AuthErrorScreen } from "@/components/screens/AuthErrorScreen";

export const metadata = {
  title: "Sign-in error",
};

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const error = params?.error ?? "Default";
  const host = (await headers()).get("host") ?? "";
  const isLocal = isLocalHost(host);

  return <AuthErrorScreen error={error} isLocal={isLocal} />;
}
