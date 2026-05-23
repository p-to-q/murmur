import { HumScreen } from "@/components/screens/HumScreen";
import { VersionCardsOverlay } from "@/components/screens/VersionCardsOverlay";

export default function HomePage() {
  // Judge-facing entrypoint:
  // the home route intentionally stacks only two visible layers:
  // capture first, then vibe branching. The rest of the product unfolds
  // only after the user has created a melodic seed worth shaping.
  return (
    <>
      <HumScreen />
      <VersionCardsOverlay />
    </>
  );
}
