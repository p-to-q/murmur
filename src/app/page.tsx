import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

const HumScreen = dynamic(
  () => import("@/components/screens/HumScreen").then((m) => m.HumScreen),
  { loading: () => <GlobalLoadingIndicator /> },
);

/**
 * Home route — `/`.
 *
 * v2 thinning: the route renders only the Hum capture screen. Vibe lives at
 * `/vibe` now (a full route, with the iris-close transition replayed on
 * arrival) instead of an overlay stacked here. HumScreen pushes to /vibe
 * after a successful transcribe.
 */
export default function HomePage() {
  return <HumScreen />;
}
