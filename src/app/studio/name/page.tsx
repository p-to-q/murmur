import { NameScreen } from "@/components/screens/NameScreen";

export default async function StudioNamePage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const demo = params?.demo === "1";

  return (
    <>
      {demo ? <span hidden>demo-name-route</span> : null}
      <NameScreen initialDemo={demo} />
    </>
  );
}
