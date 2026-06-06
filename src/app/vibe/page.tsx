import { VibeScreen } from "@/components/screens/VibeScreen";

/**
 * /vibe — the *discover* moment in the journey.
 *
 * v2 promotes Vibe from an overlay sibling of HumScreen to its own route so
 * hard refresh, share-link, and shell-native navigation (Capacitor, Taro) all
 * work. The signature iris-close transition still plays on mount.
 *
 * Hard-refresh recovery: if there are no vibeVersions in the store, the
 * screen redirects to "/" internally (see VibeScreen useEffect).
 */
export default async function VibePage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const demo = params?.demo === "1";

  return (
    <>
      {demo ? <span hidden>demo-vibe-route</span> : null}
      <VibeScreen initialDemo={demo} />
    </>
  );
}
