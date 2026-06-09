import dynamic from "next/dynamic";

const StudioScreen = dynamic(() =>
  import("@/components/screens/StudioScreen").then((m) => m.StudioScreen),
);

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
