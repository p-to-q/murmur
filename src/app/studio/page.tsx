import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

const StudioScreen = dynamic(
  () => import("@/components/screens/StudioScreen").then((m) => m.StudioScreen),
  { loading: () => <GlobalLoadingIndicator /> },
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
