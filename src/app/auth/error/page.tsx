import { AuthErrorScreen } from "@/components/screens/AuthErrorScreen";

export const metadata = {
  title: "Sign-in error",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const error = params?.error ?? "Default";

  return <AuthErrorScreen error={error} />;
}
