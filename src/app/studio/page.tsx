import { StudioScreen } from "@/components/screens/StudioScreen";

export default async function StudioPage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const demo = params?.demo === "1";

  return (
    <>
      {demo ? <span hidden>demo-studio-route</span> : null}
      <StudioScreen initialDemo={demo} />
    </>
  );
}
