import type { Metadata } from "next";
import MeloLabClient from "./MeloLabClient";

export const metadata: Metadata = {
  title: "MeLo Lab | Murmur",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function MeloLabPage() {
  return <MeloLabClient />;
}
