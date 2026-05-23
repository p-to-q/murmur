import { redirect } from "next/navigation";

// The standalone /vibe page was an orphan in the journey: tapping a vibe card
// here just bounced back to /. The real Vibe surface is StudioScreen, which is
// reached *through* the Hum → Pick → Studio flow. We keep the URL alive but
// redirect anyone landing on it back to the entry point.
export default function VibePage() {
  redirect("/");
}
